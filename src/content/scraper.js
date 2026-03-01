// LinkedIn profile DOM scraper
// Selector priority: aria-label on <section> → id/data attrs → heading text → structural position
// Each field has an ordered array of extractors; first non-null, non-empty result wins.

// ── Utilities ────────────────────────────────────────────────────────────────

function tryExtract(extractors) {
  for (const fn of extractors) {
    try {
      const result = fn();
      if (result == null) continue;
      if (typeof result === 'string' && result.trim().length === 0) continue;
      if (Array.isArray(result) && result.length === 0) continue;
      return typeof result === 'string' ? result.trim() : result;
    } catch (_) { /* skip broken extractor */ }
  }
  return null;
}

/**
 * Find a section element labelled with the given keyword.
 * Strategies tried in order of reliability across LinkedIn layouts.
 */
function findSection(keyword) {
  const kw = keyword.toLowerCase();
  const main = document.querySelector('main') || document.body;

  // 1. <section aria-label="Experience"> — current LinkedIn a11y standard
  const byAriaSection = [...document.querySelectorAll('section[aria-label]')]
    .find(s => s.getAttribute('aria-label').toLowerCase().includes(kw));
  if (byAriaSection) return byAriaSection;

  // 2. Any element with a matching id
  const byId = [...document.querySelectorAll('[id]')]
    .find(el => el.id.toLowerCase().includes(kw));
  if (byId) return byId.closest('section') || byId;

  // 3. Find by h2 heading text — most reliable fallback for profiles without aria-labels.
  //    After locating the h2, walk UP until we find a container that owns the list items too.
  const byH2 = [...main.querySelectorAll('h2')]
    .find(h => h.innerText?.trim().toLowerCase() === kw ||
               h.innerText?.trim().toLowerCase().startsWith(kw));
  if (byH2) {
    // Prefer explicit section ancestor
    const sectionAncestor = byH2.closest('section');
    if (sectionAncestor) return sectionAncestor;
    // Otherwise walk up until we hit a container that has both the heading and a list
    let node = byH2.parentElement;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      if (node.querySelector('ul > li') || node.querySelector('ol > li')) return node;
      node = node.parentElement;
    }
    return byH2.parentElement;
  }

  // 4. <div aria-label="..."> fallback
  const byAriaDiv = [...document.querySelectorAll('div[aria-label]')]
    .find(d => d.getAttribute('aria-label').toLowerCase().includes(kw));
  return byAriaDiv || null;
}

/** All aria-hidden="true" span texts inside an element, trimmed and non-empty */
function ariaHiddenTexts(el) {
  return [...(el?.querySelectorAll('span[aria-hidden="true"]') || [])]
    .map(s => s.innerText?.trim())
    .filter(Boolean);
}

/**
 * Return all top-level <li> elements that appear in document order
 * AFTER the h2 labelled `startKeyword` and BEFORE the next sibling h2.
 * This works regardless of how deeply nested or differently structured
 * LinkedIn's section containers are.
 */
function findItemsBetweenH2s(startKeyword) {
  const main = document.querySelector('main') || document.body;
  // Only consider h2s that look like section headings (short, no numbers)
  const sectionH2s = [...main.querySelectorAll('h2')].filter(h => {
    const t = h.innerText?.trim();
    return t && t.length > 1 && t.length < 60;
  });

  const startIdx = sectionH2s.findIndex(
    h => h.innerText.trim().toLowerCase() === startKeyword.toLowerCase()
  );
  if (startIdx === -1) return [];

  const startH2 = sectionH2s[startIdx];
  const endH2   = sectionH2s[startIdx + 1] || null; // null = no upper bound

  const FOLLOWING  = Node.DOCUMENT_POSITION_FOLLOWING;
  const PRECEDING  = Node.DOCUMENT_POSITION_PRECEDING;

  return [...main.querySelectorAll('li')]
    .filter(li => {
      if (!li.querySelector('span[aria-hidden="true"]')) return false;
      // Skip lis that are nested inside another li
      if (li.parentElement?.closest('li')) return false;
      const afterStart = !!(startH2.compareDocumentPosition(li) & FOLLOWING);
      const beforeEnd  = !endH2 || !!(endH2.compareDocumentPosition(li) & PRECEDING);
      return afterStart && beforeEnd;
    });
}

// ── Field Extractors ─────────────────────────────────────────────────────────

