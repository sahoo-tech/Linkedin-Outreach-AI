'use strict';

let currentProfile     = null;
let isGenerating       = false;
let currentMode        = 'simple';
let deepProfileJSON    = null;
let deepEnrichmentJSON = null;
let isEnriching        = false;
let connectionNote     = true;

let dualOptionA = '';
let dualOptionB = '';
let activeOption = 'a';

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initModeToggle();
  initNoteToggle();
  wireSettingsEvents();
  wireCurrentEvents();
  wireRecentEvents();
  await checkCurrentPage();
  await loadSettings();
  await renderRecentContacts();
  await checkLicenseStatus();
  await checkInjectedProfile();
});

// ─── License key status in header ────────────────────────────────────────────
async function checkLicenseStatus() {
  const s   = await loadStoredSettings();
  const key = (s.userApiKey || '').trim();
  const el  = document.getElementById('key-status');
  el.textContent = key ? '● AI Mode' : '● Free Mode';
  el.className   = 'key-status active';
  document.getElementById('no-key-warning').classList.add('hidden');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'recent') renderRecentContacts();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function initModeToggle() {
  document.getElementById('mode-simple').addEventListener('click', () => setMode('simple'));
  document.getElementById('mode-deep').addEventListener('click', () => setMode('deep'));
}

function initNoteToggle() {
  document.getElementById('note-btn-connection').addEventListener('click', () => setConnectionNote(true));
  document.getElementById('note-btn-dm').addEventListener('click', () => setConnectionNote(false));
}

function setConnectionNote(isNote) {
  connectionNote = isNote;
  document.getElementById('note-btn-connection').classList.toggle('active', isNote);
  document.getElementById('note-btn-dm').classList.toggle('active', !isNote);
  updateCharCount();
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('mode-simple').classList.toggle('active', mode === 'simple');
  document.getElementById('mode-deep').classList.toggle('active', mode === 'deep');
  document.getElementById('simple-mode-ui').classList.toggle('hidden', mode === 'deep');
  document.getElementById('deep-mode-ui').classList.toggle('hidden', mode === 'simple');
  hideMessage();
  clearCurrentStatus();
}

