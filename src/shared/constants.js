// Message action names
export const ACTIONS = {
  GENERATE_MESSAGE:      'GENERATE_MESSAGE',
  QUICK_ACTION:          'QUICK_ACTION',
  SAVE_SETTINGS:         'SAVE_SETTINGS',
  GET_SETTINGS:          'GET_SETTINGS',
  VALIDATE_API_KEY:      'VALIDATE_API_KEY',
  EXTRACT_FROM_PDF:      'EXTRACT_FROM_PDF',
  FETCH_AND_SUMMARIZE:   'FETCH_AND_SUMMARIZE',
};

// chrome.storage.sync keys
export const SYNC_KEYS = {
  RESUME:           'resume',
  VOICE_SAMPLES:    'voiceSamples',
  PITCH_STATEMENT:  'pitchStatement',
  TONE_PREFERENCE:  'tonePreference',
  LENGTH_PREFERENCE:'lengthPreference',
  DRAFT_COUNT:      'draftCount',
  COMPANY_CONTEXT:  'companyContext',
  PORTFOLIO:        'portfolio',
};

// chrome.storage.local keys
export const LOCAL_KEYS = {
  API_KEY: 'claudeApiKey',
};

export const MODEL_ID = 'claude-sonnet-4-6';

export const TONE_OPTIONS = [
  { value: 'warm',    label: 'Warm & Direct' },
  { value: 'formal',  label: 'Formal' },
  { value: 'peer',    label: 'Peer-to-Peer' },
];

export const LENGTH_OPTIONS = [
  { value: 'short',  label: 'Short (< 150 chars)' },
  { value: 'medium', label: 'Medium (InMail)' },
  { value: 'long',   label: 'Long (Cold Email)' },
];

export const MESSAGE_TYPES = [
  { value: 'connection', label: 'Connection Request' },
  { value: 'inmail',     label: 'InMail' },
  { value: 'followup',   label: 'Follow-Up' },
];

export const QUICK_ACTIONS = [
  { value: 'shorter',    label: 'Shorter' },
  { value: 'longer',     label: 'Longer' },
  { value: 'formal',     label: 'More Formal' },
  { value: 'personal',   label: 'More Personal' },
  { value: 'hook',       label: 'Add Specific Hook' },
];
