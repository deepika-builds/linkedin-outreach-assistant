// Content script — injected on linkedin.com/in/* pages
// Bundled by esbuild into dist/content-main.js (IIFE, no ES module syntax in output).

// This fires the moment the script is injected — if you don't see this, the script isn't loading.
console.log('[LIA] content script injected —', location.href);

import { scrapeProfile, waitForElement, isProfilePage } from './scraper.js';
import { mountOverlay, unmountOverlay, updateProfile }   from './overlay/overlay-manager.js';
import OVERLAY_CSS from './overlay/overlay.css';

// ── SPA navigation detection ──────────────────────────────────────────────────

let lastUrl  = location.href;
let navTimer = null;

const navObserver = new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  clearTimeout(navTimer);
  navTimer = setTimeout(handleNavigation, 500);
});

navObserver.observe(document.documentElement, { childList: true, subtree: true });

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  console.log('[LIA] init — isProfilePage:', isProfilePage());
  if (!isProfilePage()) return;
  try {
    mountOverlay(OVERLAY_CSS);
    console.log('[LIA] overlay mounted');
  } catch (err) {
    console.error('[LIA] mountOverlay failed:', err);
  }
  await scrapeAndUpdate();
}

async function handleNavigation() {
  if (!isProfilePage()) {
    unmountOverlay();
    return;
  }
  mountOverlay(OVERLAY_CSS);
  await scrapeAndUpdate();
}

async function scrapeAndUpdate() {
  try {
    console.log('[LIA] waiting for profile content…');

    // Wait for main content to appear (more reliable than h1 which some layouts omit)
    await Promise.race([
      waitForElement('main'),
      delay(5000),
    ]).catch(() => null);

    // Scroll down the page to trigger LinkedIn's lazy-loaded sections
    // (Experience, Education, Skills are only injected into the DOM on scroll)
    console.log('[LIA] triggering lazy-load scroll…');
    await triggerLazyLoad();

    await delay(600);
    console.log('[LIA] scraping…');
    const profile = scrapeProfile();
    updateProfile(profile);
  } catch (err) {
    console.error('[LIA] scrapeAndUpdate error:', err);
    updateProfile({ name: null, headline: null });
  }
}

// Scroll down gradually so LinkedIn injects lazy-loaded sections into the DOM,
// then scroll back to top so the user's view isn't disrupted.
async function triggerLazyLoad() {
  const totalHeight = document.body.scrollHeight;
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    window.scrollTo(0, (totalHeight / steps) * i);
    await delay(300);
  }
  window.scrollTo(0, 0);
  await delay(300);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Start ─────────────────────────────────────────────────────────────────────

init();
