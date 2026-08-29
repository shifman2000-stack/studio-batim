// src/components/ContractorRoute.jsx
//
// Guard wrapper for the contractor area (/contractor and its children).
// Verifies the current Supabase user has a row in `contractor_users` (RLS
// already restricts the SELECT to that user's own row via
// contractor_can_read_own_row), and exposes that row plus the linked
// professional's display name to children via its own React context.
//
// Layered access model:
//   - profiles row         → staff      (manager / employee layouts)
//   - contractor_users row → contractor (handled by this guard)
//   - client_users row     → client     (handled by ClientRoute)
//   - none of the above    → /no-access
//
// DELIBERATELY SEPARATE FROM ClientContext. A contractor is not a client
// with fewer permissions — the two carry different identities (a
// professional_id vs a project_id) and different screens. Sharing the
// context would invite code that treats one as the other, which is
// exactly the silent misclassification this whole feature must avoid.
//
// On verification failure (no row / error / no session) the user is
// redirected to /no-access. While checking, a minimal loading pane is
// rendered so children never see an uninitialised context — same shape
// as ClientRoute.

import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export const ContractorContext = createContext(null)

/**
 * Hook for any component rendered inside <ContractorRoute> to read the
 * current contractor's identity. Throws if used outside, which is a
 * programming error (the guard always provides the context first).
 *
 * Shape: { id, professional_id, email, created_at, displayName }
 */
export function useContractor() {
  const ctx = useContext(ContractorContext)
  if (!ctx) {
    throw new Error('useContractor() must be called inside a <ContractorRoute>')
  }
  return ctx
}

export default function ContractorRoute({ children }) {
  const navigate = useNavigate()
  // status: 'loading' | 'ready'
  const [status, setStatus] = useState('loading')
  const [contractor, setContractor] = useState(null)

  useEffect(() => {
    let cancelled = false

    const verify = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        if (!cancelled) navigate('/')
        return
      }

      // RLS on contractor_users restricts this to the user's own row.
      const { data, error } = await supabase
        .from('contractor_users')
        .select('id, professional_id, email, created_at')
        .eq('id', session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (error || !data) {
        // No row → not a recognised contractor → silent redirect.
        navigate('/no-access')
        return
      }

      /* Display name is COSMETIC and must never block entry. A failure
         here leaves displayName empty and the header falls back to the
         email, rather than bouncing a legitimate contractor. */
      let displayName = ''
      try {
        const { data: prof } = await supabase
          .from('professionals')
          .select('first_name, last_name, business_name')
          .eq('id', data.professional_id)
          .maybeSingle()
        if (prof) {
          displayName =
            [prof.first_name, prof.last_name].filter(Boolean).join(' ').trim() ||
            (prof.business_name || '').trim()
        }
      } catch {
        /* cosmetic only */
      }

      if (cancelled) return

      setContractor({ ...data, displayName })
      setStatus('ready')
    }

    verify()
    return () => { cancelled = true }
  }, [navigate])

  if (status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#F7F5F2',
        fontFamily: "'Heebo', sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        direction: 'rtl',
      }}>
        <p style={{ color: '#8a8680', fontSize: '16px', fontWeight: 300, margin: 0 }}>
          טוען...
        </p>
      </div>
    )
  }

  return (
    <ContractorContext.Provider value={contractor}>
      {children}
    </ContractorContext.Provider>
  )
}