// ─── Page check ───────────────────────────────────────────────────────────────
async function checkCurrentPage() {
  const tabs      = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab       = tabs[0];
  const onProfile = tab && tab.url && /linkedin\.com\/in\/[^/?#]+/.test(tab.url);
  document.getElementById('scrape-btn').disabled  = !onProfile;
  document.getElementById('enrich-btn').disabled  = !onProfile;
  if (!onProfile) {
    document.getElementById('page-warning').classList.remove('hidden');
  } else {
    document.getElementById('page-warning').classList.add('hidden');
  }
  return onProfile;
}

// ─── Wire events ──────────────────────────────────────────────────────────────
function wireCurrentEvents() {
  document.getElementById('scrape-btn').addEventListener('click', handleScrapeAndGenerate);
  document.getElementById('dual-btn').addEventListener('click', handleDualGenerate);
  document.getElementById('enrich-btn').addEventListener('click', handleEnrich);
  document.getElementById('deep-generate-btn').addEventListener('click', handleDeepGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', handleRegenerate);
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('insert-btn').addEventListener('click', handleInsert);
  document.getElementById('generated-message').addEventListener('input', updateCharCount);

  document.getElementById('dual-copy-btn').addEventListener('click', handleDualCopy);
  document.getElementById('dual-insert-btn').addEventListener('click', handleDualInsert);
  document.getElementById('dual-message').addEventListener('input', updateDualCharCount);
  document.getElementById('tab-option-a').addEventListener('click', () => switchDualOption('a'));
  document.getElementById('tab-option-b').addEventListener('click', () => switchDualOption('b'));

  document.getElementById('auto-connect-btn').addEventListener('click', handleAutoConnect);
  document.getElementById('dual-auto-connect-btn').addEventListener('click', handleDualAutoConnect);
}

function wireSettingsEvents() {
  document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('validate-btn').addEventListener('click', handleValidateKey);
  document.getElementById('api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleValidateKey();
  });
}

function wireRecentEvents() {
  document.getElementById('clear-recent-btn').addEventListener('click', async () => {
    await Cache.clearContacts();
    renderRecentContacts();
  });
}

// ─── Simple Mode ──────────────────────────────────────────────────────────────
async function handleScrapeAndGenerate() {
  if (isGenerating) return;


  isGenerating = true;
  hideMessage();
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Scraping profile…');
  clearCurrentStatus();

  try {
    const profile = await sendToBackground({ action: 'scrapeProfile' });
    currentProfile = profile;
    renderProfileCard(profile);
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Generating message…');

    const message = await callQuickGenerate(profile);
    renderMessage(message);

    await Cache.addContact({
      profileUrl: profile.profileUrl || '',
      name:       profile.name       || 'Unknown',
      headline:   profile.headline   || '',
      company:    profile.currentCompany || '',
      message,
      timestamp:  Date.now()
    });

    showCurrentStatus('Message ready.', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
  }
}

async function callQuickGenerate(profile) {
  const settings    = await loadStoredSettings();
  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;
  return sendToBackground({ action: 'generateMessage', data: { profileData: profile, settings, messageType, tone, connectionNote } });
}

async function handleRegenerate() {
  if (isGenerating) return;
  if (currentMode === 'deep') { handleDeepGenerate(); return; }
  if (!currentProfile) return;

  isGenerating = true;
  setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Regenerating…');

  try {
    const message = await callQuickGenerate(currentProfile);
    renderMessage(message);
    showCurrentStatus('Regenerated!', 'success');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
  }
}

async function checkInjectedProfile() {
  const response = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'getInjectedProfile' }, resolve);
  });
  if (response && response.profile) {
    currentProfile = response.profile;
    renderProfileCard(currentProfile);
    showCurrentStatus('Profile loaded from page button — generating…');
    isGenerating = true;
    setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', true, 'Generating message…');
    try {
      const message = await callQuickGenerate(currentProfile);
      renderMessage(message);
      await Cache.addContact({
        profileUrl: currentProfile.profileUrl || '',
        name:       currentProfile.name || 'Unknown',
        headline:   currentProfile.headline || '',
        company:    currentProfile.currentCompany || '',
        message,
        timestamp:  Date.now()
      });
      showCurrentStatus('Message ready.', 'success');
    } catch (err) {
      showCurrentStatus(err.message, 'error');
    } finally {
      isGenerating = false;
      setButtonLoading('scrape-btn', 'btn-label', 'btn-spinner', false, 'Scrape &amp; Generate');
    }
  }
}

async function handleDualGenerate() {
  if (isGenerating) return;

  let profileToUse = currentProfile;

  if (!profileToUse) {
    isGenerating = true;
    setButtonLoading('dual-btn', 'dual-label', 'dual-spinner', true, 'Scraping…');
    try {
      profileToUse = await sendToBackground({ action: 'scrapeProfile' });
      currentProfile = profileToUse;
      renderProfileCard(profileToUse);
    } catch (err) {
      showCurrentStatus(err.message, 'error');
      isGenerating = false;
      setButtonLoading('dual-btn', 'dual-label', 'dual-spinner', false, '⚡ Generate A/B Variations');
      return;
    }
  }

  isGenerating = true;
  setButtonLoading('dual-btn', 'dual-label', 'dual-spinner', true, 'Writing A/B…');
  hideMessage();
  hideDualPanel();
  showCurrentStatus('Generating two angles simultaneously…');

  try {
    const settings    = await loadStoredSettings();
    const messageType = document.getElementById('message-type').value;
    const tone        = document.getElementById('tone').value;

    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'generateDual', data: { profileData: profileToUse, settings, messageType, tone, connectionNote } },
        (res) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!res || !res.success) { reject(new Error(res?.error || 'Dual generation failed.')); return; }
          resolve(res);
        }
      );
    });

    dualOptionA  = result.optionA;
    dualOptionB  = result.optionB;
    activeOption = 'a';
    renderDualPanel();
    showCurrentStatus('Two variations ready — toggle A/B above.', 'success');

    await Cache.addContact({
      profileUrl: profileToUse.profileUrl || '',
      name:       profileToUse.name || 'Unknown',
      headline:   profileToUse.headline || '',
      company:    profileToUse.currentCompany || '',
      message:    dualOptionA,
      timestamp:  Date.now()
    });
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    isGenerating = false;
    setButtonLoading('dual-btn', 'dual-label', 'dual-spinner', false, '⚡ Generate A/B Variations');
  }
}

