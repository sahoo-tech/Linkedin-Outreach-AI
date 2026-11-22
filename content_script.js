'use strict';

const INJECTED_BTN_ID = 'ai-note-injected-btn';
let injectorObserver   = null;
let scrapeInProgress   = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrapeProfile') {
    scrapeWithObserver().then(profile => {
      sendResponse({ success: true, data: profile });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (msg.action === 'insertMessage') {
    const target = findInsertTarget();
    if (!target) {
      sendResponse({ success: false, error: 'No active text field found on the page.' });
      return;
    }
    fillTarget(target, msg.text);
    sendResponse({ success: true });
    return;
  }

  if (msg.action === 'injectButtonNow') {
    tryInjectButton();
    sendResponse({ success: true });
    return;
  }

  if (msg.action === 'autoConnect') {
    autoConnectAndFill(msg.noteText)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function isProfilePage() {
  return /linkedin\.com\/in\/[^/?#]+/.test(window.location.href);
}

function startInjector() {
  if (injectorObserver) return;

  if (isProfilePage()) scheduleInject();

  injectorObserver = new MutationObserver(() => {
    if (isProfilePage() && !document.getElementById(INJECTED_BTN_ID)) {
      scheduleInject();
    }
  });

  injectorObserver.observe(document.body, { childList: true, subtree: true });
}

let injectTimer = null;
function scheduleInject() {
  clearTimeout(injectTimer);
  injectTimer = setTimeout(() => {
    tryInjectButton();
    if (!document.getElementById(INJECTED_BTN_ID)) {
      setTimeout(tryInjectButton, 1500);
      setTimeout(tryInjectButton, 3500);
    }
  }, 800);
}

function tryInjectButton() {
  if (document.getElementById(INJECTED_BTN_ID)) return;

  const anchor = findButtonAnchor();
  if (!anchor) return;

  const btn       = buildInjectedButton();
  const container = anchor.closest('div, li, section') || anchor.parentElement;
  if (!container) return;

  container.appendChild(btn);
}

function findButtonAnchor() {
  const ariaVariants = [
    'button[aria-label*="connect" i]',
    'button[aria-label*="message" i]',
    'button[aria-label*="follow" i]',
    'button[aria-label*="invite" i]',
  ];
  for (const sel of ariaVariants) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }

  const allButtons = Array.from(document.querySelectorAll('button'));
  const keywords   = /^(connect|message|follow|pending|withdraw)$/i;
  for (const btn of allButtons) {
    const label = (btn.innerText || btn.textContent || '').trim();
    if (keywords.test(label) && btn.offsetParent !== null) return btn;
  }

  const knownZoneSelectors = [
    '.pvs-profile-actions',
    '.pv-top-card-v2-ctas',
    '.pv-top-card--list-bullet',
    '[data-member-id]',
    'section.artdeco-card:first-of-type',
  ];
  for (const sel of knownZoneSelectors) {
    const zone = document.querySelector(sel);
    if (zone) {
      const btn = zone.querySelector('button');
      if (btn && btn.offsetParent !== null) return btn;
    }
  }

  const main = document.querySelector('main');
  if (main) {
    const btn = main.querySelector('button');
    if (btn && btn.offsetParent !== null) return btn;
  }

  return null;
}

function buildInjectedButton() {
  const btn = document.createElement('button');
  btn.id        = INJECTED_BTN_ID;
  btn.innerHTML = '⚡ AI Note';
  btn.setAttribute('aria-label', 'Generate AI outreach note');

  Object.assign(btn.style, {
    display:        'inline-flex',
    alignItems:     'center',
    gap:            '5px',
    padding:        '6px 16px',
    marginLeft:     '8px',
    fontSize:       '14px',
    fontWeight:     '600',
    fontFamily:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color:          '#fff',
    background:     '#0a66c2',
    border:         '1px solid #0a66c2',
    borderRadius:   '16px',
    cursor:         'pointer',
    whiteSpace:     'nowrap',
    verticalAlign:  'middle',
    transition:     'background 0.15s',
    zIndex:         '9999',
  });

  btn.addEventListener('mouseenter', () => { btn.style.background = '#004182'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = '#0a66c2'; });
  btn.addEventListener('click', onInjectedButtonClick);

  return btn;
}

async function onInjectedButtonClick() {
  if (scrapeInProgress) return;
  scrapeInProgress = true;

  const btn = document.getElementById(INJECTED_BTN_ID);
  if (btn) { btn.textContent = '⏳ Scraping…'; btn.disabled = true; }

  try {
    const profile = await scrapeWithObserver();
    chrome.runtime.sendMessage({ action: 'openPopupWithProfile', profile }, () => {
      if (chrome.runtime.lastError) {
        showInPageToast('⚡ Profile scraped! Open the extension popup to see your messages.', 'info');
      }
    });
    showInPageToast('⚡ Profile scraped — open the extension popup for your messages.', 'success');
  } catch (err) {
    showInPageToast('⚠️ Scrape failed: ' + err.message, 'error');
  } finally {
    scrapeInProgress = false;
    if (btn) { btn.textContent = '⚡ AI Note'; btn.disabled = false; }
  }
}

function showInPageToast(text, type) {
  const existing = document.getElementById('ai-note-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'ai-note-toast';
  toast.textContent = text;

  const colors = {
    success: { bg: '#057A55', border: '#046c4a' },
    error:   { bg: '#C81E1E', border: '#b01a1a' },
    info:    { bg: '#0a66c2', border: '#004182' },
  };
  const c = colors[type] || colors.info;

  Object.assign(toast.style, {
    position:     'fixed',
    bottom:       '24px',
    right:        '24px',
    padding:      '12px 18px',
    background:   c.bg,
    border:       `1px solid ${c.border}`,
    borderRadius: '8px',
    color:        '#fff',
    fontSize:     '13px',
    fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight:   '500',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.25)',
    zIndex:       '99999',
    maxWidth:     '340px',
    lineHeight:   '1.4',
    opacity:      '0',
    transition:   'opacity 0.2s',
  });

  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

startInjector();

async function autoConnectAndFill(noteText) {
  const safe = (noteText || '').slice(0, 300);

  const existingTextarea = document.querySelector('textarea[name="message"], textarea#custom-message, .send-invite textarea, [data-placeholder="Add a note…"]');
  if (existingTextarea && isVisible(existingTextarea)) {
    fillReact(existingTextarea, safe);
    showInPageToast('✅ Note filled — review and hit Send!', 'success');
    return;
  }

  const existingDialog = document.querySelector('[role="dialog"], .artdeco-modal, .send-invite, [aria-modal="true"]');
  if (existingDialog && isVisible(existingDialog)) {
    const addNoteBtn = findAddNoteButton(existingDialog);
    if (addNoteBtn) {
      simulateClick(addNoteBtn);
      const noteTextarea = await waitForTextarea(existingDialog, 4000);
      fillReact(noteTextarea, safe);
      showInPageToast('✅ Note filled — review and hit Send!', 'success');
      return;
    }
  }

  let connectBtn = findNativeConnectButton();
  if (!connectBtn) {
    connectBtn = await findConnectInMoreDropdown();
  }

  if (!connectBtn) {
    throw new Error('No "Connect" button found on this profile header. You may already be connected, or connection is restricted on this account.');
  }

  simulateClick(connectBtn);

  const dialog = await waitForDialog(7000);
  await pause(300);

  const textarea = dialog.querySelector('textarea[name="message"], textarea#custom-message, textarea');
  if (textarea && isVisible(textarea)) {
    fillReact(textarea, safe);
    showInPageToast('✅ Note filled — review and hit Send!', 'success');
    return;
  }

  const addNoteBtn = findAddNoteButton(dialog);
  if (!addNoteBtn) {
    throw new Error('Connect dialog opened, but "Add a note" button was not found.');
  }

  simulateClick(addNoteBtn);

  const noteTextarea = await waitForTextarea(dialog, 4000);
  fillReact(noteTextarea, safe);
  showInPageToast('✅ Note filled — review and hit Send!', 'success');
}

function getProfileTopCard() {
  const main = document.querySelector('main, #profile-content, .scaffold-layout__main') || document.body;
  const topCard = main.querySelector('.pv-top-card, section.artdeco-card:first-of-type, .ph5.pb5, section:first-of-type') || main;
  return topCard;
}

function findNativeConnectButton() {
  const topCard = getProfileTopCard();
  const buttons = Array.from(topCard.querySelectorAll('button')).filter(b => b.id !== INJECTED_BTN_ID && isVisible(b));

  const textMatch = buttons.find(btn => {
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    return text === 'connect' || text === 'invite to connect';
  });
  if (textMatch) return textMatch;

  const ariaMatch = buttons.find(btn => {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    return (label.includes('invite') && label.includes('connect')) || label === 'connect';
  });
  if (ariaMatch) return ariaMatch;

  return null;
}

async function findConnectInMoreDropdown() {
  const moreBtn = findMoreButton();
  if (!moreBtn) return null;

  simulateClick(moreBtn);
  await pause(350);

  const dropdownSelectors = [
    '.artdeco-dropdown__content--is-open',
    '.artdeco-dropdown__content',
    '.pvs-overflow-actions-dropdown__content',
    '[role="menu"]',
  ];

  for (const dSel of dropdownSelectors) {
    const dropdown = document.querySelector(dSel);
    if (dropdown && isVisible(dropdown)) {
      const items = Array.from(dropdown.querySelectorAll('div[role="button"], button, li, span, a')).filter(isVisible);
      const connectItem = items.find(el => {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('connect') || aria.includes('connect');
      });
      if (connectItem) return connectItem;
    }
  }
  return null;
}

function findMoreButton() {
  const topCard = getProfileTopCard();
  const buttons = Array.from(topCard.querySelectorAll('button')).filter(b => b.id !== INJECTED_BTN_ID && isVisible(b));

  const textMore = buttons.find(b => {
    const t = (b.innerText || b.textContent || '').trim().toLowerCase();
    return t === 'more';
  });
  if (textMore) return textMore;

  const ariaMore = buttons.find(b => {
    const a = (b.getAttribute('aria-label') || '').toLowerCase();
    return a.includes('more action') || a === 'more';
  });
  if (ariaMore) return ariaMore;

  return null;
}

function findAddNoteButton(scope) {
  const root = scope || document;
  const buttons = Array.from(root.querySelectorAll('button')).filter(isVisible);

  const textMatch = buttons.find(b => {
    const t = (b.innerText || b.textContent || '').trim().toLowerCase();
    return t.includes('add a note') || t === 'add note';
  });
  if (textMatch) return textMatch;

  const ariaMatch = buttons.find(b => {
    const a = (b.getAttribute('aria-label') || '').toLowerCase();
    return a.includes('add a note') || a.includes('add note');
  });
  if (ariaMatch) return ariaMatch;

  const noteMatch = buttons.find(b => {
    const t = (b.innerText || b.textContent || '').trim().toLowerCase();
    return t.includes('note') && !t.includes('without');
  });
  if (noteMatch) return noteMatch;

  return null;
}

function waitForDialog(timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const dialogSelectors = [
      '[role="dialog"]',
      '.artdeco-modal',
      '[aria-modal="true"]',
      '.send-invite',
      '#artdeco-modal-outlet > div',
      '[data-test-modal]',
    ];

    function checkDialog() {
      for (const sel of dialogSelectors) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) return el;
      }
      return null;
    }

    const immediate = checkDialog();
    if (immediate) { resolve(immediate); return; }

    const start = Date.now();
    const interval = setInterval(() => {
      const el = checkDialog();
      if (el) {
        clearInterval(interval);
        resolve(el);
        return;
      }

      const topCard = getProfileTopCard();
      const pendingBtn = Array.from(topCard.querySelectorAll('button')).find(b => {
        const t = (b.innerText || b.textContent || '').trim().toLowerCase();
        return t === 'pending' || t === 'withdraw';
      });
      if (pendingBtn) {
        clearInterval(interval);
        resolve(document.body);
        showInPageToast('ℹ️ Invitation sent directly (LinkedIn did not prompt for note).', 'info');
        return;
      }

      if (Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        reject(new Error('Connection dialog did not appear. Try clicking "Connect" manually, then click Auto-Connect to fill the note.'));
      }
    }, 120);
  });
}