const EXTRACTORS = {

  // ── Name ──────────────────────────────────────────────────────────────────
  name: [
    // Standard layout: h1 in main
    () => {
      const h1 = document.querySelector('h1');
      if (!h1) return null;
      const visibleSpan = h1.querySelector('span[aria-hidden="true"]');
      return (visibleSpan || h1).innerText?.split('\n')[0]?.trim() || null;
    },
    // Creator/premium layouts omit h1 — fall back to og:title meta tag
    // LinkedIn always sets it to "First Last | LinkedIn"
    () => {
      const og = document.querySelector('meta[property="og:title"]')?.content;
      if (!og) return null;
      const name = og.split('|')[0].trim();
      return name.length > 0 ? name : null;
    },
    // Last resort: page <title> has the same "Name | LinkedIn" format
    () => {
      const title = document.title?.split('|')[0]?.trim();
      return title && title !== 'LinkedIn' ? title : null;
    },
  ],

  // ── Headline ──────────────────────────────────────────────────────────────
  headline: [
    () => document.querySelector('[data-field="headline"]')?.innerText?.trim(),
    // Walk forward from h1 in document order — first short single-line text wins
    () => {
      const h1 = document.querySelector('h1');
      if (!h1) return null;
      const candidates = [...document.querySelectorAll('main div, main span')]
        .filter(el => {
          if (!(h1.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
          if (el.children.length > 4) return false; // skip containers
          const text = el.innerText?.trim();
          return text && text.length >= 8 && text.length <= 250 && !text.includes('\n');
        });
      return candidates[0]?.innerText?.trim() || null;
    },
    // og:description often contains the headline ("Title at Company | LinkedIn")
    () => {
      const desc = document.querySelector('meta[name="description"]')?.content;
      if (!desc) return null;
      // Strip the common "View X's profile…" prefix LinkedIn adds
      const clean = desc.replace(/^View .+?'s profile on LinkedIn[.,]?\s*/i, '').trim();
      return clean.length >= 8 ? clean.slice(0, 200) : null;
    },
  ],

  // ── Location ──────────────────────────────────────────────────────────────
  location: [
    () => document.querySelector('[data-field="location_input"]')?.innerText?.trim(),
    // aria-label button/link explicitly for location
    () => {
      const btn = [...document.querySelectorAll('button, a')]
        .find(el => el.getAttribute('aria-label')?.toLowerCase().includes('location'));
      return btn?.innerText?.trim() || null;
    },
    // Span near the top of the profile that looks like a LinkedIn location string.
    // LinkedIn locations: "San Francisco Bay Area", "Seattle, WA", "Greater NYC Area"
    () => {
      const main = document.querySelector('main');
      if (!main) return null;
      const candidates = [...main.querySelectorAll('span, button')].slice(0, 60)
        .filter(el => {
          const text = el.innerText?.trim();
          if (!text || text.length < 4 || text.length > 70 || text.includes('\n')) return false;
          // Must be letters, spaces, commas, hyphens only (no numbers, no punctuation like !)
          if (!/^[A-Za-z\s,\-]+$/.test(text)) return false;
          // Must match a known location shape:
          //   "City, State" / "City, Country" — has comma
          //   "Greater X Area" / "X Bay Area" / "X Metropolitan Area" — ends with Area
          //   "X Region" — ends with Region
          const isLocationShaped = /,/.test(text) ||
            /\b(area|region|district|province|county)\b/i.test(text) ||
            /^greater\s/i.test(text);
          if (!isLocationShaped) return false;
          // Exclude known UI strings
          return !/^(connect|message|follow|more|see|view|edit|add|open|share|report|save|you|your|book|premium|explore|upgrade|try|don't|ad\s)/i.test(text);
        });
      return candidates[0]?.innerText?.trim() || null;
    },
  ],

  // ── About ─────────────────────────────────────────────────────────────────
  about: [
    () => {
      const section = findSection('about');
      if (!section) return null;
      // LinkedIn shows a truncated version with a "see more" button.
      // The full text is still in the DOM in a visually-hidden span or inline.
      const spans = ariaHiddenTexts(section);
      // Filter out very short spans (button labels etc.)
      const meaningful = spans.filter(s => s.length > 30);
      return meaningful[0] || section.querySelector('p, div > span')?.innerText?.trim() || null;
    },
  ],

  // ── Experience ────────────────────────────────────────────────────────────
  experience: [
    () => {
      const items = findItemsBetweenH2s('experience');
      if (!items.length) return null;

      const results = [];
      for (const li of items.slice(0, 6)) {
        const spans = ariaHiddenTexts(li);
        if (!spans.length) continue;

        // Grouped entry: this li contains nested lis (one company, multiple roles)
        const nested = [...li.querySelectorAll('li')]
          .filter(n => n.querySelector('span[aria-hidden="true"]'));
        if (nested.length > 0) {
          const company = spans[0];
          for (const n of nested.slice(0, 3)) {
            const ns = ariaHiddenTexts(n);
            if (!ns.length) continue;
            results.push({
              title:    ns[0] || null,
              company:  company || null,
              duration: ns.find(s => /\d{4}|present|mos|yr/i.test(s)) || null,
            });
          }
        } else {
          results.push({
            title:    spans[0] || null,
            company:  spans[1] || null,
            duration: spans.find(s => /\d{4}|present|mos|yr/i.test(s)) || null,
          });
        }
        if (results.length >= 5) break;
      }
      return results.filter(e => e.title || e.company);
    },
  ],

  // ── Education ─────────────────────────────────────────────────────────────
  education: [
    () => {
      const items = findItemsBetweenH2s('education');
      if (!items.length) return null;
      return items.slice(0, 3).map(li => {
        const spans = ariaHiddenTexts(li);
        return { school: spans[0] || null, degree: spans[1] || null };
      }).filter(e => e.school);
    },
  ],

  // ── Skills ────────────────────────────────────────────────────────────────
  skills: [
    () => {
      const items = findItemsBetweenH2s('skills');
      if (!items.length) return null;
      return items
        .map(li => ariaHiddenTexts(li)[0])
        .filter(s => s && s.length < 80 && !/^\d/.test(s))
        .slice(0, 15);
    },
    () => {
      const section = findSection('skills');
      if (!section) return null;
      return [...section.querySelectorAll('[aria-label]')]
        .map(el => el.getAttribute('aria-label')?.trim())
        .filter(s => s && s.length < 60 && !/skills/i.test(s))
        .slice(0, 15);
    },
  ],

  // ── Recent Activity ───────────────────────────────────────────────────────
  recentActivity: [
    () => {
      // Try section container first, then fall back to h2-boundary approach
      const section = findSection('activity') || findSection('recent-activity');
      const spans = section
        ? ariaHiddenTexts(section).filter(s => s.length > 30)
        : (findItemsBetweenH2s('activity') || [])
            .map(li => ariaHiddenTexts(li)[0])
            .filter(Boolean);
      return spans[0] || null;
    },
  ],

  // ── Connection Degree ─────────────────────────────────────────────────────
  connectionDegree: [
    () => {
      const el = [...document.querySelectorAll('[aria-label]')]
        .find(e => /\d(st|nd|rd|th)?\s*degree/i.test(e.getAttribute('aria-label')));
      return el?.getAttribute('aria-label')?.trim() || null;
    },
    () => document.querySelector('.dist-value')?.innerText?.trim(),
  ],

  // ── Shared Connections ────────────────────────────────────────────────────
  sharedConnections: [
    () => {
      const el = [...document.querySelectorAll('a, button, span')]
        .find(e => {
          const text = e.innerText || e.getAttribute('aria-label') || '';
          return /mutual connection|shared connection|\d+\s+mutual/i.test(text);
        });
      return el?.innerText?.trim() || null;
    },
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────

export function scrapeProfile() {
  const data = {};
  for (const [field, extractors] of Object.entries(EXTRACTORS)) {
    data[field] = tryExtract(extractors);
  }
  data.profileUrl = window.location.href;
  data.scrapedAt  = Date.now();

  // Debug output — open DevTools on the LinkedIn tab to see this
  console.group('[LIA] Scraped profile');
  for (const [k, v] of Object.entries(data)) {
    if (k === 'scrapedAt') continue;
    console.log(`  ${k}:`, v ?? '❌ not found');
  }

  // Log section identifiers to help diagnose missing sections
  const sectionLabels = [...document.querySelectorAll('section[aria-label]')]
    .map(s => s.getAttribute('aria-label'));
  const h2Headings = [...document.querySelectorAll('main h2')]
    .map(h => h.innerText?.trim()).filter(Boolean);
  console.log('  section[aria-label]:', sectionLabels.length ? sectionLabels : '❌ none');
  console.log('  h2 headings in main:', h2Headings.length ? h2Headings : '❌ none');
  console.groupEnd();

  return data;
}

export function isProfilePage() {
  return /linkedin\.com\/in\/[^/?#]+/.test(window.location.href);
}

// Polls until an element appears or timeout expires
export function waitForElement(selector, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    const interval = setInterval(() => {
      const found = document.querySelector(selector);
      if (found) { clearInterval(interval); resolve(found); }
    }, 300);

    setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeoutMs);
  });
}
