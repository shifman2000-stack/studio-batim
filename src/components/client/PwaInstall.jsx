// src/components/client/PwaInstall.jsx
//
// The client portal's "התקן אפליקציה" surfaces. Two exports:
//
//   <InstallAppButton />  — the permanent drawer entry. Always there for
//                           anyone who changes their mind later.
//   <InstallAppPrompt />  — the one-time invitation on the portal's
//                           opening screen.
//
// Both are CLIENT-PORTAL ONLY. The staff app never imports them.
//
// Neither renders anything when the app is already installed, or on a
// browser that cannot install at all (desktop Firefox, Chrome on iOS) —
// see usePwaInstall's `mode`. A button that cannot do what it says is
// worse than no button.
//
// The dialog deliberately reuses the confirm-submit dialog from
// ClientProgrammingQuestionnaire verbatim — same scrim, radius, padding,
// width cap, shadow and type scale — so it reads as part of the portal
// rather than as a browser artefact.

import { useEffect, useState } from 'react'
import usePwaInstall, { isInstallDismissed, rememberInstallDismissed } from '../../lib/usePwaInstall'

/* The iOS share glyph — a box with an arrow leaving the top. Drawn
   rather than described, because "לחצו על כפתור השיתוף" is much harder
   to follow than being shown the shape to look for. */
function ShareGlyph({ size = 17 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: '-3px', margin: '0 2px' }}
    >
      <path d="M12 15V4" />
      <path d="M8.5 7.5 12 4l3.5 3.5" />
      <path d="M6 12H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-1" />
    </svg>
  )
}

function DownloadGlyph({ size = 17 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 19h16" />
    </svg>
  )
}

/* iOS instructions, shared by the drawer sheet and the popup so the
   wording can never drift between them. */
function IosSteps() {
  return (
    <p style={{ margin: '0 0 16px', fontSize: 14, color: '#4a4a48', lineHeight: 1.9 }}>
      כדי להוסיף את האפליקציה למסך הבית:
      <br />
      1. לחצו על כפתור השיתוף <ShareGlyph /> בסרגל התחתון של Safari.
      <br />
      2. גללו ובחרו <b>"הוסף למסך הבית"</b>.
      <br />
      3. אשרו בלחיצה על <b>"הוסף"</b>.
    </p>
  )
}

/* ── The dialog, used by both the button and the auto-popup ── */
function InstallDialog({ mode, onInstall, onClose, installing }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="התקנת האפליקציה"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(26,26,24,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, direction: 'rtl',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff', borderRadius: 14,
          padding: '20px 20px 16px',
          maxWidth: 400, width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
          textAlign: 'right',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <svg width="34" height="34" viewBox="0 0 100 100" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect width="100" height="100" rx="18" fill="#F7F5F2" />
            <g fill="none" stroke="#7a9478" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 47 L50 26 L78 47" />
              <path d="M30 47 L30 74 L70 74 L70 47" />
            </g>
          </svg>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#1a1a18' }}>
            התקנת האפליקציה
          </h2>
        </div>

        {mode === 'ios' ? <IosSteps /> : (
          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#4a4a48', lineHeight: 1.7 }}>
            אפשר להוסיף את הפורטל למסך הבית ולפתוח אותו כמו אפליקציה רגילה —
            בלי לחפש כתובת, עם כניסה מהירה לכל המסמכים וההתקדמות של הפרויקט.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
          {mode === 'prompt' && (
            <button
              type="button"
              onClick={onInstall}
              disabled={installing}
              style={{
                background: '#7a9478', color: '#ffffff',
                border: '1px solid #5d7259', borderRadius: 8,
                padding: '8px 20px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                cursor: installing ? 'not-allowed' : 'pointer',
                opacity: installing ? 0.7 : 1,
              }}
            >
              {installing ? 'מתקין...' : 'התקן'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#ffffff', color: '#4a4a48',
              border: '1px solid #d9d6cd', borderRadius: 8,
              padding: '8px 20px', fontFamily: 'inherit', fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {mode === 'ios' ? 'הבנתי' : 'לא עכשיו'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Permanent drawer entry ──────────────────────────────────────────
   On Android/desktop it fires the browser prompt directly — one tap,
   no intermediate dialog. On iOS there is nothing to fire, so it opens
   the instructions instead. */
export function InstallAppButton() {
  const { mode, canOffer, promptInstall } = usePwaInstall()
  const [showIos, setShowIos] = useState(false)

  if (!canOffer) return null

  return (
    <>
      <button
        type="button"
        className="cp-drawer-install"
        onClick={() => { if (mode === 'ios') setShowIos(true); else promptInstall() }}
      >
        <span className="cp-drawer-install-icon">
          {mode === 'ios' ? <ShareGlyph size={18} /> : <DownloadGlyph size={18} />}
        </span>
        <span>התקן אפליקציה</span>
      </button>

      {showIos && (
        <InstallDialog mode="ios" onClose={() => setShowIos(false)} />
      )}
    </>
  )
}

/* ── One-time invitation on the portal's opening screen ──────────────
   Shows once. Dismissal is remembered for 90 days; the drawer button
   above stays available the entire time. */
export function InstallAppPrompt() {
  const { mode, canOffer, promptInstall } = usePwaInstall()
  const [open, setOpen]             = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!canOffer) return
    if (isInstallDismissed()) return
    /* A short delay so the invitation doesn't collide with the portal's
       own first paint — it should feel like an offer, not an interstitial. */
    const t = setTimeout(() => setOpen(true), 1400)
    return () => clearTimeout(t)
  }, [canOffer])

  if (!open || !canOffer) return null

  const close = () => {
    /* Closing the automatic popup ALWAYS counts as a dismissal, whether
       by the button or by the backdrop — otherwise it would reappear on
       the next load and become the nagging we set out to avoid. */
    rememberInstallDismissed()
    setOpen(false)
  }

  const install = async () => {
    setInstalling(true)
    await promptInstall()
    setInstalling(false)
    /* Remember either way: if they accepted, it's installed; if they
       declined the browser's own dialog, asking again would nag. */
    rememberInstallDismissed()
    setOpen(false)
  }

  return (
    <InstallDialog
      mode={mode}
      installing={installing}
      onInstall={install}
      onClose={close}
    />
  )
}