function waitForTextarea(scope, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    function findTA() {
      const root = scope || document;
      const ta = root.querySelector('textarea[name="message"], textarea#custom-message, .send-invite textarea, textarea');
      if (ta && isVisible(ta)) return ta;
      return null;
    }

    const immediate = findTA();
    if (immediate) { resolve(immediate); return; }

    const start = Date.now();
    const interval = setInterval(() => {
      const ta = findTA();
      if (ta) {
        clearInterval(interval);
        resolve(ta);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        reject(new Error('Could not find the note text field in the dialog.'));
      }
    }, 120);
  });
}

function simulateClick(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new MouseEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
}

function fillReact(el, text) {
  el.focus();
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.innerText = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  }
}

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function pause(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeWithObserver() {
  await waitForProfileLandmarks();
  triggerLazyScroll();
  await waitForSectionHydration();
  window.scrollTo({ top: 0, behavior: 'instant' });
  return scrapeProfile();
}

function waitForProfileLandmarks(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function check() {
      const hasH1    = !!document.querySelector('h1');
      const hasSection = document.querySelectorAll('section').length > 0;
      if (hasH1 && hasSection) { resolve(); return; }
      if (Date.now() > deadline) { resolve(); return; }
      requestAnimationFrame(check);
    }

    check();
  });
}

