import { useState, useEffect, useCallback, useRef } from 'react'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
/* Unchanged. calendar.readonly already covers calendarList.list and events on
   EVERY calendar the account can see, including subscribed ones under "Other
   calendars" — so reading the holiday calendar needs no new scope and no
   re-consent. Only the calendarId parameter below was ever limiting us. */
const SCOPE     = 'https://www.googleapis.com/auth/calendar.readonly'

/* The subscribed calendar the studio takes Jewish holidays from, matched by
   the name it shows under "Other calendars". Deliberately ONE constant: if the
   studio subscribes to a different holiday calendar (a Hebrew-titled one, say)
   this is the single line to change. Not found → no holiday lines, no error. */
const HOLIDAY_CALENDAR_NAME = 'חגים בישראל'

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

export default function GoogleCalendarPanel({ selectedDate, userEmail, viewYear, viewMonth, onMonthEvents, onMonthHolidays }) {
  const [connected, setConnected]       = useState(false)
  const [events, setEvents]             = useState([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [gapiReady, setGapiReady]       = useState(false)
  const [tokenClientReady, setTokenClientReady] = useState(false)
  const tokenClientRef                  = useRef(null)

  /* Silent reauth state.
     silentTriedRef       — locks the auto-attempt to ONCE per mount, so a
                            disconnect / 401 won't cause a popup-less retry loop.
     silentInProgressRef  — flag for the shared GIS callback: when true and the
                            callback receives resp.error, treat it as a silent
                            miss (no visible UI error, just fall back to the
                            manual "התחבר" button). */
  const silentTriedRef      = useRef(false)
  const silentInProgressRef = useRef(false)
  /* Resolved id of HOLIDAY_CALENDAR_NAME, and ONLY when the lookup succeeded
     — a miss is never cached, so a calendar subscribed or renamed after the
     app loaded is picked up on the next fetch without reconnecting Google.
     Cleared whenever a fetch against it fails, which is what a deleted or
     unsubscribed calendar looks like. */
  const holidayCalIdRef     = useRef(undefined)
  /* 'idle' until the first holiday fetch settles, then 'ok' or 'not-found'.
     Drives the one-line notice beside the Google controls, so "no holiday
     calendar" stops looking exactly like "no holidays this month". */
  const [holidayStatus, setHolidayStatus] = useState('idle')

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
          const wasSilent = silentInProgressRef.current
          silentInProgressRef.current = false
          if (resp.error) {
            if (wasSilent) {
              /* Silent reauth declined (user not yet authorized, consent
                 needed, popup required, etc.) — quietly fall back to the
                 manual "התחבר" button. No visible error. */
              console.warn('silent gcal reauth declined:', resp.error)
              return
            }
            console.error('GSI error:', resp)
            setError('שגיאה בהתחברות: ' + resp.error)
            return
          }
          sessionStorage.setItem('gcal_token', JSON.stringify(window.gapi.client.getToken()))
          setConnected(true)
          setError('')
        },
      })
      setTokenClientReady(true)
    }
    waitForGoogle()
  }, [gapiReady, userEmail])

  // ── 2b. Silent token refresh attempt on mount ─────────────────────────────
  //   Runs ONCE per mount, after gapi + GIS + tokenClient are ready AND no
  //   token was restored from sessionStorage. Asks Google to silently reissue
  //   a token via `prompt: ''` — succeeds without a popup if the admin is
  //   already authorized in this browser. If Google declines (consent needed,
  //   first time in this browser, etc.), the callback path above quietly
  //   leaves connected=false and the existing "התחבר" button stays visible.
  //   silentTriedRef ensures this fires exactly once per mount even if
  //   `connected` flips back to false later (handleDisconnect / handleExpired).
  useEffect(() => {
    if (!tokenClientReady || connected || silentTriedRef.current) return
    silentTriedRef.current = true
    silentInProgressRef.current = true
    try {
      tokenClientRef.current.requestAccessToken({ prompt: '' })
    } catch (e) {
      silentInProgressRef.current = false
      console.warn('silent gcal reauth failed:', e)
    }
  }, [tokenClientReady, connected])

  // ── 3. Handle 401 — clears connection and notifies parent ─────────────────
  const handleExpired = useCallback(() => {
    sessionStorage.removeItem('gcal_token')
    window.gapi.client.setToken(null)
    setConnected(false)
    setEvents([])
    holidayCalIdRef.current = undefined
    if (onMonthEvents) onMonthEvents({})
    if (onMonthHolidays) onMonthHolidays({})
    setError('פג תוקף החיבור — אנא התחבר מחדש')
  }, [onMonthEvents, onMonthHolidays])

  // ── 4. Fetch events for the two displayed months → dots + holidays ────────
  /* The calendar shows a pair of consecutive months, so the range runs from
     the 1st of `month` to the last day of the month after it. events.list
     takes an arbitrary time window, so this is ONE request per calendar for
     the whole pair rather than one per month — half the round-trips, and no
     chance of the two months arriving out of step with each other. */
  const fetchMonthEvents = useCallback(async (year, month) => {
    if (!gapiReady || !connected) return
    const firstDay = new Date(year, month, 1)
    const lastDay  = new Date(year, month + 2, 0)   // last day of month + 1
    const timeMin  = firstDay.toISOString()
    const timeMax  = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59).toISOString()

    const listEvents = (calendarId, maxResults) =>
      window.gapi.client.calendar.events.list({
        calendarId, timeMin, timeMax,
        singleEvents: true,
        orderBy:      'startTime',
        maxResults,
      })

    // ── the studio's own calendar → the coloured dots (unchanged behaviour)
    if (onMonthEvents != null) {
      try {
        const items = (await listEvents('primary', 500)).result.items || []
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
        if (e.status === 401) { handleExpired(); return }
      }
    }

    // ── the subscribed holiday calendar → one title per day
    if (onMonthHolidays == null) return

    /* Look the calendar up by the name the ACCOUNT sees. For a calendar the
       user subscribed to and then renamed by hand — a Hebcal feed, say —
       Google keeps the feed's own title in `summary` and puts the user's name
       in `summaryOverride`, so the override has to win. Trimmed, because a
       name typed by hand can pick up a trailing space. */
    const calendarName = (c) => ((c.summaryOverride || c.summary) || '').trim()

    const resolveHolidayCalendar = async () => {
      const cals = (await window.gapi.client.calendar.calendarList.list({ maxResults: 250 })).result.items || []
      const hit = cals.find(c => calendarName(c) === HOLIDAY_CALENDAR_NAME)
      return { id: hit ? hit.id : null, names: cals.map(calendarName) }
    }

    /* Deliberately NOT cached: only a successful lookup is remembered. A
       failed one stays unresolved so the next fetch tries again, which is
       what lets a calendar subscribed (or renamed) after the app loaded be
       picked up without disconnecting Google. */
    const notFound = (names) => {
      console.warn(
        `[hours] holiday calendar "${HOLIDAY_CALENDAR_NAME}" not found. ` +
        'Calendars visible to this account:', names
      )
      setHolidayStatus('not-found')
      onMonthHolidays({})
    }

    const toMap = (items) => {
      const holidays = {}
      items.forEach(ev => {
        const ds = eventDateStr(ev)
        if (!ds || !ev.summary) return
        if (!holidays[ds]) holidays[ds] = ev.summary   // first event of the day wins
      })
      return holidays
    }

    try {
      let calId = holidayCalIdRef.current
      let known = null
      if (!calId) {
        const r = await resolveHolidayCalendar()
        known = r.names
        if (!r.id) { notFound(known); return }
        calId = holidayCalIdRef.current = r.id
      }

      let items
      try {
        items = (await listEvents(calId, 250)).result.items || []
      } catch (e) {
        if (e.status === 401) { handleExpired(); return }
        /* The cached id no longer resolves — the calendar was deleted or
           unsubscribed. Forget it and look the name up again, once. */
        holidayCalIdRef.current = undefined
        const r = await resolveHolidayCalendar()
        if (!r.id) { notFound(r.names); return }
        calId = holidayCalIdRef.current = r.id
        items = (await listEvents(calId, 250)).result.items || []
      }

      /* Nothing came back. That is ordinary for a quiet month, but it is also
         what a stale id looks like when the API answers politely instead of
         erroring, so re-resolve and retry if the name now points elsewhere. */
      if (items.length === 0) {
        const r = await resolveHolidayCalendar()
        if (!r.id) { notFound(r.names); return }
        if (r.id !== calId) {
          calId = holidayCalIdRef.current = r.id
          items = (await listEvents(calId, 250)).result.items || []
        }
      }

      setHolidayStatus('ok')
      onMonthHolidays(toMap(items))
    } catch (e) {
      /* An unreadable holiday calendar must never break the dots or the
         panel — the day cells simply show no holiday line. */
      console.warn('gcal holiday fetch skipped:', e)
      if (e.status === 401) handleExpired()
      else { holidayCalIdRef.current = undefined; onMonthHolidays({}) }
    }
  }, [gapiReady, connected, onMonthEvents, onMonthHolidays, handleExpired])

  // Re-fetch whenever the displayed window moves or the connection is made
  useEffect(() => {
    if (connected && viewYear != null && viewMonth != null) {
      fetchMonthEvents(viewYear, viewMonth)
    } else if (!connected) {
      if (onMonthEvents)   onMonthEvents({})
      if (onMonthHolidays) onMonthHolidays({})
    }
  }, [connected, viewYear, viewMonth, fetchMonthEvents, onMonthEvents, onMonthHolidays])

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
    setHolidayStatus('idle')
    const token = window.gapi?.client?.getToken()
    if (token?.access_token) {
      window.google?.accounts?.oauth2?.revoke(token.access_token, () => {})
    }
    window.gapi?.client?.setToken(null)
    sessionStorage.removeItem('gcal_token')
    setConnected(false)
    setEvents([])
    setError('')
    holidayCalIdRef.current = undefined
    if (onMonthEvents) onMonthEvents({})
    if (onMonthHolidays) onMonthHolidays({})
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
          {/* Quiet, one line, only when the holiday calendar cannot be found
              — deliberately not a banner or a modal. */}
          {holidayStatus === 'not-found' && (
            <p className="gcal-holiday-note">
              לוח החגים "{HOLIDAY_CALENDAR_NAME}" לא נמצא ברשימת היומנים
            </p>
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
