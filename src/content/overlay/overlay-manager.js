import { ACTIONS, TONE_OPTIONS, LENGTH_OPTIONS, MESSAGE_TYPES, QUICK_ACTIONS } from '../../shared/constants.js';

// CSS is imported as raw text via a ?raw import shim — see content-main.js for how it's bundled.
// Since MV3 content scripts can't do dynamic imports easily, we inline the CSS as a string.
// The actual CSS string is injected by content-main.js which reads the file at build time.
// For un-bundled usage (direct extension load), content-main.js passes OVERLAY_CSS as an argument.

let shadowRoot  = null;
let currentProfile = null;

export function mountOverlay(overlayCSS) {
  if (document.getElementById('lia-host')) return;

  const host = document.createElement('div');
  host.id = 'lia-host';
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = overlayCSS;
  shadowRoot.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'lia-panel';
  panel.innerHTML = buildPanelHTML();
  panel.style.pointerEvents = 'all';
  shadowRoot.appendChild(panel);

  bindEvents();
  restoreCollapsedState();
}

export function unmountOverlay() {
  const host = document.getElementById('lia-host');
  if (host) host.remove();
  shadowRoot = null;
  currentProfile = null;
}

export function updateProfile(profile) {
  currentProfile = profile;
  if (!shadowRoot) return;

  const panel = shadowRoot.getElementById('lia-panel');

  // Update header
  panel.querySelector('#lia-profile-name').textContent = profile.name || 'Unknown';
  panel.querySelector('#lia-profile-headline').textContent = profile.headline || '';
  const meta = [profile.location, profile.connectionDegree].filter(Boolean).join(' · ');
  panel.querySelector('#lia-profile-meta').textContent = meta;

  // Show scrape warning if minimal data
  const warning = panel.querySelector('#lia-scrape-warning');
  if (!profile.name && !profile.headline) {
    warning.classList.add('visible');
  } else {
    warning.classList.remove('visible');
  }

  // Reset results
  clearResults();
}

// ── HTML template ────────────────────────────────────────────────────────────

function buildPanelHTML() {
  const toneOpts    = TONE_OPTIONS.map(o    => `<option value="${o.value}">${o.label}</option>`).join('');
  const lengthOpts  = LENGTH_OPTIONS.map(o  => `<option value="${o.value}">${o.label}</option>`).join('');
  const typeOpts    = MESSAGE_TYPES.map(o   => `<option value="${o.value}">${o.label}</option>`).join('');

  return `
    <button id="lia-toggle" title="Toggle panel">◀</button>
    <button id="lia-close" title="Close">✕</button>

    <div id="lia-header">
      <div id="lia-profile-name">Loading…</div>
      <div id="lia-profile-headline"></div>
      <div id="lia-profile-meta"></div>
    </div>

    <div id="lia-scrape-warning" class="">
      ⚠ Limited profile data detected. You can still generate — or paste profile text in the notes field below.
    </div>

    <div id="lia-setup-prompt">
      <p>Add your Claude API key to start generating personalized outreach messages.</p>
      <button class="lia-settings-link" id="lia-open-settings">Open Settings</button>
    </div>

    <div id="lia-controls">
      <div class="lia-row">
        <span class="lia-label">Type</span>
        <select class="lia-select" id="lia-type">${typeOpts}</select>
      </div>
      <div class="lia-row">
        <span class="lia-label">Tone</span>
        <select class="lia-select" id="lia-tone">${toneOpts}</select>
      </div>
      <div class="lia-row">
        <span class="lia-label">Length</span>
        <select class="lia-select" id="lia-length">${lengthOpts}</select>
        <select class="lia-select" id="lia-count" style="max-width:72px">
          <option value="1">1 draft</option>
          <option value="2">2 drafts</option>
          <option value="3" selected>3 drafts</option>
        </select>
      </div>
      <textarea id="lia-notes" rows="2" placeholder="Real-time context: mutual connection, recent post, conference talk…"></textarea>
      <button id="lia-generate-btn">✦ Generate Message</button>
    </div>

    <div id="lia-results">
      <div id="lia-loading">
        <div class="lia-spinner"></div>
        <span>Crafting your message…</span>
      </div>
      <div id="lia-error"></div>
      <div id="lia-drafts"></div>
    </div>
  `;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  const panel = shadowRoot.getElementById('lia-panel');

  // Toggle collapse
  panel.querySelector('#lia-toggle').addEventListener('click', toggleCollapse);

  // Close (fully unmount)
  panel.querySelector('#lia-close').addEventListener('click', unmountOverlay);

  // Open settings (content scripts can't call openOptionsPage; use getURL instead)
  panel.querySelector('#lia-open-settings')?.addEventListener('click', () => {
    window.open(chrome.runtime.getURL('src/options/options.html'), '_blank');
  });

  // Generate
  panel.querySelector('#lia-generate-btn').addEventListener('click', handleGenerate);

  // Restore saved tone/length defaults
  loadDefaults();
}

