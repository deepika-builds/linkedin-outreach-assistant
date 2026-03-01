import { ACTIONS, SYNC_KEYS } from '../shared/constants.js';

// ── Field registry ────────────────────────────────────────────────────────────

const FIELDS = [
  { id: 'resume',          syncKey: SYNC_KEYS.RESUME,            maxLen: 2000 },
  { id: 'pitch',           syncKey: SYNC_KEYS.PITCH_STATEMENT,   maxLen: 400  },
  { id: 'voice-samples',   syncKey: SYNC_KEYS.VOICE_SAMPLES,     maxLen: 3000 },
  { id: 'portfolio',       syncKey: SYNC_KEYS.PORTFOLIO,         maxLen: 1500 },
  { id: 'company-context', syncKey: SYNC_KEYS.COMPANY_CONTEXT,   maxLen: 600  },
  { id: 'tone-default',    syncKey: SYNC_KEYS.TONE_PREFERENCE                  },
  { id: 'length-default',  syncKey: SYNC_KEYS.LENGTH_PREFERENCE                },
  { id: 'draft-count',     syncKey: SYNC_KEYS.DRAFT_COUNT                      },
];

// ── Load saved values ─────────────────────────────────────────────────────────

async function loadSettings() {
  const result = await chrome.runtime.sendMessage({ action: ACTIONS.GET_SETTINGS });
  if (!result?.success) return;

  const { settings } = result;

  // API key indicator — we never show the actual key, just whether one is set
  if (settings.hasApiKey) {
    const input = document.getElementById('api-key');
    input.placeholder = '••••••••••••••••••••••••• (saved)';
    showApiStatus('success', 'API key is saved and validated.');
  }

  // Populate form fields
  for (const { id, syncKey, maxLen } of FIELDS) {
    const el = document.getElementById(id);
    if (!el || !settings[syncKey]) continue;
    el.value = settings[syncKey];
    if (maxLen) updateCharCount(id, settings[syncKey]);
  }
}

// ── Char counters ─────────────────────────────────────────────────────────────

function updateCharCount(fieldId, value) {
  const countEl = document.getElementById(`${fieldId}-count`);
  if (!countEl) return;
  const max = countEl.textContent.split('/')[1]?.trim();
  countEl.textContent = `${value.length} / ${max}`;
}

function bindCharCounters() {
  for (const { id, maxLen } of FIELDS) {
    if (!maxLen) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input', () => updateCharCount(id, el.value));
  }
}

// ── API key validation ────────────────────────────────────────────────────────

function bindValidate() {
  const btn   = document.getElementById('validate-btn');
  const input = document.getElementById('api-key');

  btn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { showApiStatus('error', 'Please paste your API key first.'); return; }

    btn.disabled = true;
    btn.textContent = 'Validating…';
    showApiStatus('loading', 'Testing your key with the Claude API…');

    const result = await chrome.runtime.sendMessage({
      action: ACTIONS.VALIDATE_API_KEY,
      apiKey: key,
    });

    btn.disabled = false;
    btn.textContent = 'Validate';

    if (result?.success) {
      input.value = '';
      input.placeholder = '••••••••••••••••••••••••• (saved)';
      showApiStatus('success', 'API key validated and saved!');
    } else {
      showApiStatus('error', result?.error || 'Validation failed. Check your key and try again.');
    }
  });
}

function showApiStatus(type, msg) {
  const el = document.getElementById('api-status');
  el.textContent = msg;
  el.className = `status-msg ${type}`;
}

// ── Save settings ─────────────────────────────────────────────────────────────

function bindSave() {
  document.getElementById('save-btn').addEventListener('click', save);
}

async function save() {
  const syncFields = {};
  for (const { id, syncKey } of FIELDS) {
    const el = document.getElementById(id);
    if (el) syncFields[syncKey] = el.value;
  }

  const result = await chrome.runtime.sendMessage({
    action: ACTIONS.SAVE_SETTINGS,
    settings: syncFields,
  });

  if (result?.success) {
    const status = document.getElementById('save-status');
    status.textContent = '✓ Saved';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2500);
  }
}