function switchDualOption(option) {
  activeOption = option;
  document.getElementById('dual-message').value = option === 'a' ? dualOptionA : dualOptionB;
  document.getElementById('tab-option-a').classList.toggle('active', option === 'a');
  document.getElementById('tab-option-b').classList.toggle('active', option === 'b');
  document.getElementById('dual-desc').textContent = option === 'a'
    ? 'Option A: Direct & low-friction — straight to the ask.'
    : 'Option B: Value-first — leads with an observation or insight before the ask.';
  updateDualCharCount();
}

function renderDualPanel() {
  document.getElementById('dual-panel').classList.remove('hidden');
  document.getElementById('dual-message').value = dualOptionA;
  document.getElementById('dual-desc').textContent = 'Option A: Direct & low-friction — straight to the ask.';
  document.getElementById('tab-option-a').classList.add('active');
  document.getElementById('tab-option-b').classList.remove('active');
  updateDualCharCount();
}

function hideDualPanel() {
  document.getElementById('dual-panel').classList.add('hidden');
}

function updateDualCharCount() {
  const len = document.getElementById('dual-message').value.length;
  const el  = document.getElementById('dual-char-count');
  if (connectionNote) {
    el.textContent = `${len} / 300`;
    el.classList.toggle('warn', len >= 270 && len <= 300);
    el.classList.toggle('over', len > 300);
    if (len > 300) el.classList.remove('warn');
  } else {
    el.textContent = `${len} chars`;
    el.classList.remove('warn', 'over');
  }
}

async function handleDualCopy() {
  const text = document.getElementById('dual-message').value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch(_) {
    const ta = document.getElementById('dual-message');
    ta.select(); document.execCommand('copy');
  }
  const btn = document.getElementById('dual-copy-btn');
  btn.textContent = '✓ Copied!';
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
  }, 2200);
}

async function handleDualInsert() {
  const text = document.getElementById('dual-message').value;
  if (!text) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab  = tabs[0];
  if (!tab || !tab.url || !tab.url.includes('linkedin.com')) {
    showCurrentStatus('Open a LinkedIn page first.', 'error');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { action: 'insertMessage', text }, (res) => {
    if (chrome.runtime.lastError || !res?.success) {
      showCurrentStatus(res?.error || 'No active text field found on the page.', 'error');
    } else {
      showCurrentStatus('Inserted into LinkedIn!', 'success');
    }
  });
}

async function handleAutoConnect() {
  const text = document.getElementById('generated-message').value;
  await triggerAutoConnect(text, 'auto-connect-btn', 'auto-connect-label', 'auto-connect-spinner', '⚡ Auto-Connect &amp; Fill Note');
}

async function handleDualAutoConnect() {
  const text = document.getElementById('dual-message').value;
  await triggerAutoConnect(text, 'dual-auto-connect-btn', 'dual-auto-connect-label', 'dual-auto-connect-spinner', '⚡ Auto-Connect with Selected Option');
}

