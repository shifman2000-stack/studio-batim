import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function AuthCallback() {
  const navigate = useNavigate()

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
        if (profile.role === 'admin') navigate('/פרויקטים')
        else navigate('/tasks')
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
