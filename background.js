'use strict';

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-3-5-haiku-20241022';

let injectedProfileCache = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'scrapeProfile') {
    handleScrapeProfile(sendResponse);
    return true;
  }

  if (message.action === 'generateMessage') {
    handleQuickGenerate(message.data, sendResponse);
    return true;
  }

  if (message.action === 'generateDual') {
    handleDualGenerate(message.data, sendResponse);
    return true;
  }

  if (message.action === 'openPopupWithProfile') {
    injectedProfileCache = message.profile;
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'getInjectedProfile') {
    const profile = injectedProfileCache;
    injectedProfileCache = null;
    sendResponse({ profile });
    return true;
  }

  if (message.type === 'TEST_API_KEY') {
    handleTestKey(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'RUN_ENRICH') {
    handleEnrich(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'RUN_GENERATE') {
    handleDeepGenerate(message.payload, sendResponse);
    return true;
  }

  if (message.type === 'SAVE_RECENT') {
    chrome.storage.local.get(['recentContacts'], (result) => {
      const recent  = result.recentContacts || [];
      const updated = [message.payload, ...recent.filter(c => c.profileUrl !== message.payload.profileUrl)].slice(0, 5);
      chrome.storage.local.set({ recentContacts: updated });
      sendResponse({ status: 'saved' });
    });
    return true;
  }

  if (message.type === 'GET_RECENT') {
    chrome.storage.local.get(['recentContacts'], (result) => {
      sendResponse({ contacts: result.recentContacts || [] });
    });
    return true;
  }
});

// ─── Scrape profile from active tab ───────────────────────────────────────────
async function handleScrapeProfile(sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab  = tabs[0];
    if (!tab) throw new Error('No active tab found.');
    if (!tab.url || !tab.url.includes('linkedin.com')) {
      throw new Error('Please navigate to a LinkedIn profile page first.');
    }

    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      await delay(400);
      result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
    }

    if (!result?.success) throw new Error(result?.error || 'Scrape failed.');
    sendResponse({ success: true, data: result.data });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─── Test user's own API key ──────────────────────────────────────────────────
async function handleTestKey({ apiKey }, sendResponse) {
  try {
    await callClaude(apiKey, 'Reply with the single word: OK', 10);
    sendResponse({ valid: true });
  } catch (err) {
    sendResponse({ valid: false, reason: err.message });
  }
}

