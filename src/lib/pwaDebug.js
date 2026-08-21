// src/lib/pwaDebug.js
//
// ⚠️ TEMPORARY — DIAGNOSTIC ONLY. STRIP BEFORE MERGING TO master.
//
// To remove: delete this file and the three `pwaDebug` / `dumpPwaState`
// imports (src/main.jsx, src/lib/usePwaInstall.js). Nothing else depends
// on it and it holds no behaviour.
//
// Exists because the install button can only be debugged on a real
// device — desktop DevTools won't reproduce the timing race between
// Chrome firing `beforeinstallprompt` and ClientRoute finishing its
// Supabase round-trips. Everything needed to tell those cases apart is
// printed in one place.

const TAG = '%c[PWA]'
const CSS = 'background:#7a9478;color:#fff;padding:1px 5px;border-radius:3px'

export function pwaDebug(label, data) {
  try {
    if (data === undefined) console.log(TAG, CSS, label)
    else console.log(TAG, CSS, label, data)
  } catch { /* never let logging break anything */ }
}

/* A single snapshot of every input that decides whether the button
   renders. Also hung on window so it can be re-run by hand from a
   remote-debugging console after interacting with the page. */
export function dumpPwaState(extra = {}) {
  const stash = (typeof window !== 'undefined' && window.__sbInstall) || null
  const state = {
    // ── did the early capture work? ──
    stashPresent:   !!stash,
    eventCaptured:  !!stash?.event,
    capturedEarly:  stash?.capturedEarly === true,   // true = inline script won the race
    firedAt:        stash?.firedAt ? new Date(stash.firedAt).toISOString() : null,
    msSincePageLoad: stash?.firedAt ? Math.round(stash.firedAt - performance.timeOrigin) : null,
    appInstalledEvt: stash?.installed === true,

    // ── platform detection ──
    standaloneMatchMedia: window.matchMedia?.('(display-mode: standalone)').matches ?? null,
    navigatorStandalone:  window.navigator.standalone ?? null,
    userAgent:            navigator.userAgent,

    // ── dismissal ──
    dismissedRaw: (() => { try { return localStorage.getItem('sb_pwa_install_dismissed_at') } catch { return 'STORAGE-DENIED' } })(),

    // ── service worker ──
    swController: navigator.serviceWorker?.controller?.scriptURL ?? null,

    ...extra,
  }
  pwaDebug('state', state)
  return state
}

if (typeof window !== 'undefined') {
  window.__sbPwaDebug = dumpPwaState
}