// ── Collapse / restore ────────────────────────────────────────────────────────

function toggleCollapse() {
  const panel  = shadowRoot.getElementById('lia-panel');
  const toggle = shadowRoot.getElementById('lia-toggle');
  const collapsed = panel.classList.toggle('lia-collapsed');
  toggle.textContent = collapsed ? '▶' : '◀';
  sessionStorage.setItem('lia-collapsed', collapsed ? '1' : '0');
}

function restoreCollapsedState() {
  if (sessionStorage.getItem('lia-collapsed') === '1') {
    const panel  = shadowRoot.getElementById('lia-panel');
    const toggle = shadowRoot.getElementById('lia-toggle');
    panel.classList.add('lia-collapsed');
    toggle.textContent = '▶';
  }
}

// ── Defaults from storage ─────────────────────────────────────────────────────

async function loadDefaults() {
  try {
    const result = await chrome.runtime.sendMessage({ action: ACTIONS.GET_SETTINGS });
    if (!result?.success) return;

    const { settings } = result;
    const panel = shadowRoot.getElementById('lia-panel');

    if (settings.tonePreference) {
      const sel = panel.querySelector('#lia-tone');
      if (sel) sel.value = settings.tonePreference;
    }
    if (settings.lengthPreference) {
      const sel = panel.querySelector('#lia-length');
      if (sel) sel.value = settings.lengthPreference;
    }
    if (settings.draftCount) {
      const sel = panel.querySelector('#lia-count');
      if (sel) sel.value = String(settings.draftCount);
    }

    // Show/hide setup prompt
    const setupPrompt = panel.querySelector('#lia-setup-prompt');
    const controls    = panel.querySelector('#lia-controls');
    if (!settings.hasApiKey) {
      setupPrompt.classList.add('visible');
      controls.style.display = 'none';
    } else {
      setupPrompt.classList.remove('visible');
      controls.style.display = '';
    }
  } catch (_) { /* service worker may not be ready yet */ }
}

// ── Generate flow ─────────────────────────────────────────────────────────────