async function triggerAutoConnect(noteText, btnId, labelId, spinnerId, defaultLabel) {
  if (!noteText) {
    showCurrentStatus('Generate a note first before connecting.', 'error');
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab  = tabs[0];
  if (!tab || !tab.url || !tab.url.includes('linkedin.com')) {
    showCurrentStatus('Open a LinkedIn profile page first.', 'error');
    return;
  }

  setButtonLoading(btnId, labelId, spinnerId, true, 'Connecting…');
  showCurrentStatus('Opening Connect dialog & inserting note…');

  chrome.tabs.sendMessage(tab.id, { action: 'autoConnect', noteText }, (res) => {
    setButtonLoading(btnId, labelId, spinnerId, false, defaultLabel);
    if (chrome.runtime.lastError || !res?.success) {
      showCurrentStatus(res?.error || chrome.runtime.lastError?.message || 'Could not auto-connect.', 'error');
    } else {
      showCurrentStatus('Note inserted into LinkedIn dialog! Review & hit send.', 'success');
    }
  });
}

// ─── Deep Mode ────────────────────────────────────────────────────────────────
async function handleEnrich() {
  if (isEnriching) return;


  deepProfileJSON = null;
  deepEnrichmentJSON = null;
  resetLayerStatuses();
  document.getElementById('hooks-panel').classList.add('hidden');
  document.getElementById('deep-generate-btn').disabled = true;
  hideMessage();
  clearCurrentStatus();

  isEnriching = true;
  setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'Scraping profile…');
  setLayerStatus(1, 'running', 'Scraping…');

  let rawProfileData;
  try {
    rawProfileData = await sendToBackground({ action: 'scrapeProfile' });
  } catch (err) {
    setLayerStatus(1, 'error', 'Failed');
    showCurrentStatus('Could not scrape. Are you on a LinkedIn profile page?', 'error');
    isEnriching = false;
    setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Scrape + Enrich (L1 + L2)');
    return;
  }

  currentProfile = rawProfileData;
  renderProfileCard(rawProfileData);
  setLayerStatus(1, 'running', 'Parsing…');
  setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', true, 'Running AI layers…');
  showCurrentStatus('Enriching…');

  chrome.runtime.sendMessage({ type: 'RUN_ENRICH', payload: { rawProfileData } }, (response) => {
    isEnriching = false;
    setButtonLoading('enrich-btn', 'enrich-label', 'enrich-spinner', false, 'Scrape + Enrich (L1 + L2)');

    if (chrome.runtime.lastError || !response) {
      setLayerStatus(1, 'error', 'Error');
      setLayerStatus(2, 'error', 'Error');
      showCurrentStatus('Pipeline error. Check your connection.', 'error');
      return;
    }

    if (response.status === 'error') {
      setLayerStatus(1, 'error', 'Error');
      setLayerStatus(2, 'error', 'Error');
      showCurrentStatus(response.error, 'error');
      return;
    }

    setLayerStatus(1, 'done', 'Done');
    setLayerStatus(2, 'done', 'Done');
    deepProfileJSON    = response.profileJSON;
    deepEnrichmentJSON = response.enrichmentJSON;
    renderProfileCard({ name: deepProfileJSON.name, headline: deepProfileJSON.headline, currentCompany: deepProfileJSON.currentCompany });
    renderHooks(deepEnrichmentJSON);
    setLayerStatus(3, '', 'Ready');
    document.getElementById('deep-generate-btn').disabled = false;
    showCurrentStatus('Enrichment done. Hit Generate Message.', 'success');
  });
}

