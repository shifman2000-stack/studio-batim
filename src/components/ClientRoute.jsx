// src/components/ClientRoute.jsx
//
// Guard wrapper for the client area (/client and any future child routes).
// Verifies the current Supabase user has a row in `client_users` (RLS
// already restricts the SELECT to that user's own row), and exposes the
// row's project_id + first_name to children via a small React context.
//
// Layered access model:
//   - profiles row     → staff (handled by manager/employee layouts)
//   - client_users row → client (handled by this guard)
//   - neither          → /no-access
//
// On verification failure (no row / error / no session) the user is
// silently redirected to /no-access. While checking, a minimal loading
// pane is rendered so children never see an uninitialized context.

import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

/* Exported so admin-side wrappers can read the same context shape
   directly (or pass their own project_id in) — the guard remains the
   only place that WRITES this context; embedded callers just supply
   their own project_id and skip the context altogether. */
export const ClientContext = createContext(null)

/**
 * Hook for any component rendered inside <ClientRoute> to read the
 * current client's project_id and first_name. Throws if used outside,
 * which is a programming error (the guard always provides the context
 * before rendering children).
 */
export function useClient() {
  const ctx = useContext(ClientContext)
  if (!ctx) {
    throw new Error('useClient() must be called inside a <ClientRoute>')
  }
  return ctx
}

export default function ClientRoute({ children }) {
  const navigate = useNavigate()
  // status: 'loading' | 'ready'
  // client: null while loading, then { id, project_id, first_name } once ready
  const [status, setStatus] = useState('loading')
  const [client, setClient] = useState(null)

  useEffect(() => {
    let cancelled = false

    const verify = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        if (!cancelled) navigate('/')
        return
      }

      // RLS on client_users restricts this to the user's own row.
      const { data, error } = await supabase
        .from('client_users')
        .select('id, project_id, first_name')
        .eq('id', session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (error || !data) {
        // No row → not a recognized client → silent redirect.
        navigate('/no-access')
        return
      }

      setClient(data)
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
    <ClientContext.Provider value={client}>
      {children}
    </ClientContext.Provider>
  )
}