async function handleQuickGenerate(data, sendResponse) {
  try {
    const { profileData, settings, messageType, tone, connectionNote } = data;
    const p      = normalizeProfile(profileData);
    const hooks  = buildHooks(p);
    const apiKey = await getApiKey();

    const message = apiKey
      ? await aiMessage(apiKey, p, hooks, messageType, tone, settings, connectionNote, 'direct')
      : localMessage(p, hooks, messageType, tone, settings, connectionNote, 'direct');

    sendResponse({ success: true, generatedMessage: message });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleDualGenerate(data, sendResponse) {
  try {
    const { profileData, settings, messageType, tone, connectionNote } = data;
    const p      = normalizeProfile(profileData);
    const hooks  = buildHooks(p);
    const apiKey = await getApiKey();

    const [optionA, optionB] = await Promise.all([
      apiKey
        ? aiMessage(apiKey, p, hooks, messageType, tone, settings, connectionNote, 'direct')
        : localMessage(p, hooks, messageType, tone, settings, connectionNote, 'direct'),
      apiKey
        ? aiMessage(apiKey, p, hooks, messageType, tone, settings, connectionNote, 'value-first')
        : localMessage(p, hooks, messageType, tone, settings, connectionNote, 'value-first'),
    ]);

    sendResponse({ success: true, optionA, optionB });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ─── Deep Mode enrich (L1 + L2) — runs locally ────────────────────────────────
async function handleEnrich({ rawProfileData }, sendResponse) {
  try {
    const profileJSON    = normalizeProfile(rawProfileData);
    const enrichmentJSON = { topHooks: buildHooks(profileJSON), companyNews: [] };
    await delay(300);
    sendResponse({ status: 'enrich_complete', profileJSON, enrichmentJSON });
  } catch (err) {
    sendResponse({ status: 'error', error: err.message });
  }
}

async function handleDeepGenerate({ profileJSON, enrichmentJSON, messageType, tone, connectionNote }, sendResponse) {
  try {
    const settings = await new Promise(resolve => chrome.storage.local.get(['userName', 'userBio', 'userTargetRole'], resolve));
    const hooks    = enrichmentJSON?.topHooks || [];
    const apiKey   = await getApiKey();

    const message = apiKey
      ? await aiMessage(apiKey, profileJSON, hooks, messageType, tone, settings, connectionNote, 'direct')
      : localMessage(profileJSON, hooks, messageType, tone, settings, connectionNote, 'direct');

    sendResponse({ status: 'generate_complete', generatedMessage: message });
  } catch (err) {
    sendResponse({ status: 'error', error: err.message });
  }
}

// ─── Profile helpers ──────────────────────────────────────────────────────────
function normalizeProfile(raw = {}) {
  return {
    name:              (raw.name || '').trim(),
    firstName:         ((raw.name || '').trim().split(/\s+/)[0]) || 'there',
    headline:          raw.headline || '',
    currentTitle:      raw.currentTitle || '',
    currentCompany:    raw.currentCompany || '',
    location:          raw.location || '',
    about:             raw.about || '',
    recentPosts:       raw.recentPosts || [],
    experienceEntries: raw.experienceEntries || [],
    pastCompanies:     raw.pastCompanies || [],
    educationEntries:  raw.educationEntries || [],
    skills:            raw.skills || [],
    profileUrl:        raw.profileUrl || ''
  };
}

function buildHooks(p) {
  const hooks = [];
  if (p.recentPosts.length) hooks.push(`Recent post: "${truncate(p.recentPosts[0], 90)}"`);
  if (p.currentTitle && p.currentCompany) hooks.push(`Works as ${p.currentTitle} at ${p.currentCompany}`);
  else if (p.currentCompany) hooks.push(`Currently at ${p.currentCompany}`);
  if (p.skills.length) hooks.push(`Skilled in ${p.skills.slice(0, 3).join(', ')}`);
  if (p.pastCompanies.length) hooks.push(`Previously at ${p.pastCompanies.slice(0, 2).join(' and ')}`);
  if (p.educationEntries.length) hooks.push(`Studied at ${stringify(p.educationEntries[0])}`);
  if (!hooks.length && p.headline) hooks.push(`Headline: ${p.headline}`);
  return hooks.slice(0, 3);
}

function localMessage(p, hooks, messageType, tone, settings = {}, connectionNote = false, angle = 'direct') {
  const me         = (settings.userName || '').trim();
  const bio        = (settings.userBio || '').trim();
  const targetRole = (settings.userTargetRole || '').trim();
  const role       = p.currentTitle || p.headline || 'your work';
  const co         = p.currentCompany ? ` at ${p.currentCompany}` : '';

  const greet = { Formal: `Dear ${p.firstName},`, Neutral: `Hi ${p.firstName},`, Casual: `Hey ${p.firstName}!` }[tone] || `Hi ${p.firstName},`;
  const close = { Formal: 'Kind regards,', Neutral: 'Best,', Casual: 'Cheers,' }[tone] || 'Best,';

  let hookLine;
  if (angle === 'value-first') {
    if (p.recentPosts.length) {
      hookLine = `Your post on "${truncate(p.recentPosts[0], 55)}" really resonated with me.`;
    } else if (p.skills.length >= 2) {
      hookLine = `Your depth in ${p.skills.slice(0, 2).join(' and ')} is exactly the kind of expertise I've been learning from.`;
    } else {
      hookLine = `Your background in ${role}${co} caught my eye — particularly the way you've built your career.`;
    }
  } else {
    if (p.recentPosts.length) hookLine = `I enjoyed your recent post about "${truncate(p.recentPosts[0], 60)}".`;
    else if (p.skills.length) hookLine = `Your experience in ${p.skills.slice(0, 2).join(' and ')}${co} caught my attention.`;
    else hookLine = `I came across your profile and was impressed by your work as ${role}${co}.`;
  }

  if (connectionNote) {
    const roleAsk = targetRole ? targetRole + ' opportunities' : `opportunities${co ? ' with your team' : ''}`;
    const ask = {
      Networking:    `Would love to connect and exchange ideas.`,
      Job:           `I'm exploring ${roleAsk} and would value a quick chat.`,
      Referral:      `Would really appreciate any guidance on roles${co} — or a referral if you think I'd fit.`,
      Collaboration: `Think there's a great opportunity for us to collaborate — worth a chat?`
    }[messageType] || `Would love to connect.`;
    const msg = `${greet} ${hookLine} ${ask}${me ? ` — ${me}` : ''}`;
    return msg.length > 300 ? msg.slice(0, 299) + '…' : msg;
  }

  const intro = bio ? ` A bit about me: ${truncate(bio, 120)}` : '';
  const ask = {
    Networking:    `I'd love to connect and exchange ideas.`,
    Job:           `I'm exploring ${targetRole ? targetRole + ' opportunities' : `opportunities${co ? ' with your team' : ''}`} and would really value a quick chat about any relevant openings.`,
    Referral:      `If you're open to it, I'd be grateful for any guidance on roles${co} — or a referral if you think I'd be a fit.`,
    Collaboration: `I think there could be a great opportunity for us to collaborate and would love to explore it.`
  }[messageType] || `I'd love to connect.`;

  return `${greet}\n\n${hookLine}${intro}\n\n${ask}\n\n${close}${me ? '\n' + me : ''}`;
}

async function aiMessage(apiKey, p, hooks, messageType, tone, settings = {}, connectionNote = false, angle = 'direct') {
  const limit  = connectionNote ? 280 : 580;
  const format = connectionNote
    ? 'Write as a single compact paragraph, no greeting/sign-off on separate lines.'
    : 'Use a short greeting, 1-2 body sentences, a clear ask, and a sign-off.';

  const angleInstruction = angle === 'value-first'
    ? 'ANGLE: Value-first / observation. Open by referencing something specific from their recent post, a shared skill, or a notable part of their background before making your ask. Lead with what impressed you about THEM, not about yourself.'
    : 'ANGLE: Direct & low-friction. Get to the point quickly. Brief personalised opener, then immediately a clear, low-commitment ask. No fluff.';

  const prompt =
`Write a LinkedIn outreach message under ${limit} characters.
Purpose: ${messageType}. Tone: ${tone}. Format: ${format}
${angleInstruction}
Recipient: ${JSON.stringify({ name: p.name, headline: p.headline, title: p.currentTitle, company: p.currentCompany, about: truncate(p.about, 300), recentPosts: p.recentPosts, skills: p.skills })}
Hooks: ${hooks.join(' | ')}
Sender name: ${settings.userName || '(not given)'}. Sender bio: ${settings.userBio || '(not given)'}. Sender target role: ${settings.userTargetRole || '(not given)'}.
Return only the message text.`;
  return (await callClaude(apiKey, prompt, connectionNote ? 120 : 400)).trim();
}

async function callClaude(apiKey, prompt, maxTokens) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `API error (${res.status})`);
  return (data.content || []).map(c => c.text || '').join('');
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['userApiKey'], r => resolve((r.userApiKey || '').trim()));
  });
}
function truncate(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function stringify(x) { return typeof x === 'string' ? x : (x?.school || x?.name || x?.title || Object.values(x || {}).join(', ')); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