async function handleDeepGenerate() {
  if (isGenerating || !deepProfileJSON || !deepEnrichmentJSON) return;

  isGenerating = true;
  setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', true, 'Writing message…');
  setLayerStatus(3, 'running', 'Writing…');
  showCurrentStatus('Layer 3: writing message…');
  hideMessage();

  const messageType = document.getElementById('message-type').value;
  const tone        = document.getElementById('tone').value;

  chrome.runtime.sendMessage(
    { type: 'RUN_GENERATE', payload: { profileJSON: deepProfileJSON, enrichmentJSON: deepEnrichmentJSON, messageType, tone, connectionNote } },
    async (response) => {
      isGenerating = false;
      setButtonLoading('deep-generate-btn', 'deep-gen-label', 'deep-gen-spinner', false, 'Generate Message (L3)');

      if (chrome.runtime.lastError || !response) {
        setLayerStatus(3, 'error', 'Error');
        showCurrentStatus('Generation failed.', 'error');
        return;
      }

      if (response.status === 'error') {
        setLayerStatus(3, 'error', 'Error');
        showCurrentStatus(response.error, 'error');
        return;
      }

      setLayerStatus(3, 'done', 'Done');
      renderMessage(response.generatedMessage);
      const rem = response.remaining !== undefined ? ` (${response.remaining} messages left today)` : '';
      showCurrentStatus(`Message ready.${rem}`, 'success');

      await Cache.addContact({
        profileUrl: deepProfileJSON.profileUrl || '',
        name:       deepProfileJSON.name || 'Unknown',
        headline:   deepProfileJSON.headline || '',
        company:    deepProfileJSON.currentCompany || '',
        message:    response.generatedMessage,
        timestamp:  Date.now()
      });
    }
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await loadStoredSettings();
  if (s.userApiKey)      document.getElementById('api-key').value          = s.userApiKey;
  if (s.userName)        document.getElementById('user-name').value        = s.userName;
  if (s.userBio)         document.getElementById('user-bio').value         = s.userBio;
  if (s.userTargetRole)  document.getElementById('user-target-role').value = s.userTargetRole;
}

async function handleSaveSettings() {
  const userApiKey     = document.getElementById('api-key').value.trim();
  const userName       = document.getElementById('user-name').value.trim();
  const userBio        = document.getElementById('user-bio').value.trim();
  const userTargetRole = document.getElementById('user-target-role').value.trim();
  await new Promise(resolve => chrome.storage.local.set({ userApiKey, userName, userBio, userTargetRole }, resolve));
  showSettingsStatus('Settings saved!', 'success');
  await checkLicenseStatus();
}

async function handleValidateKey() {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) return;

  const btn = document.getElementById('validate-btn');
  btn.textContent = '…';
  btn.disabled = true;

  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'TEST_API_KEY', payload: { apiKey } }, resolve);
  });

  btn.textContent = 'Test';
  btn.disabled = false;

  const el = document.getElementById('key-validation-status');
  el.classList.remove('hidden');

  if (result && result.valid) {
    el.textContent = '✓ Key works — AI Mode on';
    el.className   = 'key-validation-status valid';
    const s = await loadStoredSettings();
    await new Promise(resolve => chrome.storage.local.set({ ...s, userApiKey: apiKey }, resolve));
    await checkLicenseStatus();
  } else {
    el.textContent = `✗ ${result?.reason || 'Key did not work'}`;
    el.className   = 'key-validation-status invalid';
  }
}

// ─── Pipeline UI ──────────────────────────────────────────────────────────────
function setLayerStatus(layer, status, text) {
  document.getElementById(`l${layer}-dot`).className = `status-dot ${status}`;
  document.getElementById(`l${layer}-text`).textContent = text;
}

function resetLayerStatuses() {
  [1,2].forEach(n => setLayerStatus(n, '', 'Ready'));
  setLayerStatus(3, '', 'Waiting');
}

