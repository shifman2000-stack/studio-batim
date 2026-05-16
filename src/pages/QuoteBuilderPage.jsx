import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuoteBuilder from '../components/QuoteBuilder'

export default function QuoteBuilderPage() {
  const { inquiryId } = useParams()
  const navigate = useNavigate()
  const [inquiry, setInquiry] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile?.role !== 'admin') { navigate('/dashboard'); return }
      fetchInquiry()
    }
    check()
  }, [inquiryId])

  const fetchInquiry = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('inquiries').select('*').eq('id', inquiryId).single()
    if (error || !data) {
      setError('פניה לא נמצאה')
      setLoading(false)
      return
    }
    setInquiry(data)
    setLoading(false)
  }

  if (loading) return (
    <div dir="rtl" style={{ padding: 40, fontFamily: 'Heebo, sans-serif' }}>טוען...</div>
  )
  if (error || !inquiry) return (
    <div dir="rtl" style={{ padding: 40, color: '#c0392b', fontFamily: 'Heebo, sans-serif' }}>{error}</div>
  )

  return (
    <QuoteBuilder
      inquiry={inquiry}
      onClose={() => window.close()}
      onQuoteUpdated={() => {}}
    />
  )
}
