// src/pages/intro/IntroMeeting.jsx
//
// "פגישת היכרות" — the screen Einav opens on a TV during a first meeting
// with a client. Opened from the Inquiries list in a new tab.
//
// ── ACCESS ───────────────────────────────────────────────────────────
// Gated on HAVING A profiles row — any staff member, admin or employee.
// Same live read, same no-wrapper-component shape as every other staff
// route in main.jsx (StaffQuestionnaireView, ProjectsKanban, Reports):
// the role is read on mount, never taken from something cached earlier.
//
// Outside <Layout /> deliberately: no header, no nav, no DEV bar. The
// screen owns the whole viewport and carries its own navigation.
//
// ── WHAT WRITES, AND WHAT DOES NOT ───────────────────────────────────
// Two areas write to THIS inquiry and nothing else, as you type:
//   01 פרטים אישיים — InquiryForm in staffEdit mode, by id.
//   02 סיכום פגישה  — inquiries.intro_meeting_summary.
// Everything under the stages map is a demo: the programma sub-screen
// runs on fictional rows with the app-wide write guard on (introDemo),
// and the VR screen is a video file.
//
// ── NAVIGATION ───────────────────────────────────────────────────────
// The areas are component state, not routes. During a meeting the back
// control must be instant and must never land on a browser-history
// surprise mid-sentence; a route per area would also put the client's
// inquiry id into three more URLs for no gain.

