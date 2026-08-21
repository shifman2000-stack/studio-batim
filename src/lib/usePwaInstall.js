// src/lib/usePwaInstall.js
//
// One hook that answers "can this person install the app, and how?".
//
// There are three genuinely different worlds and they must not be
// conflated — conflating them is how PWA install UI usually goes wrong:
//
//   1. ALREADY INSTALLED — the app is running standalone. Offer nothing:
//      an install button inside an installed app is pure confusion.
//   2. ANDROID / DESKTOP CHROMIUM — the browser fires
//      `beforeinstallprompt`. We suppress its own banner and keep the
//      event so OUR button can trigger it at a moment we choose. The
//      event can only be used ONCE.
//   3. iOS SAFARI — `beforeinstallprompt` does not exist and never
//      will. There is no programmatic install on iOS at all, so the
//      only honest option is to explain the Share → "הוסף למסך הבית"
//      gesture. A button that "installs" here would do nothing.
//
// `mode` collapses this into one value the UI can switch on, so no
// component has to re-derive the platform rules.

import { useCallback, useEffect, useState } from 'react'

const DISMISS_KEY  = 'sb_pwa_install_dismissed_at'
/* 90 days. Not forever: someone who declines during a first meeting may
   well want it two months later, once the project is actually running
   and they are checking documents from site. The drawer button stays
   available the whole time regardless. */
const DISMISS_DAYS = 90

function detectStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    /* iOS Safari doesn't support the display-mode query; it exposes its
       own non-standard flag instead. */
    || window.navigator.standalone === true
}

function detectIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iphone|ipad|ipod/i.test(ua)) return true
  /* iPadOS 13+ reports a desktop Mac user-agent by default. A Mac with
     a touchscreen doesn't exist, so touch points disambiguate it. */
  return /macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1
}

/* iOS can only install from SAFARI. Chrome/Firefox/Edge on iOS have no
   "add to home screen" at all, so showing them the Share instructions
   would send people looking for a button that isn't there. */
function detectIOSSafari() {
  if (!detectIOS()) return false
  const ua = navigator.userAgent || ''
  return !/crios|fxios|edgios|opios/i.test(ua)
}

export function isInstallDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return (Date.now() - at) < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    /* Private mode / storage disabled — treat as "not dismissed" so the
       feature still works, rather than throwing. */
    return false
  }
}

export function rememberInstallDismissed() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
}

export default function usePwaInstall() {
  /* Seeded from the stash the inline script in index.html fills in.
     This is the whole fix for "the button never appeared": React cannot
     attach a listener early enough on /client, because ClientRoute
     holds the portal unmounted through two Supabase round-trips first.
     By the time this hook mounts the event has usually already fired,
     and it is neither sticky nor replayed — so we read what was caught
     for us rather than waiting for an event that has been and gone. */
  const [promptEvent, setPromptEvent] = useState(
    () => (typeof window !== 'undefined' && window.__sbInstall?.event) || null
  )
  const [standalone,  setStandalone]  = useState(
    () => detectStandalone() || (typeof window !== 'undefined' && window.__sbInstall?.installed === true)
  )
  const [iosSafari]                   = useState(detectIOSSafari)

  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      /* Suppress Chrome's own mini-infobar so the invitation appears
         where WE decide, in Hebrew, in the app's own styling.
         Still needed for the opposite ordering — React mounted first
         and the browser fires afterwards. */
      e.preventDefault()
      if (window.__sbInstall) {
        window.__sbInstall.event = e
        window.__sbInstall.firedAt = Date.now()
      }
      setPromptEvent(e)
    }
    /* Raised by the inline script when it catches the event before the
       app has even parsed — this is what un-sticks a hook that mounted
       after the fact. */
    const onStashUpdated = () => {
      const stash = window.__sbInstall
      if (!stash) return
      if (stash.installed) { setPromptEvent(null); setStandalone(true); return }
      if (stash.event) setPromptEvent(stash.event)
    }
    const onInstalled = () => {
      /* Drop the saved event and flip to installed immediately, so the
         button and popup disappear without needing a reload. */
      setPromptEvent(null)
      setStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('sb-install-available', onStashUpdated)
    window.addEventListener('appinstalled', onInstalled)

    /* Re-read once on mount too: the custom event may have been
       dispatched before this listener existed, which is precisely the
       race we are fixing. */
    onStashUpdated()

    /* Launching from the home screen after install changes display-mode
       without a fresh page load in some browsers. */
    const mq = window.matchMedia?.('(display-mode: standalone)')
    const onDisplayModeChange = (e) => setStandalone(e.matches)
    mq?.addEventListener?.('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('sb-install-available', onStashUpdated)
      window.removeEventListener('appinstalled', onInstalled)
      mq?.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [])

  /* Fires the browser's real install dialog. Resolves to true only if
     the user actually accepted. The event is single-use, so it is
     cleared either way. */
  const promptInstall = useCallback(async () => {
    if (!promptEvent) return false
    try {
      promptEvent.prompt()
      const choice = await promptEvent.userChoice
      /* Single-use: clear BOTH copies, or a second component reading
         the stash would try to re-prompt with a spent event. */
      if (window.__sbInstall) window.__sbInstall.event = null
      setPromptEvent(null)
      return choice?.outcome === 'accepted'
    } catch {
      if (window.__sbInstall) window.__sbInstall.event = null
      setPromptEvent(null)
      return false
    }
  }, [promptEvent])

  const mode = standalone ? 'installed'
    : promptEvent        ? 'prompt'      /* real beforeinstallprompt available */
    : iosSafari          ? 'ios'         /* explain the Share gesture instead */
    : 'unavailable'                      /* e.g. desktop Firefox — offer nothing */

  return {
    mode,
    /* Never true for 'unavailable', so no dead button is ever rendered. */
    canOffer: mode === 'prompt' || mode === 'ios',
    promptInstall,
  }
}