function triggerLazyScroll() {
  const heights = [600, 1200, 1800, 2400, 3000];
  let i = 0;
  const interval = setInterval(() => {
    window.scrollTo({ top: heights[i], behavior: 'smooth' });
    i++;
    if (i >= heights.length) clearInterval(interval);
  }, 220);
}

function waitForSectionHydration(timeoutMs = 5000) {
  return new Promise(resolve => {
    const start = Date.now();
    let lastCount = 0;

    const observer = new MutationObserver(() => {
      const sections = document.querySelectorAll('section');
      if (sections.length > lastCount) {
        lastCount = sections.length;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    function done() {
      observer.disconnect();
      resolve();
    }

    function tick() {
      if (Date.now() - start >= timeoutMs) { done(); return; }
      const sections = document.querySelectorAll('section');
      if (sections.length >= 3 && Date.now() - start > 800) { done(); return; }
      setTimeout(tick, 180);
    }

    tick();
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scrapeProfile() {
  const clean = (str) => (str || '').replace(/\s+/g, ' ').trim();

  // Find section by h2 heading text
  function getSection(heading) {
    return Array.from(document.querySelectorAll('section')).find(s =>
      s.querySelector('h2')?.innerText?.trim().toLowerCase().includes(heading.toLowerCase())
    ) || null;
  }

  // Get all leaf text nodes from a section using P tags and spans
  function getTexts(section) {
    if (!section) return [];
    return Array.from(section.querySelectorAll('p, span'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText))
      .filter(t => t.length > 2 && !/^[·•\s]+$/.test(t));
  }

  // ── NAME ──────────────────────────────────────────────────────────────────
  const name = clean(document.querySelector('h1')?.innerText) ||
               clean(document.title.split('|')[0]);

  // ── HEADLINE ──────────────────────────────────────────────────────────────
  let headline = null;
  const allSections = Array.from(document.querySelectorAll('section'));
  for (const sec of allSections) {
    if (sec.querySelector('h1')) {
      const pTags = Array.from(sec.querySelectorAll('p'))
        .filter(p => p.children.length === 0)
        .map(p => clean(p.innerText))
        .filter(t => t.length > 5 && t !== name);
      // Headline often contains | or @ or job title keywords
      const headlineEl = pTags.find(t =>
        t.includes('|') || t.includes('@') || t.includes('·') ||
        /manager|engineer|analyst|developer|designer|founder|director|lead|specialist|consultant|intern|fellow|trainee/i.test(t)
      ) || pTags[0];
      if (headlineEl) { headline = headlineEl; break; }
    }
  }

  // ── LOCATION ──────────────────────────────────────────────────────────────
  let location = null;
  for (const sec of allSections) {
    if (sec.querySelector('h1')) {
      const pTags = Array.from(sec.querySelectorAll('p'))
        .filter(p => p.children.length === 0)
        .map(p => clean(p.innerText))
        .filter(t => t.length > 3);
      // Location is usually the 2nd or 3rd p tag — looks like "City, Country"
      const locEl = pTags.find(t =>
        t.includes(',') && t.length < 60 && !t.includes('|') && !t.includes('@')
      );
      if (locEl) { location = locEl; break; }
    }
  }

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  let about = null;
  const aboutSection = getSection('About');
  if (aboutSection) {
    const texts = getTexts(aboutSection);
    const longText = texts.find(t => t.length > 80 && !t.includes('Experience') && !t.includes('Skills'));
    if (longText) about = longText;
  }

  // ── EXPERIENCE ────────────────────────────────────────────────────────────
  const experienceEntries = [];
  const expSection = getSection('Experience');
  if (expSection) {
    const pTags = Array.from(expSection.querySelectorAll('p'))
      .filter(p => p.children.length === 0)
      .map(p => clean(p.innerText))
      .filter(t => t.length > 2 && t !== 'Experience');

    // Group into entries of 3-4 lines each
    // Pattern: title, company·type, date, location(optional)
    let i = 0;
    while (i < pTags.length) {
      const title   = pTags[i];
      const company = pTags[i+1] || null;
      const dur     = pTags[i+2] || null;

      // Skip if looks like a date/location (not a title)
      if (/^\d{4}|present|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(title)) {
        i++; continue;
      }

      experienceEntries.push({
        title,
        company:   company ? company.split('·')[0].trim() : null,
        duration:  dur && /\d{4}|present|yr|mos|mo\b/i.test(dur) ? dur : null,
        isCurrent: experienceEntries.length === 0
      });

      // Advance past this entry (title + company + date + optional location = 3-4 lines)
      i += /remote|onsite|on-site|hybrid|india|bengaluru|mumbai|delhi/i.test(pTags[i+3] || '')
        ? 4 : 3;
    }
  }

  const currentEntry   = experienceEntries[0] || null;
  const currentTitle   = currentEntry?.title   || extractFromHeadline(headline, 'title');
  const currentCompany = currentEntry?.company || extractFromHeadline(headline, 'company');
  const pastCompanies  = [...new Set(
    experienceEntries.slice(1).map(e => e.company).filter(Boolean)
  )];

  // ── SKILLS ────────────────────────────────────────────────────────────────
  const skills = [];
  const skillsSection = getSection('Skills');
  if (skillsSection) {
    const texts = getTexts(skillsSection);
    texts.filter(t =>
      t !== 'Skills' &&
      t.length < 60 &&
      t.length > 2 &&
      !/\d{4}|follower|connection|endorsement|endorse|show all|see all|dialog|window|escape/i.test(t)
    ).forEach(t => skills.push(t));
  }

  // ── EDUCATION ─────────────────────────────────────────────────────────────
  const educationEntries = [];
  const eduSection = getSection('Education');
  if (eduSection) {
    const pTags = Array.from(eduSection.querySelectorAll('p'))
      .filter(p => p.children.length === 0)
      .map(p => clean(p.innerText))
      .filter(t => t.length > 2 && t !== 'Education');
    for (let i = 0; i < pTags.length; i += 3) {
      if (pTags[i]) educationEntries.push(
        [pTags[i], pTags[i+1]].filter(Boolean).join(' — ')
      );
    }
  }

  // ── RECENT POSTS ──────────────────────────────────────────────────────────
  const recentPosts = [];
  const activitySection = getSection('Activity');
  if (activitySection) {
    Array.from(activitySection.querySelectorAll('p, span'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText))
      .filter(t =>
        t.length > 40 && t.length < 500 &&
        !/dialog|window|escape|cancel|close|beginning|notifications|premium|people you may|you might/i.test(t)
      )
      .forEach(t => { if (!recentPosts.includes(t)) recentPosts.push(t); });
  }

  return {
    name,
    headline,
    currentTitle,
    currentCompany,
    location,
    about,
    recentPosts:       recentPosts.slice(0, 3),
    experienceEntries: experienceEntries.slice(0, 5),
    pastCompanies:     pastCompanies.slice(0, 4),
    educationEntries:  educationEntries.slice(0, 3),
    skills:            skills.slice(0, 10),
    profileUrl:        window.location.href.split('?')[0],
    rawTitle:          document.title
  };
}

function extractFromHeadline(headline, field) {
  if (!headline) return null;
  const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) return field === 'title' ? atMatch[1].trim() : atMatch[2].trim();
  const pipeMatch = headline.match(/^(.+?)\s*[|·]\s*(.+)$/);
  if (pipeMatch) return field === 'title' ? pipeMatch[1].trim() : pipeMatch[2].trim();
  return null;
}

function findInsertTarget() {
  const selectors = [
    'textarea[name="message"]',
    '.send-invite__custom-message',
    '.msg-form__contenteditable',
    '[data-placeholder="Write a message…"]',
    '[data-placeholder="Add a note…"]',
    'div[contenteditable="true"]',
    'textarea:not([readonly])',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

function fillTarget(el, text) {
  el.focus();
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.innerText = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}