import { useEffect, useLayoutEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import Logo from '../../components/Logo'
import { BlockDrawing } from '../../components/gantt/blockArt'
import IntroProgramma, { ProgrammaModeSwitch } from './IntroProgramma'
import IntroVr from './IntroVr'
import IntroStages from './IntroStages'
import IntroSummary from './IntroSummary'
import InquiryForm from '../InquiryForm'
import './IntroMeeting.css'

/* The three doors. Kept here rather than inline so the home screen reads
   as a list of three equals — which is what it is. */
const DOORS = [
  { key: 'details', num: '01', title: 'פרטים אישיים',
    sub: 'הטופס שמילאתם, פתוח לתיקונים — כאן ועכשיו' },
  { key: 'summary', num: '02', title: 'סיכום פגישה',
    sub: 'מה סוכם היום, נכתב מולכם ונשמר לפנייה' },
  { key: 'stages', num: '03', title: 'שלבי התקדמות',
    sub: 'כל התהליך במפה אחת, מהפגישה הראשונה ועד שנדלק האור' },
]

/* ⚠️ תתי-מסכים, לא דלתות: מגיעים אליהם רק מתוך השלב שמוביל אליהם
   במפה, ולכן הם לא מופיעים במסך הבית. */
const SUB = {
  programma: { title: 'הפרוגרמה', sub: 'השאלון ובונה הבית: מה אתם צריכים, ואיך זה נראה' },
  vr:        { title: 'משקפי VR', sub: '' },
}

/* One size factor for the whole screen — the same device as --cpj-k on
   the client map and --pg-k on the staff stages sheet. The baseline is
   a 1440-wide laptop, so a 1920 TV reads ~33% larger and a 1366 laptop
   shrinks instead of scrolling. Clamped at both ends: below 0.78 the
   headings stop being readable from across a room, above 1.45 the three
   doors stop fitting side by side. */
const K_BASE = 1440
const kFor = (w) => Math.min(1.45, Math.max(0.78, w / K_BASE))

/* The brick of the stages sheet and the client map, drawn large. The
   viewBox is the drawing's FULL extent (faces span x ∓18, y −9…17; the
   shadow reaches 19/19), so nothing is cropped. All three doors use the
   SAME neutral state class on purpose: the numbers carry the order, and
   a coloured brick here would promise a status this screen doesn't have. */
function DoorBrick() {
  return (
    <svg className="im-door-brick cpj-block--future" viewBox="-19 -10 38 30"
      aria-hidden="true" focusable="false">
      <BlockDrawing />
    </svg>
  )
}

function Pane({ text }) {
  return <div className="im-pane">{text}</div>
}

export default function IntroMeeting() {
  const { inquiryId } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState('loading')   // loading | ready
  const [name, setName] = useState('')
  const [area, setArea] = useState(null)            // null = home
  const [sub, setSub] = useState(null)              // תת-מסך מתוך מפת השלבים
  /* The view switch of area 02. It lives up here so it survives leaving
     the area and coming back during one meeting. */
  const [programmaMode, setProgrammaMode] = useState('wide')

  const [k, setK] = useState(() => kFor(typeof window === 'undefined' ? K_BASE : window.innerWidth))
  useLayoutEffect(() => {
    const onResize = () => setK(kFor(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }

      const { data: profile, error: profileErr } = await supabase
        .from('profiles').select('id').eq('id', session.user.id).maybeSingle()
      if (cancelled) return
      if (profileErr || !profile) { navigate('/no-access'); return }

      const { data: inq } = await supabase
        .from('inquiries').select('first_name, last_name')
        .eq('id', inquiryId).maybeSingle()
      if (cancelled) return

      /* The family name is what a client hears themselves called in the
         room. Falls back to the first name, then to nothing at all —
         never to a placeholder like "לקוח". */
      const family = inq?.last_name?.trim() || inq?.first_name?.trim() || ''
      setName(family)
      setStatus('ready')
    }
    init()
    return () => { cancelled = true }
  }, [inquiryId, navigate])

  if (status !== 'ready') return <Pane text="טוען…" />

  const title = 'פגישת היכרות' + (name ? ` · משפחת ${name}` : '')
  const door = sub ? SUB[sub] : DOORS.find(d => d.key === area)
  /* "חזור" תמיד צעד אחד אחורה: מתת-מסך אל המפה, ומאזור אל הבית. */
  const goBack = () => (sub ? setSub(null) : setArea(null))

  return (
    <div className="im-root" style={{ '--im-k': k }}>

      <div className="im-top">
        <Logo height={Math.round(28 * k)} />
        <span className="im-top-sp" />
        <span className="im-top-title">{title}</span>
      </div>

      {area === null && !sub ? (
        <div className="im-home">
          <div className="im-home-top">
            <p className="im-kicker">נעים להכיר</p>
            <h1 className="im-head">בית נבנה<br /><em>לבנה אחר לבנה.</em></h1>
          </div>

          <div className="im-doors">
            {DOORS.map(d => (
              <button key={d.key} type="button" className="im-door"
                onClick={() => setArea(d.key)}>
                <span className="im-door-art">
                  <DoorBrick />
                </span>
                {/* ⚠️ המספר ראשון ב-DOM: המסך dir="rtl", ולכן הילד
                    הראשון בשורה הוא הימני — וזה המקום שבו המספר
                    צריך לשבת ביחס לכותרת. */}
                <span className="im-door-head">
                  <span className="im-door-num">{d.num}</span>
                  <h2 className="im-door-title">{d.title}</h2>
                </span>
                <p className="im-door-sub">{d.sub}</p>
                <span className="im-door-rule" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="im-area" key={area}>
          {/* ⚠️ סדר ה-DOM הוא גם הסדר החזותי: המסך dir="rtl", ולכן
              הילד האחרון בשורה יושב בפינה השמאלית. "חזור" אחרון,
              ולכן שמאלי — וכך בשלושת האזורים. */}
          <div className="im-area-head">
            <h2 className="im-area-title">{door.title}</h2>
            <span className="im-area-sub">{door.sub}</span>
            <span className="im-area-sp" />
            {sub === 'programma' && (
              <ProgrammaModeSwitch mode={programmaMode} onMode={setProgrammaMode} />
            )}
            <button type="button" className="im-back" onClick={goBack}>
              חזור
            </button>
          </div>

          <div className="im-area-body">
            {area === 'details' && !sub && (
              <div className="im-form">
                <InquiryForm staffEdit inquiryId={inquiryId} />
              </div>
            )}

            {area === 'summary' && !sub && <IntroSummary inquiryId={inquiryId} />}

            {/* מפת השלבים — היא גם מה שפותח את שני תתי-המסכים. */}
            {area === 'stages' && !sub && <IntroStages onOpen={setSub} />}

            {sub === 'programma' && <IntroProgramma mode={programmaMode} />}

            {sub === 'vr' && <IntroVr />}
          </div>
        </div>
      )}
    </div>
  )
}
