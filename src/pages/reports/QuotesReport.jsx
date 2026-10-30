import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import '../ReportTable.css'
import './QuotesReport.css'

/* ═══════════════════════════════════════════════════════════════════════
   דוח הצעות מחיר — כל ההצעות שנחתמו, חדשה למעלה.

   קריאה בלבד: שלוש שאילתות SELECT, שום כתיבה.

   ⚠️ שלוש שאילתות ולא join אחד. זה הדפוס של מסך הפניות
   (Inquiries.jsx): PostgREST היה דורש embedded resources ותלות
   בהגדרת ה-FK, והחיבור כאן הוא על עשרות שורות בודדות. הצמדה
   לדפוס הקיים עדיפה על אופטימיזציה שאיש לא יצטרך.

   v1 ו-v2 יחד: הדוח לא מסתכל על content.schema בכלל. מה שנחתם
   נחתם, ו-signed_file_url הוא המסמך — אותו שדה בשתי הסכימות.
   ⚠️ content לא נבחר בכוונה: הוא jsonb של עשרות קילובייטים לשורה,
   והדוח לא קורא ממנו דבר.
   ═══════════════════════════════════════════════════════════════════════ */

const NARROW_PX = 900

/** dd.mm.yyyy — הפורמט של שאר הדוחות. */
function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * "אור ומרינה שרון" — שמות פרטיים מחוברים ב-ו׳, ואחריהם שם המשפחה.
 *
 * ⚠️ מהאיש השני נלקחת רק המילה הראשונה. ב-contact2_name שמור שם
 * מלא ("דודי שמיע"), ובלי החיתוך השורה הייתה יוצאת
 * "רעות ודודי שמיע רוזמרין שמיע".
 */
export function clientsLabel(inq) {
  if (!inq) return '—'
  const first = String(inq.first_name ?? '').trim()
  const second = String(inq.contact2_name ?? '').trim().split(/\s+/)[0] ?? ''
  const family = String(inq.last_name ?? '').trim()
  const names = second ? `${first} ו${second}` : first
  return [names, family].filter(Boolean).join(' ') || '—'
}

/**
 * כתובת ה-PDF עם חותמת זמן.
 *
 * ⚠️ חובה בכל מקום בדוח. הצעה שנחתמה מחדש נכתבת לאותו נתיב
 * ב-Storage, והדפדפן היה מגיש את הקובץ הישן מהמטמון — כלומר מציג
 * מסמך חתום שאינו המסמך הנוכחי.
 */
export function pdfUrl(signedFileUrl, signedAt) {
  if (!signedFileUrl) return ''
  const t = signedAt ? new Date(signedAt).getTime() : ''
  if (!t || Number.isNaN(t)) return signedFileUrl
  return signedFileUrl + (signedFileUrl.includes('?') ? '&' : '?') + 't=' + t
}

const IconFile = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
)