// ── Auto-save on change (debounced) ──────────────────────────────────────────

let saveTimer = null;
function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}

function bindAutoSave() {
  for (const { id } of FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const event = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(event, scheduleAutoSave);
  }
}

// ── File upload ───────────────────────────────────────────────────────────────

function bindFileUpload() {
  const uploadBtn  = document.getElementById('upload-btn');
  const fileInput  = document.getElementById('resume-file');
  const resumeArea = document.getElementById('resume');
  const status     = document.getElementById('upload-status');

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = ''; // reset so the same file can be re-selected

    const isTxt = file.type === 'text/plain' || file.name.endsWith('.txt');
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');

    if (!isTxt && !isPdf) {
      showUploadStatus('error', 'Only .pdf and .txt files are supported.');
      return;
    }

    if (isTxt) {
      const text = await file.text();
      resumeArea.value = text.slice(0, 2000);
      updateCharCount('resume', resumeArea.value);
      showUploadStatus('success', 'Text file loaded.');
      scheduleAutoSave();
      return;
    }

    // PDF — send to Claude for extraction
    showUploadStatus('loading', 'Extracting resume from PDF…');
    uploadBtn.disabled = true;

    try {
      const base64 = await fileToBase64(file);
      const result = await chrome.runtime.sendMessage({
        action:    ACTIONS.EXTRACT_FROM_PDF,
        base64,
        mediaType: 'application/pdf',
      });
      if (!result.success) throw new Error(result.error);

      resumeArea.value = result.text.slice(0, 2000);
      updateCharCount('resume', resumeArea.value);
      showUploadStatus('success', 'Resume extracted — review and edit below.');
      scheduleAutoSave();
    } catch (err) {
      showUploadStatus('error', err.message || 'Extraction failed.');
    } finally {
      uploadBtn.disabled = false;
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]); // strip "data:...;base64,"
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showUploadStatus(type, msg) {
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.className = `status-msg ${type}`;
}

// ── URL fetch ─────────────────────────────────────────────────────────────────

function bindUrlFetch() {
  const portfolioArea = document.getElementById('portfolio');
  const fetchStatus   = document.getElementById('fetch-status');

  document.querySelectorAll('.btn-fetch').forEach(btn => {
    btn.addEventListener('click', async () => {
      const input = btn.previousElementSibling;
      const url   = input.value.trim();
      if (!url) { showFetchStatus('error', 'Paste a URL first.'); return; }

      btn.disabled    = true;
      btn.textContent = '…';
      showFetchStatus('loading', `Fetching ${new URL(url).hostname}…`);

      try {
        const result = await chrome.runtime.sendMessage({
          action: ACTIONS.FETCH_AND_SUMMARIZE,
          url,
        });
        if (!result.success) throw new Error(result.error);

        // Append to existing portfolio text (with separator if needed)
        const existing = portfolioArea.value.trim();
        portfolioArea.value = existing
          ? `${existing}\n\n---\n${result.text}`
          : result.text;
        portfolioArea.value = portfolioArea.value.slice(0, 1500);
        updateCharCount('portfolio', portfolioArea.value);
        showFetchStatus('success', `Fetched and summarized ${new URL(url).hostname}.`);
        scheduleAutoSave();
      } catch (err) {
        showFetchStatus('error', err.message || 'Fetch failed.');
      } finally {
        btn.disabled    = false;
        btn.textContent = 'Fetch';
      }
    });
  });
}

function showFetchStatus(type, msg) {
  const el = document.getElementById('fetch-status');
  el.textContent = msg;
  el.className = `status-msg ${type}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindCharCounters();
  bindValidate();
  bindSave();
  bindAutoSave();
  bindFileUpload();
  bindUrlFetch();
});
