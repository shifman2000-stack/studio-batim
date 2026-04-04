import { useState, useEffect, useCallback, useRef } from 'react'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE     = 'https://www.googleapis.com/auth/calendar.readonly'

// Google Calendar colorId → hex
const GCAL_COLORS = {
  '1':  '#7986CB',
  '2':  '#33B679',
  '3':  '#8E24AA',
  '4':  '#E67C73',
  '5':  '#F6BF26',
  '6':  '#F4511E',
  '7':  '#039BE5',
  '8':  '#616161',
  '9':  '#3F51B5',
  '10': '#0B8043',
  '11': '#D50000',
}
const DEFAULT_COLOR = '#4285F4'

const HEBREW_MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
]
const HEBREW_DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']

function formatDateHebrew(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return `יום ${HEBREW_DAYS[d.getDay()]}, ${d.getDate()} ב${HEBREW_MONTHS[d.getMonth()]}`
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// Returns the local YYYY-MM-DD string for an event's start
function eventDateStr(ev) {
  if (ev.start?.date) return ev.start.date          // all-day
  if (ev.start?.dateTime) return ev.start.dateTime.slice(0, 10)
  return null
}

export default function GoogleCalendarPanel({ selectedDate, userEmail, viewYear, viewMonth, onMonthEvents }) {
  const [connected, setConnected]       = useState(false)
  const [events, setEvents]             = useState([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [gapiReady, setGapiReady]       = useState(false)
  const tokenClientRef                  = useRef(null)

  // ── 1. Load gapi and restore saved token ──────────────────────────────────
  useEffect(() => {
    const initGapi = () => {
      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.init({})
          await window.gapi.client.load(
            'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'
          )
          setGapiReady(true)

          const saved = sessionStorage.getItem('gcal_token')
          if (saved) {
            window.gapi.client.setToken(JSON.parse(saved))
            setConnected(true)
          }
        } catch (e) {
          console.error('gapi init error:', e)
          setError('שגיאה בטעינת Google API')
        }
      })
    }

    if (window.gapi) {
      initGapi()
    } else {
      const timer = setInterval(() => {
        if (window.gapi) { clearInterval(timer); initGapi() }
      }, 200)
      return () => clearInterval(timer)
    }
  }, [])

  // ── 2. Init GSI token client once gapi is ready ───────────────────────────
  useEffect(() => {
    if (!gapiReady) return

    const waitForGoogle = () => {
      if (!window.google?.accounts?.oauth2) {
        setTimeout(waitForGoogle, 200)
        return
      }
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope:     SCOPE,
        prompt:     'select_account',
        login_hint: userEmail || '',
        callback:   (resp) => {
          if (resp.error) {
            console.error('GSI error:', resp)
            setError('שגיאה בהתחברות: ' + resp.error)
            return
          }
          sessionStorage.setItem('gcal_token', JSON.stringify(window.gapi.client.getToken()))
          setConnected(true)
          setError('')
        },
      })
    }
    waitForGoogle()
  }, [gapiReady, userEmail])

  // ── 3. Handle 401 — clears connection and notifies parent ─────────────────
  const handleExpired = useCallback(() => {
    sessionStorage.removeItem('gcal_token')
    window.gapi.client.setToken(null)
    setConnected(false)
    setEvents([])
    if (onMonthEvents) onMonthEvents({})
    setError('פג תוקף החיבור — אנא התחבר מחדש')
  }, [onMonthEvents])

  // ── 4. Fetch events for the full visible month → pass dots to parent ───────
  const fetchMonthEvents = useCallback(async (year, month) => {
    if (!gapiReady || !connected || onMonthEvents == null) return
    try {
      const firstDay  = new Date(year, month, 1)
      const lastDay   = new Date(year, month + 1, 0)
      const timeMin   = firstDay.toISOString()
      const timeMax   = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59).toISOString()
      const res = await window.gapi.client.calendar.events.list({
        calendarId:   'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy:      'startTime',
        maxResults:   500,
      })
      const items = res.result.items || []

      // Build { 'YYYY-MM-DD': ['#hex', ...] }
      const dots = {}
      items.forEach(ev => {
        const ds = eventDateStr(ev)
        if (!ds) return
        const color = ev.colorId ? (GCAL_COLORS[ev.colorId] || DEFAULT_COLOR) : DEFAULT_COLOR
        if (!dots[ds]) dots[ds] = []
        if (dots[ds].length < 3) dots[ds].push(color)
      })
      onMonthEvents(dots)
    } catch (e) {
      console.error('gcal month fetch error:', e)
      if (e.status === 401) handleExpired()
    }
  }, [gapiReady, connected, onMonthEvents, handleExpired])

  // Re-fetch month dots whenever month/year changes or connection established
  useEffect(() => {
    if (connected && viewYear != null && viewMonth != null) {
      fetchMonthEvents(viewYear, viewMonth)
    } else if (!connected && onMonthEvents) {
      onMonthEvents({})
    }
  }, [connected, viewYear, viewMonth, fetchMonthEvents, onMonthEvents])

  // ── 5. Fetch events for the selected day ──────────────────────────────────
  const fetchEvents = useCallback(async (dateStr) => {
    if (!dateStr || !gapiReady || !connected) return
    setLoading(true)
    setError('')
    try {
      const timeMin = new Date(dateStr + 'T00:00:00').toISOString()
      const timeMax = new Date(dateStr + 'T23:59:59').toISOString()
      const res = await window.gapi.client.calendar.events.list({
        calendarId:   'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy:      'startTime',
        maxResults:   50,
      })
      setEvents(res.result.items || [])
    } catch (e) {
      console.error('gcal fetch error:', e)
      if (e.status === 401) handleExpired()
      else setError('שגיאה בטעינת אירועים')
    }
    setLoading(false)
  }, [gapiReady, connected, handleExpired])

  useEffect(() => {
    if (connected && selectedDate) fetchEvents(selectedDate)
    else if (!connected)           setEvents([])
  }, [connected, selectedDate, fetchEvents])

  // ── 6. Handlers ───────────────────────────────────────────────────────────
  const handleConnect = () => {
    if (!tokenClientRef.current) return
    if (userEmail) tokenClientRef.current.login_hint = userEmail
    tokenClientRef.current.requestAccessToken()
  }

  const handleDisconnect = () => {
    const token = window.gapi?.client?.getToken()
    if (token?.access_token) {
      window.google?.accounts?.oauth2?.revoke(token.access_token, () => {})
    }
    window.gapi?.client?.setToken(null)
    sessionStorage.removeItem('gcal_token')
    setConnected(false)
    setEvents([])
    setError('')
    if (onMonthEvents) onMonthEvents({})
  }

  // ── 7. Render ─────────────────────────────────────────────────────────────
  return (
    <div className="gcal-panel">
      <div className="gcal-panel-header">
        <span className="gcal-panel-title">
          {selectedDate ? `לוז יומי — ${formatDateHebrew(selectedDate)}` : 'לוז יומי'}
        </span>
      </div>

      {!connected && (
        <div className="gcal-connect-area">
          <p className="gcal-connect-hint">
            התחבר כדי לראות פגישות מ-Google Calendar
          </p>
          <button
            className="gcal-connect-btn"
            onClick={handleConnect}
            disabled={!gapiReady}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            התחבר ל-Google Calendar
          </button>
          {error && <p className="gcal-error">{error}</p>}
        </div>
      )}

      {connected && (
        <div className="gcal-events-area">
          {!selectedDate && (
            <p className="gcal-no-date">בחר תאריך בלוח השנה</p>
          )}
          {selectedDate && loading && (
            <p className="gcal-loading">טוען פגישות...</p>
          )}
          {selectedDate && !loading && error && (
            <p className="gcal-error">{error}</p>
          )}
          {selectedDate && !loading && !error && events.length === 0 && (
            <p className="gcal-empty">אין פגישות היום</p>
          )}
          {selectedDate && !loading && !error && events.length > 0 && (
            <ul className="gcal-events-list">
              {events.map(ev => {
                const isAllDay = !ev.start?.dateTime
                const timeLabel = isAllDay
                  ? 'כל היום'
                  : `${formatTime(ev.start.dateTime)} – ${formatTime(ev.end.dateTime)}`
                const dotColor = ev.colorId ? (GCAL_COLORS[ev.colorId] || DEFAULT_COLOR) : DEFAULT_COLOR
                return (
                  <li key={ev.id} className="gcal-event-card">
                    <span className="gcal-event-dot" style={{ background: dotColor }} />
                    <div className="gcal-event-body">
                      <div className="gcal-event-time">{timeLabel}</div>
                      <div className="gcal-event-title">{ev.summary || '(ללא כותרת)'}</div>
                      {ev.location && (
                        <div className="gcal-event-location">📍 {ev.location}</div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <button className="gcal-disconnect-btn" onClick={handleDisconnect}>
            נתק Google Calendar
          </button>
        </div>
      )}
    </div>
  )
}
