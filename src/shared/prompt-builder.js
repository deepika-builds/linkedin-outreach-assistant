const LENGTH_MAP = {
  short:  '50–130 characters (connection request note)',
  medium: '80–200 words (InMail)',
  long:   '200–350 words (cold email style)',
};

const TONE_MAP = {
  warm:   'warm, direct, and conversational — like a message from someone who genuinely did their homework',
  formal: 'professional and formal — polished but not stiff',
  peer:   'peer-to-peer — collegial, casual, treating the recipient as an equal in the same field',
};

const QUICK_ACTION_MAP = {
  shorter:  'Rewrite the message to be significantly shorter while keeping the key hook.',
  longer:   'Expand the message with more specific detail and a clearer call to action.',
  formal:   'Rewrite in a more formal, professional tone.',
  personal: 'Make the message feel more personal and human. Reference a specific detail from their profile.',
  hook:     'Rewrite with a stronger, more surprising opening hook that would make the recipient stop scrolling.',
};

export function buildPrompt(profile, userContext, options) {
  const {
    tone           = 'warm',
    lengthPreference = 'medium',
    messageType    = 'connection',
    draftCount     = 3,
    quickAction    = null,
    existingDraft  = null,
    realtimeNotes  = '',
  } = options;

  const {
    resume         = '',
    voiceSamples   = '',
    pitchStatement = '',
    companyContext = '',
    portfolio      = '',
  } = userContext;

  const system = buildSystemPrompt({ voiceSamples, draftCount, quickAction });
  const user   = buildUserPrompt({
    profile, resume, pitchStatement, companyContext, portfolio,
    tone, lengthPreference, messageType, draftCount,
    quickAction, existingDraft, realtimeNotes,
  });

  return { system, user };
}

function buildSystemPrompt({ voiceSamples, draftCount, quickAction }) {
  const outputInstruction = quickAction
    ? `Return exactly 1 revised message with no extra commentary.`
    : `Return exactly ${draftCount} draft messages separated by the delimiter ---DRAFT--- and nothing else — no preamble, no labels, no explanation after the last draft.`;

  return `You are an expert LinkedIn outreach writer who specialises in messages that get replies.

Your messages:
- Reference specific, real details from the recipient's profile (not generic flattery)
- Never use clichés like "I came across your profile", "I'd love to connect", "hope this finds you well", or "synergies"
- Sound like a real person wrote them, not a template
- Always end with a clear, low-friction call to action
- Stay within the requested length — exceeding it by more than 10% is a failure

${voiceSamples
  ? `The sender's writing style (match this voice closely):\n---\n${voiceSamples.trim()}\n---`
  : ''}

${outputInstruction}`;
}

function buildUserPrompt({
  profile, resume, pitchStatement, companyContext, portfolio,
  tone, lengthPreference, messageType, draftCount,
  quickAction, existingDraft, realtimeNotes,
}) {
  const profileBlock = formatProfile(profile);
  const senderBlock  = formatSender({ resume, pitchStatement, companyContext, portfolio });
  const toneDesc     = TONE_MAP[tone]   || TONE_MAP.warm;
  const lengthDesc   = LENGTH_MAP[lengthPreference] || LENGTH_MAP.medium;

  if (quickAction && existingDraft) {
    const instruction = QUICK_ACTION_MAP[quickAction] || quickAction;
    return `Original message:\n"${existingDraft}"\n\n${instruction}

Maintain tone: ${toneDesc}
Target length: ${lengthDesc}`;
  }

  return `Write ${draftCount} distinct LinkedIn ${formatMessageType(messageType)} messages.

RECIPIENT PROFILE:
${profileBlock}

SENDER CONTEXT:
${senderBlock}

${realtimeNotes ? `ADDITIONAL CONTEXT (high priority — weave this in):\n${realtimeNotes}\n` : ''}
REQUIREMENTS:
- Tone: ${toneDesc}
- Length: ${lengthDesc}
- Each draft must use a different angle or opening hook — they should not feel like variations of the same message
- Do NOT number the drafts or add any labels`;
}

function formatProfile(p) {
  const lines = [
    `Name: ${p.name || 'Unknown'}`,
    p.headline  ? `Headline: ${p.headline}` : null,
    p.location  ? `Location: ${p.location}` : null,
  ];

  if (p.about) {
    lines.push(`About: ${p.about.slice(0, 600)}${p.about.length > 600 ? '…' : ''}`);
  }

  if (p.experience?.length) {
    lines.push('Recent Experience:');
    p.experience.slice(0, 3).forEach(e => {
      const parts = [e.title, e.company, e.duration].filter(Boolean).join(' · ');
      if (parts) lines.push(`  - ${parts}`);
    });
  }

  if (p.education?.length) {
    lines.push('Education:');
    p.education.slice(0, 2).forEach(e => {
      const parts = [e.school, e.degree].filter(Boolean).join(', ');
      if (parts) lines.push(`  - ${parts}`);
    });
  }

  if (p.skills?.length) {
    lines.push(`Skills: ${p.skills.slice(0, 10).join(', ')}`);
  }

  if (p.recentActivity) {
    lines.push(`Recent Activity: ${p.recentActivity.slice(0, 300)}`);
  }

  return lines.filter(Boolean).join('\n');
}

function formatSender({ resume, pitchStatement, companyContext, portfolio }) {
  const parts = [];
  if (resume)         parts.push(`Background:\n${resume.slice(0, 1200)}`);
  if (pitchStatement) parts.push(`Current Focus / Pitch: ${pitchStatement}`);
  if (portfolio)      parts.push(`Portfolio / Work Samples:\n${portfolio.slice(0, 800)}`);
  if (companyContext) parts.push(`Company / Product Context: ${companyContext}`);
  return parts.length ? parts.join('\n\n') : '(no sender context provided)';
}

function formatMessageType(type) {
  return { connection: 'connection request note', inmail: 'InMail', followup: 'follow-up message' }[type] || type;
}

export function parseDrafts(rawText) {
  return rawText
    .split('---DRAFT---')
    .map(s => s.trim())
    .filter(Boolean);
}