function renderHooks(enrichmentJSON) {
  const panel = document.getElementById('hooks-panel');
  const list  = document.getElementById('hooks-list');
  list.innerHTML = '';
  const hooks = enrichmentJSON.topHooks?.length
    ? enrichmentJSON.topHooks
    : (enrichmentJSON.companyNews || []).map(n => n.relevance || n.headline).filter(Boolean);
  if (!hooks.length) return;
  hooks.slice(0, 3).forEach(hook => {
    const d = document.createElement('div');
    d.className   = 'hook-item';
    d.textContent = hook;
    list.appendChild(d);
  });
  panel.classList.remove('hidden');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function renderProfileCard(data) {
  const section = document.getElementById('profile-section');
  section.classList.remove('hidden');
  const name = data.name || 'Unknown';
  document.getElementById('profile-avatar').textContent  = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent    = name;
  document.getElementById('profile-headline').textContent = data.headline || '';
  document.getElementById('profile-company').textContent  = data.currentCompany || '';

  renderIcebreakers(data);
}

async function renderIcebreakers(profile) {
  const panel = document.getElementById('icebreaker-panel');
  const container = document.getElementById('icebreaker-chips');
  if (!panel || !container) return;

  container.innerHTML = '';
  const settings = await loadStoredSettings();
  const userText = `${settings.userBio || ''} ${settings.userTargetRole || ''}`.toLowerCase();

  const chips = [];

  const skills = profile.skills || [];
  const sharedSkill = skills.find(s => userText && userText.includes(s.toLowerCase()));
  if (sharedSkill) {
    chips.push({
      icon: '🤝',
      type: 'shared_skill',
      label: `Shared: ${sharedSkill}`,
      sentence: `I noticed our mutual focus on ${sharedSkill}`
    });
  } else if (skills.length > 0) {
    chips.push({
      icon: '🛠️',
      type: 'skill',
      label: `Skill: ${skills[0]}`,
      sentence: `I was really impressed by your expertise in ${skills[0]}`
    });
  }

  if (profile.recentPosts && profile.recentPosts.length > 0) {
    const snippet = profile.recentPosts[0].slice(0, 28);
    chips.push({
      icon: '💬',
      type: 'post',
      label: `Post: "${snippet}…"`,
      sentence: `I really enjoyed your recent post regarding "${profile.recentPosts[0].slice(0, 50)}"`
    });
  }

  if (profile.currentCompany) {
    chips.push({
      icon: '🏢',
      type: 'company',
      label: `At ${profile.currentCompany}`,
      sentence: `I've been closely following the work your team is doing at ${profile.currentCompany}`
    });
  }

  const role = profile.currentTitle || profile.headline;
  if (role) {
    const cleanRole = role.split('|')[0].split('·')[0].trim();
    chips.push({
      icon: '🎯',
      type: 'role',
      label: `Role: ${cleanRole.slice(0, 22)}`,
      sentence: `Your background as ${cleanRole} caught my attention`
    });
  }

  if (profile.educationEntries && profile.educationEntries.length > 0) {
    const edu = String(profile.educationEntries[0]).split('—')[0].trim();
    chips.push({
      icon: '🎓',
      type: 'education',
      label: `${edu.slice(0, 24)}`,
      sentence: `Great to connect with someone from ${edu}`
    });
  }

  if (chips.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  chips.slice(0, 4).forEach(item => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'icebreaker-chip';
    chip.innerHTML = `${item.icon} <span>${esc(item.label)}</span>`;
    chip.addEventListener('click', () => applyIcebreaker(item, chip, profile));
    container.appendChild(chip);
  });

  panel.classList.remove('hidden');
}

function applyIcebreaker(item, chipEl, profile) {
  const isDualActive = !document.getElementById('dual-panel').classList.contains('hidden');
  const targetId = isDualActive ? 'dual-message' : 'generated-message';
  const textarea = document.getElementById(targetId);

  const firstName = profile?.name ? profile.name.trim().split(/\s+/)[0] : 'there';
  const tone = document.getElementById('tone').value;
  const greet = { Formal: `Dear ${firstName},`, Neutral: `Hi ${firstName},`, Casual: `Hey ${firstName}!` }[tone] || `Hi ${firstName},`;

  let currentText = textarea.value.trim();

  if (!currentText) {
    const ask = connectionNote ? 'Would love to connect and exchange ideas.' : 'I would love to connect and exchange ideas with you.\n\nBest,\n' + (document.getElementById('user-name')?.value || '');
    if (connectionNote) {
      textarea.value = `${greet} ${item.sentence} — ${ask}`;
    } else {
      textarea.value = `${greet}\n\n${item.sentence}.\n\n${ask}`;
    }
  } else {
    if (connectionNote) {
      const askMatch = currentText.match(/(Would love to connect.*|I'm exploring.*|Think there's a great.*|I would love to.*)$/i);
      const ask = askMatch ? askMatch[0] : 'Would love to connect.';
      const newMsg = `${greet} ${item.sentence} — ${ask}`;
      textarea.value = newMsg.length > 300 ? newMsg.slice(0, 299) + '…' : newMsg;
    } else {
      const paras = currentText.split('\n\n');
      if (paras.length >= 2) {
        paras[1] = `${item.sentence}.`;
        textarea.value = paras.join('\n\n');
      } else {
        textarea.value = `${greet}\n\n${item.sentence}.\n\n${currentText}`;
      }
    }
  }

  if (isDualActive) {
    updateDualCharCount();
  } else {
    updateCharCount();
  }

  chipEl.classList.add('injected');
  const span = chipEl.querySelector('span');
  if (span) {
    const oldText = span.textContent;
    span.textContent = `✓ Injected!`;
    setTimeout(() => { span.textContent = oldText; }, 1800);
  }

  showCurrentStatus(`Injected "${item.label}" into note!`, 'success');
}

function renderMessage(text) {
  document.getElementById('generated-message').value = text;
  document.getElementById('message-section').classList.remove('hidden');
  updateCharCount();
}

function hideMessage() { document.getElementById('message-section').classList.add('hidden'); }
function updateCharCount() {
  const len = document.getElementById('generated-message').value.length;
  const el  = document.getElementById('char-count');
  if (connectionNote) {
    el.textContent = `${len} / 300`;
    el.classList.toggle('warn', len >= 270 && len <= 300);
    el.classList.toggle('over', len > 300);
    if (len > 300) el.classList.remove('warn');
  } else {
    el.textContent = `${len} chars`;
    el.classList.remove('warn', 'over');
  }
}

async function handleCopy() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch(_) {
    const ta = document.getElementById('generated-message');
    ta.select(); document.execCommand('copy');
  }
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied!';
  btn.classList.add('btn-secondary'); btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
    btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  }, 2200);
}