async function handleGenerate() {
  const panel = shadowRoot.getElementById('lia-panel');

  const options = {
    messageType:      panel.querySelector('#lia-type').value,
    tone:             panel.querySelector('#lia-tone').value,
    lengthPreference: panel.querySelector('#lia-length').value,
    draftCount:       Number(panel.querySelector('#lia-count').value),
    realtimeNotes:    panel.querySelector('#lia-notes').value.trim(),
  };

  setLoading(true);
  clearResults();

  try {
    const response = await chrome.runtime.sendMessage({
      action:  ACTIONS.GENERATE_MESSAGE,
      profile: currentProfile || {},
      options,
    });

    if (!response?.success) throw new Error(response?.error || 'Generation failed');
    renderDrafts(response.drafts, options);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ── Quick action ──────────────────────────────────────────────────────────────

async function handleQuickAction(quickAction, draftIndex) {
  const panel   = shadowRoot.getElementById('lia-panel');
  const draftEl = shadowRoot.querySelector(`#lia-draft-text-${draftIndex}`);
  if (!draftEl) return;

  const existingDraft = draftEl.value;
  const options = {
    quickAction,
    existingDraft,
    draftCount: 1,
    tone:             panel.querySelector('#lia-tone').value,
    lengthPreference: panel.querySelector('#lia-length').value,
  };

  // Disable all action buttons on this draft while loading
  const btns = shadowRoot.querySelectorAll(`#lia-draft-actions-${draftIndex} .lia-action-btn`);
  btns.forEach(b => { b.disabled = true; });

  try {
    const response = await chrome.runtime.sendMessage({
      action:  ACTIONS.QUICK_ACTION,
      profile: currentProfile || {},
      options,
    });

    if (!response?.success) throw new Error(response?.error || 'Failed');
    draftEl.value = response.draft;
    updateCharCount(draftIndex, response.draft);
  } catch (err) {
    showError(err.message);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function renderDrafts(drafts, options) {
  const container = shadowRoot.getElementById('lia-drafts');
  if (!drafts?.length) { showError('No drafts were returned. Try again.'); return; }

  const tabBar = document.createElement('div');
  tabBar.className = 'lia-tab-bar';

  drafts.forEach((draft, i) => {
    const tabBtn = document.createElement('button');
    tabBtn.className = 'lia-tab-btn' + (i === 0 ? ' active' : '');
    tabBtn.textContent = `Draft ${i + 1}`;
    tabBtn.dataset.idx = i;
    tabBtn.addEventListener('click', () => activateTab(i, drafts.length));
    tabBar.appendChild(tabBtn);
  });

  container.appendChild(tabBar);

  drafts.forEach((draft, i) => {
    const panel = document.createElement('div');
    panel.className = 'lia-draft-panel' + (i === 0 ? ' active' : '');
    panel.id = `lia-draft-panel-${i}`;
    panel.innerHTML = buildDraftPanelHTML(draft, i);
    container.appendChild(panel);

    // Char count on input
    const textarea = panel.querySelector(`#lia-draft-text-${i}`);
    textarea.addEventListener('input', () => updateCharCount(i, textarea.value));

    // Copy button
    panel.querySelector(`#lia-copy-${i}`).addEventListener('click', () => copyDraft(i));

    // Quick action buttons
    panel.querySelectorAll('.lia-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleQuickAction(btn.dataset.action, i));
    });
  });
}

function buildDraftPanelHTML(draft, i) {
  const quickActionBtns = QUICK_ACTIONS.map(a =>
    `<button class="lia-action-btn" data-action="${a.value}">${a.label}</button>`
  ).join('');

  const charCount = draft.length;

  return `
    <textarea id="lia-draft-text-${i}" class="lia-draft-text">${escapeHtml(draft)}</textarea>
    <div class="lia-char-count" id="lia-char-count-${i}">${charCount} chars</div>
    <div class="lia-actions" id="lia-draft-actions-${i}">
      <button class="lia-copy-btn" id="lia-copy-${i}">Copy</button>
      ${quickActionBtns}
    </div>
  `;
}

function activateTab(idx, total) {
  for (let i = 0; i < total; i++) {
    const tab   = shadowRoot.querySelector(`.lia-tab-btn[data-idx="${i}"]`);
    const panel = shadowRoot.getElementById(`lia-draft-panel-${i}`);
    tab?.classList.toggle('active',   i === idx);
    panel?.classList.toggle('active', i === idx);
  }
}

function copyDraft(idx) {
  const textarea = shadowRoot.querySelector(`#lia-draft-text-${idx}`);
  const btn      = shadowRoot.querySelector(`#lia-copy-${idx}`);
  if (!textarea) return;

  navigator.clipboard.writeText(textarea.value).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    showError('Could not copy to clipboard. Please copy the text manually.');
  });
}

function updateCharCount(idx, text) {
  const el = shadowRoot.querySelector(`#lia-char-count-${idx}`);
  if (el) el.textContent = `${text.length} chars`;
}

// ── State helpers ─────────────────────────────────────────────────────────────

function setLoading(on) {
  const loading = shadowRoot.getElementById('lia-loading');
  const btn     = shadowRoot.getElementById('lia-generate-btn');
  loading?.classList.toggle('visible', on);
  if (btn) btn.disabled = on;
}

function clearResults() {
  const drafts = shadowRoot.getElementById('lia-drafts');
  const error  = shadowRoot.getElementById('lia-error');
  if (drafts) drafts.innerHTML = '';
  if (error)  { error.innerHTML = ''; error.classList.remove('visible'); }
}

function showError(msg) {
  const error = shadowRoot.getElementById('lia-error');
  if (!error) return;

  const isApiKey = /api key/i.test(msg);
  error.innerHTML = isApiKey
    ? `${escapeHtml(msg)} — <a id="lia-err-settings">Open Settings</a>`
    : escapeHtml(msg);
  error.classList.add('visible');

  error.querySelector('#lia-err-settings')?.addEventListener('click', () => {
    window.open(chrome.runtime.getURL('src/options/options.html'), '_blank');
  });

}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
