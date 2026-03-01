import { ACTIONS } from '../shared/constants.js';

async function init() {
  const dot      = document.getElementById('status-dot');
  const statusEl = document.getElementById('status-text');
  const tip      = document.getElementById('tip');

  // Check settings / API key status
  try {
    const result = await chrome.runtime.sendMessage({ action: ACTIONS.GET_SETTINGS });
    if (result?.success) {
      const { hasApiKey, resume, pitchStatement } = result.settings;
      if (!hasApiKey) {
        setStatus(dot, statusEl, 'warning', 'API key not set');
        tip.textContent = 'Open Settings to add your Claude API key.';
      } else if (!resume && !pitchStatement) {
        setStatus(dot, statusEl, 'warning', 'Context not configured');
        tip.textContent = 'Add your resume and pitch in Settings for better results.';
      } else {
        setStatus(dot, statusEl, 'ready', 'Ready');
        tip.textContent = 'Visit a LinkedIn profile to generate messages.';
      }
    }
  } catch (_) {
    setStatus(dot, statusEl, 'error', 'Extension error');
    tip.textContent = 'Try reloading the extension.';
  }

  // Button handlers
  document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('open-linkedin').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.linkedin.com' });
  });
}

function setStatus(dot, text, type, msg) {
  dot.className  = `status-dot ${type}`;
  text.textContent = msg;
}

document.addEventListener('DOMContentLoaded', init);