async function handleInsert() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab  = tabs[0];
  if (!tab || !tab.url || !tab.url.includes('linkedin.com')) {
    showCurrentStatus('Open a LinkedIn page first.', 'error');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { action: 'insertMessage', text }, (res) => {
    if (chrome.runtime.lastError || !res?.success) {
      showCurrentStatus(res?.error || 'No active text field found on the page.', 'error');
    } else {
      showCurrentStatus('Inserted into LinkedIn!', 'success');
    }
  });
}

function showCurrentStatus(msg, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
}

function clearCurrentStatus() {
  const el = document.getElementById('status-message');
  el.classList.add('hidden');
  el.textContent = '';
}

function showSettingsStatus(msg, type = '') {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function setButtonLoading(btnId, labelId, spinnerId, loading, labelText) {
  document.getElementById(btnId).disabled = loading;
  document.getElementById(labelId).innerHTML = labelText;
  document.getElementById(spinnerId).classList.toggle('hidden', !loading);
}

// ─── Recent contacts ──────────────────────────────────────────────────────────
async function renderRecentContacts() {
  const contacts  = await Cache.getContacts();
  const listEl    = document.getElementById('recent-list');
  const emptyEl   = document.getElementById('no-recent');
  const actionsEl = document.getElementById('recent-actions');
  listEl.innerHTML = '';
  if (contacts.length === 0) {
    emptyEl.classList.remove('hidden'); actionsEl.classList.add('hidden'); return;
  }
  emptyEl.classList.add('hidden'); actionsEl.classList.remove('hidden');
  contacts.forEach((c, i) => listEl.appendChild(buildContactCard(c, i)));
}

function buildContactCard(contact, idx) {
  const card = document.createElement('div');
  card.className = 'contact-card';
  const date    = new Date(contact.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const preview = (contact.message || '').substring(0, 110) + ((contact.message || '').length > 110 ? '…' : '');
  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        <div class="contact-name">${esc(contact.name||'Unknown')}</div>
        <div class="contact-meta">${esc(contact.headline||contact.company||'')}</div>
      </div>
      <div class="contact-date">${esc(date)}</div>
    </div>
    <div class="contact-message-preview" id="prev-${idx}">${esc(preview)}</div>
    <div class="contact-message-full hidden" id="full-${idx}">${esc(contact.message||'')}</div>
    <div class="contact-actions">
      <button class="btn-link" id="expand-${idx}">Show full message</button>
      <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
    </div>`;

  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show full message';
  });

  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });

  return card;
}

// ─── Chrome messaging ─────────────────────────────────────────────────────────
function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error('No response from background.')); return; }
      if (!response.success) { reject(new Error(response.error || 'Background returned an error.')); return; }
      if (response.data !== undefined) { resolve(response.data); return; }
      if (response.generatedMessage !== undefined) { resolve(response.generatedMessage); return; }
      reject(new Error('Unexpected response: ' + JSON.stringify(Object.keys(response))));
    });
  });
}

function loadStoredSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['userApiKey','userName','userBio','userTargetRole'], resolve);
  });
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
