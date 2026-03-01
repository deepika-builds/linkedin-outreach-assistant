import { ACTIONS, MODEL_ID } from '../shared/constants.js';
import { getUserContext, getApiKey, saveApiKey, saveUserContext } from '../shared/storage.js';
import { buildPrompt, parseDrafts } from '../shared/prompt-builder.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ── Message Router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true; // keep port open for async response
});

async function handleMessage(message) {
  switch (message.action) {
    case ACTIONS.GENERATE_MESSAGE:
      return generateMessage(message.profile, message.options);
    case ACTIONS.QUICK_ACTION:
      return quickAction(message.profile, message.options);
    case ACTIONS.VALIDATE_API_KEY:
      return validateApiKey(message.apiKey);
    case ACTIONS.SAVE_SETTINGS:
      return saveSettings(message.settings);
    case ACTIONS.GET_SETTINGS:
      return getSettings();
    case ACTIONS.EXTRACT_FROM_PDF:
      return extractFromPdf(message.base64, message.mediaType);
    case ACTIONS.FETCH_AND_SUMMARIZE:
      return fetchAndSummarize(message.url);
    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      return { success: true };
    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

// ── Generation ──────────────────────────────────────────────────────────────

async function generateMessage(profile, options = {}) {
  const apiKey     = await getApiKey();
  if (!apiKey) throw new Error('API key not configured. Open the extension settings to add your Claude API key.');

  const userContext = await getUserContext();

  // Merge stored defaults with per-call overrides
  const mergedOptions = {
    tone:             userContext.tonePreference   || 'warm',
    lengthPreference: userContext.lengthPreference || 'medium',
    draftCount:       Number(userContext.draftCount) || 3,
    messageType:      'connection',
    realtimeNotes:    '',
    ...options,
  };

  const { system, user } = buildPrompt(profile, userContext, mergedOptions);
  const rawText = await callClaude(apiKey, system, user, 1200);
  const drafts  = parseDrafts(rawText);

  return { success: true, drafts };
}

async function quickAction(profile, options = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('API key not configured.');

  const userContext = await getUserContext();

  const mergedOptions = {
    tone:             userContext.tonePreference   || 'warm',
    lengthPreference: userContext.lengthPreference || 'medium',
    draftCount:       1,
    ...options,
  };

  const { system, user } = buildPrompt(profile, userContext, mergedOptions);
  const rawText = await callClaude(apiKey, system, user, 600);
  const drafts  = parseDrafts(rawText);

  return { success: true, draft: drafts[0] || rawText.trim() };
}

// ── Claude API ──────────────────────────────────────────────────────────────

async function callClaude(apiKey, system, userContent, maxTokens = 1024) {
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key':                               apiKey,
      'anthropic-version':                       '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type':                            'application/json',
    },
    body: JSON.stringify({
      model:      MODEL_ID,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    let errMsg = `API error ${response.status}`;
    try {
      const body = await response.json();
      errMsg = body?.error?.message || errMsg;
    } catch (_) { /* ignore */ }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

// ── Settings ────────────────────────────────────────────────────────────────

async function saveSettings({ apiKey, ...syncFields }) {
  const promises = [];
  if (apiKey !== undefined) promises.push(saveApiKey(apiKey));
  if (Object.keys(syncFields).length) promises.push(saveUserContext(syncFields));
  await Promise.all(promises);
  return { success: true };
}

async function getSettings() {
  const [userContext, apiKey] = await Promise.all([getUserContext(), getApiKey()]);
  return { success: true, settings: { ...userContext, hasApiKey: !!apiKey } };
}

async function validateApiKey(apiKey) {
  if (!apiKey?.startsWith('sk-ant-')) {
    return { success: false, error: 'Key must start with sk-ant-' };
  }
  try {
    await callClaude(apiKey, 'You are a test assistant.', 'Reply with the single word OK.', 10);
    await saveApiKey(apiKey);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── PDF extraction ───────────────────────────────────────────────────────────

async function extractFromPdf(base64, mediaType = 'application/pdf') {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('API key not configured.');

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key':                               apiKey,
      'anthropic-version':                       '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type':                            'application/json',
    },
    body: JSON.stringify({
      model:      MODEL_ID,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Extract this resume into a concise professional summary. Include: name, current/recent roles and companies, key skills and domains, notable achievements or projects. Plain text only, no markdown. Keep it under 1200 characters.',
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return { success: true, text: data.content?.[0]?.text || '' };
}

// ── URL fetch & summarize ────────────────────────────────────────────────────

async function fetchAndSummarize(url) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('API key not configured.');

  // GitHub profile: use the API for clean structured data
  const githubMatch = url.match(/github\.com\/([^/?#]+)\/?$/);
  if (githubMatch) {
    return fetchGithubProfile(apiKey, githubMatch[1]);
  }

  // General URL: fetch HTML and strip to plain text
  let pageText;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    pageText = stripHtml(html).slice(0, 4000);
  } catch (err) {
    throw new Error(`Could not fetch ${url}: ${err.message}`);
  }

  const summary = await callClaude(
    apiKey,
    'You extract professional portfolio information from web page text.',
    `From this page content, extract a concise portfolio summary. Include: what they build/have built, notable projects, technologies used, roles held. Plain text only, no markdown, under 800 characters.\n\nPage content:\n${pageText}`,
    600,
  );

  return { success: true, text: summary };
}

async function fetchGithubProfile(apiKey, username) {
  const [profileRes, reposRes] = await Promise.all([
    fetch(`https://api.github.com/users/${username}`),
    fetch(`https://api.github.com/users/${username}/repos?sort=stars&per_page=6`),
  ]);

  const profile = profileRes.ok ? await profileRes.json() : {};
  const repos   = reposRes.ok  ? await reposRes.json()   : [];

  const repoList = repos
    .filter(r => !r.fork)
    .map(r => `${r.name}${r.description ? ': ' + r.description : ''} (★${r.stargazers_count})`)
    .join('; ');

  const raw = [
    profile.name    && `Name: ${profile.name}`,
    profile.bio     && `Bio: ${profile.bio}`,
    profile.company && `Company: ${profile.company}`,
    profile.location && `Location: ${profile.location}`,
    profile.blog    && `Website: ${profile.blog}`,
    repoList        && `Top repos: ${repoList}`,
  ].filter(Boolean).join('\n');

  const summary = await callClaude(
    apiKey,
    'You summarize GitHub profiles for use in professional outreach context.',
    `Summarize this GitHub profile into a concise portfolio description. Focus on what they build, their technical strengths, and notable projects. Plain text, no markdown, under 600 characters.\n\n${raw}`,
    400,
  );

  return { success: true, text: summary };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
