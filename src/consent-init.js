/*
 * Consent Mode v2, canonical init logic (framework-agnostic).
 *
 * SINGLE SOURCE OF TRUTH for the behavior. The per-stack drop-ins (react/,
 * vite/, server-rendered/) inline an equivalent of this so each stays
 * zero-dependency, when you change the region list or the storage key,
 * change it HERE and re-sync the inlined copies.
 *
 * Behavior:
 *   1. Default ALL consent to DENIED + wait_for_update.
 *   2. If the visitor already chose (localStorage), re-apply that choice.
 *   3. Otherwise resolve region via the same-origin Cloudflare /cdn-cgi/trace
 *      `loc=` lookup: non-EEA/UK -> granted, EEA/UK -> denied until they accept.
 *   4. FAIL CLOSED: if the geo lookup fails (non-Cloudflare host, network
 *      error, blocked request) -> denied.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE GOTCHA THIS PACKAGE EXISTS FOR
 *
 * A page-level gtag('consent', 'default', {...}) does NOT override a Google
 * Tag container's own denied default. Only an explicit gtag('consent',
 * 'update', {...}) does.
 *
 * This is the bug that silently zeroes your analytics. You set a page-level
 * default of 'granted', you see the consent ping fire, everything looks
 * plumbed, and the container's default wins, so you collect nothing. The
 * fix is that every path through this file terminates in an `update`, even
 * the "no banner needed, they're outside the EEA" path.
 * ─────────────────────────────────────────────────────────────────────────
 */

// Namespace this per-app if you run several apps on one origin.
export var CONSENT_KEY = 'cookie_consent_v1';

// EEA + UK (incl. Iceland / Liechtenstein / Norway).
// Add 'CH' if you want to treat Switzerland the same way.
export var EEA_UK = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB',
];

// The visitor's saved choice ('granted' | 'denied'), or '' when none or storage is blocked.
function storedChoice() {
  try {
    var stored = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    if (stored && stored.choice) return stored.choice === 'granted' ? 'granted' : 'denied';
  } catch (e) {
    /* localStorage blocked (Safari private mode, etc.) */
  }
  return '';
}

function gtagSafe() {
  // window.gtag is defined by the loader snippet that runs before this.
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    return window.gtag;
  }
  return function () {};
}

export function setConsent(value) {
  gtagSafe()('consent', 'update', {
    ad_storage: value,
    analytics_storage: value,
    ad_user_data: value,
    ad_personalization: value,
  });
}

/**
 * Call ONCE on first load, after gtag('js', ...) and the consent 'default'.
 * Every branch ends in setConsent(), see the gotcha above.
 */
export function resolveInitialConsent() {
  if (storedChoice()) {
    setConsent(storedChoice());
    return;
  }

  fetch('/cdn-cgi/trace')
    .then(function (r) { return r.text(); })
    .then(function (t) {
      var m = t.match(/loc=([A-Z][A-Z])/);
      var loc = m ? m[1] : '';
      // The visitor may have clicked Accept/Reject while the lookup was in
      // flight. An explicit choice always beats the geo guess.
      setConsent(loc && EEA_UK.indexOf(loc) === -1 ? 'granted' : 'denied');
    })
    .catch(function () { if (!storedChoice()) setConsent('denied'); }); // fail closed
}

/** Call from the banner on Accept ('granted') / Reject ('denied'). */
export function applyConsentChoice(choice) {
  setConsent(choice === 'granted' ? 'granted' : 'denied');
  try {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ choice: choice, ts: Date.now() })
    );
  } catch (e) {
    /* persistence unavailable, the choice still applies for this session */
  }
}
