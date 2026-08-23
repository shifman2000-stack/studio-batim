import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

/* Phone-sized viewport check for the admin mobile "client view" offer
   below. Deliberately NOT usePwaInstall's iOS/standalone sniffing —
   that answers "can this browser install a PWA", a different question
   from "is this screen phone-sized". A plain width query is both
   simpler and correct for desktop Chrome's device-emulation testing,
   which iOS user-agent sniffing would miss entirely. */
function isPhoneViewport() {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia?.('(max-width: 768px)').matches === true
  } catch {
    return false
  }
}

/* Remembers the admin's mobile-login choice ('staff-view' | 'desktop')
   so the choice is only ever asked once. Same read-with-fallback /
   try-catch-wrapped shape as usePwaInstall.js's isInstallDismissed /
   rememberInstallDismissed — private-mode / storage-disabled browsers
   degrade to "no preference remembered" rather than throwing. */
const MOBILE_VIEW_PREF_KEY = 'sb_admin_mobile_view_pref'

function getMobileViewPref() {
  try {
    const v = localStorage.getItem(MOBILE_VIEW_PREF_KEY)
    return v === 'staff-view' || v === 'desktop' ? v : null
  } catch {
    return null
  }
}

function rememberMobileViewPref(pref) {
  try { localStorage.setItem(MOBILE_VIEW_PREF_KEY, pref) } catch { /* ignore */ }
}

export default function AuthCallback() {
  const navigate = useNavigate()
  /* Set only when an admin on a phone viewport has no remembered
     preference yet — renders the one-time choice below instead of the
     usual "מתחבר..." pass-through. Desktop admins never see this: the
     phone-viewport check below gates it entirely. */
  const [choicePending, setChoicePending] = useState(false)

  useEffect(() => {
    const handle = async () => {
      // Wait for Supabase to process the OAuth redirect and establish the session
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user

      if (!user) {
        navigate('/')
        return
      }

      // ── 1. Staff check — profiles table (UNCHANGED) ──
      //   Matches existing manager / employee / legacy-client routing.
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

      if (profile) {
        // Clients are NOT in `profiles` in the new architecture — they are
        // identified via the link_client_on_login RPC + a row in client_users
        // (see fallback below). A stale legacy profile.role === 'client' must
        // NOT short-circuit here; it would skip the RPC and land the user on
        // /no-access via ClientRoute. Only staff roles are routed from here.
        if (profile.role === 'admin') {
          if (isPhoneViewport()) {
            const pref = getMobileViewPref()
            if (pref === 'staff-view') { navigate('/staff-view'); return }
            if (pref === 'desktop')    { navigate('/פרויקטים'); return }
            // No remembered choice yet — ask once, right here.
            setChoicePending(true)
            return
          }
          navigate('/פרויקטים')
        } else {
          navigate('/tasks')
        }
        return
      }

      // ── 2. Not in profiles — try linking as a client via Phase B RPC ──
      //   The SECURITY DEFINER function `link_client_on_login` matches
      //   the authenticated email against `project_contacts` and, on
      //   first hit, creates the client_users row. Returns the row(s)
      //   on success, empty on no match. We accept either an array
      //   (SETOF / RETURNS TABLE) or a single object return shape.
      const { data: linkResult, error: linkError } = await supabase
        .rpc('link_client_on_login')

      if (!linkError) {
        const hasRow = Array.isArray(linkResult)
          ? linkResult.length > 0
          : !!linkResult
        if (hasRow) {
          navigate('/client')
          return
        }
      }

      // ── 3. Unrecognized — silent redirect, no special message ──
      navigate('/no-access')
    }

    handle()
  }, [navigate])

  if (choicePending) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        minHeight: '100vh',
        padding: '0 32px',
        boxSizing: 'border-box',
        background: '#F7F5F2',
        fontFamily: "'Heebo', sans-serif",
        direction: 'rtl',
        textAlign: 'center',
      }}>
        <p style={{ color: '#1a1a18', fontSize: '16px', fontWeight: 500, margin: '0 0 6px' }}>
          איך תרצה להתחבר מהנייד?
        </p>
        <button
          type="button"
          onClick={() => { rememberMobileViewPref('staff-view'); navigate('/staff-view') }}
          style={{
            width: '100%', maxWidth: 320, background: '#7a9478', color: '#ffffff',
            border: 'none', borderRadius: 10, padding: '13px 16px',
            fontFamily: 'inherit', fontSize: 15, fontWeight: 500, cursor: 'pointer',
          }}
        >
          פתיחת פורטל לקוח
        </button>
        <button
          type="button"
          onClick={() => { rememberMobileViewPref('desktop'); navigate('/פרויקטים') }}
          style={{
            width: '100%', maxWidth: 320, background: '#ffffff', color: '#1a1a18',
            border: '1px solid #C1BCAF', borderRadius: 10, padding: '13px 16px',
            fontFamily: 'inherit', fontSize: 15, fontWeight: 500, cursor: 'pointer',
          }}
        >
          ממשק ניהול רגיל
        </button>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#F7F5F2',
      fontFamily: "'Heebo', sans-serif",
      direction: 'rtl',
    }}>
      <p style={{ color: '#8a8680', fontSize: '16px', fontWeight: 300 }}>מתחבר...</p>
    </div>
  )
}
