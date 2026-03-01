import { SYNC_KEYS, LOCAL_KEYS } from './constants.js';

// --- Sync storage (user context, settings) ---

export async function getUserContext() {
  return chrome.storage.sync.get(Object.values(SYNC_KEYS));
}

export async function saveUserContext(updates) {
  return chrome.storage.sync.set(updates);
}

// --- Local storage (API key, sensitive) ---

export async function getApiKey() {
  const result = await chrome.storage.local.get(LOCAL_KEYS.API_KEY);
  return result[LOCAL_KEYS.API_KEY] || null;
}

export async function saveApiKey(key) {
  return chrome.storage.local.set({ [LOCAL_KEYS.API_KEY]: key });
}

export async function clearApiKey() {
  return chrome.storage.local.remove(LOCAL_KEYS.API_KEY);
}
