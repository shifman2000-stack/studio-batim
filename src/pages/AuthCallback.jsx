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

      const email = user.email

      // ── 1. Check profiles table ──
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

      if (profile) {
        if (profile.role === 'admin') navigate('/פרויקטים')
        else if (profile.role === 'client') navigate('/client')
        else navigate('/tasks')
        return
      }

      // ── 2. Check inquiries table ──
      const { data: inquiry } = await supabase
        .from('inquiries')
        .select('first_name, last_name')
        .eq('email', email)
        .maybeSingle()

      if (inquiry) {
        await supabase.from('profiles').insert({
          id: user.id,
          first_name: inquiry.first_name ?? null,
          last_name: inquiry.last_name ?? null,
          role: 'client',
        })
        navigate('/client')
        return
      }

      // ── 3. Check project_contacts table ──
      const { data: contact } = await supabase
        .from('project_contacts')
        .select('first_name, last_name')
        .eq('email', email)
        .maybeSingle()

      if (contact) {
        await supabase.from('profiles').insert({
          id: user.id,
          first_name: contact.first_name ?? null,
          last_name: contact.last_name ?? null,
          role: 'client',
        })
        navigate('/client')
        return
      }

      // ── 4. Not found anywhere ──
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