export default function QuotesReport() {
  const navigate = useNavigate()
  const [role, setRole] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const previewRef = useRef(null)

  /* ── Admin guard — אותו שומר של שאר הדוחות ── */
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')
    }
    init()
  }, [navigate])

  /* ── Fetch ── */
  useEffect(() => {
    if (role !== 'admin') return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const { data: versions, error: vErr } = await supabase
        .from('quote_versions')
        .select('id, quote_id, version_number, signed_at, signed_file_url, is_archived')
        .eq('is_signed', true)
      if (cancelled) return
      if (vErr) { setError('טעינת ההצעות החתומות נכשלה: ' + vErr.message); setLoading(false); return }

      const live = (versions ?? []).filter(v => !v.is_archived)
      if (!live.length) { setRows([]); setLoading(false); return }

      const quoteIds = [...new Set(live.map(v => v.quote_id).filter(Boolean))]
      const { data: quotes } = await supabase
        .from('quotes').select('id, inquiry_id, quote_number').in('id', quoteIds)
      if (cancelled) return

      const inquiryIds = [...new Set((quotes ?? []).map(q => q.inquiry_id).filter(Boolean))]
      const { data: inquiries } = inquiryIds.length
        ? await supabase.from('inquiries')
          .select('id, first_name, last_name, contact2_name, city').in('id', inquiryIds)
        : { data: [] }
      if (cancelled) return

      const qById = new Map((quotes ?? []).map(q => [q.id, q]))
      const iById = new Map((inquiries ?? []).map(i => [i.id, i]))

      const built = live.map(v => {
        const q = qById.get(v.quote_id)
        const i = q ? iById.get(q.inquiry_id) : null
        return {
          id: v.id,
          signedAt: v.signed_at,
          fileUrl: v.signed_file_url || '',
          quoteNumber: q?.quote_number ?? null,
          clients: clientsLabel(i),
          city: i?.city || '—',
        }
      })
      /* חדשה למעלה. שורה בלי תאריך יורדת לסוף ולא מפילה את המיון. */
      built.sort((a, b) => {
        const ta = a.signedAt ? new Date(a.signedAt).getTime() : -Infinity
        const tb = b.signedAt ? new Date(b.signedAt).getTime() : -Infinity
        return tb - ta
      })
      setRows(built)
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [role])

  /* ברירת מחדל: החדשה ביותר, ברגע שהנתונים מגיעים. */
  useEffect(() => {
    if (!selectedId && rows.length) setSelectedId(rows[0].id)
  }, [rows, selectedId])

  const selected = useMemo(
    () => rows.find(r => r.id === selectedId) ?? null, [rows, selectedId])

  const pick = (row) => {
    setSelectedId(row.id)
    /* בטלפון התצוגה נמצאת מתחת לטבלה, ולחיצה בלי גלילה נראית
       כאילו לא קרה כלום. */
    if (window.innerWidth < NARROW_PX) {
      requestAnimationFrame(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  if (role !== 'admin') return null

  return (
    <div className="report-table-page" dir="rtl">
      <div className="report-header-row">
        <h1 className="report-page-title">דוח הצעות מחיר</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>
          ← חזרה לדוחות
        </button>
      </div>

      {loading && <p className="report-loading">טוען...</p>}
      {error && <p className="report-empty">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="report-empty">אין עדיין הצעות מחיר חתומות.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        /* ⚠️ הטבלה ראשונה ב-DOM, ולכן בימין — המכל הוא dir="rtl". */
        <div className="qr-split">
          <div className="qr-table-wrap">
            <table className="report-stage-table qr-table">
              <thead>
                <tr>
                  <th>לקוחות</th>
                  <th>יישוב</th>
                  <th>תאריך חתימה</th>
                  <th className="qr-file-col">מסמך</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.id}
                    className={'qr-row' + (r.id === selectedId ? ' qr-row--on' : '')}
                    onClick={() => pick(r)}
                  >
                    <td>{r.clients}</td>
                    <td>{r.city}</td>
                    <td>{formatDate(r.signedAt)}</td>
                    <td className="qr-file-col" onClick={e => e.stopPropagation()}>
                      {r.fileUrl ? (
                        <a
                          className="qr-file-btn"
                          href={pdfUrl(r.fileUrl, r.signedAt)}
                          target="_blank"
                          rel="noreferrer"
                          title="פתיחת המסמך החתום"
                        >
                          <IconFile />
                        </a>
                      ) : <span className="qr-nofile">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="qr-preview" ref={previewRef}>
            {selected?.fileUrl ? (
              <>
                <div className="qr-preview-head">
                  <span>{selected.clients}</span>
                  <span className="qr-preview-date">{formatDate(selected.signedAt)}</span>
                </div>
                {/* key על ה-iframe: בלעדיו החלפת src בין שורות משאירה
                    לפעמים את המסמך הקודם בצינור הרינדור של ה-PDF. */}
                <iframe
                  key={selected.id}
                  className="qr-frame"
                  src={pdfUrl(selected.fileUrl, selected.signedAt)}
                  title={`הצעה חתומה · ${selected.clients}`}
                />
              </>
            ) : (
              <div className="qr-preview-msg">
                {selected
                  ? 'להצעה הזו אין מסמך חתום שמור.'
                  : 'בחרו הצעה מהרשימה כדי לצפות במסמך.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
