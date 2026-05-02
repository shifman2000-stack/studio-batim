import { useEffect, useRef, useState } from 'react'
import './QuotePreview.css'
import SignatureCanvas from './SignatureCanvas'
import { PenLine, Pencil } from 'lucide-react'

// Inject a one-time <style> for the client2-name placeholder color.
// React doesn't support ::placeholder via inline styles, so we do it once at
// module load time instead of coupling it to the CSS file.
if (typeof document !== 'undefined' && !document.getElementById('quote-preview-placeholder-style')) {
  const styleEl = document.createElement('style')
  styleEl.id = 'quote-preview-placeholder-style'
  styleEl.textContent = `.qp-placeholder-light::placeholder { color: rgba(26,26,24,0.35); font-style: italic; font-weight: 300; }`
  document.head.appendChild(styleEl)
}

if (typeof document !== 'undefined' && !document.getElementById('quote-preview-date-style')) {
  const styleEl = document.createElement('style')
  styleEl.id = 'quote-preview-date-style'
  styleEl.textContent = `
    input[type="date"]::-webkit-calendar-picker-indicator {
      opacity: 0.4;
      cursor: pointer;
    }
    input[type="date"]:hover::-webkit-calendar-picker-indicator {
      opacity: 0.8;
    }
    input[type="date"]:focus {
      border-bottom-color: #7a9478 !important;
    }
  `
  document.head.appendChild(styleEl)
}

/* ═══════════════════════════════════════════════════════
   DEFAULT DATA
═══════════════════════════════════════════════════════ */

export function buildInitialData(inquiry = {}) {
  const today = new Intl.DateTimeFormat('he-IL', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())

  return {
    date:           today,
    clientLastName: inquiry.last_name ?? '',

    client1: {
      name:  [inquiry.first_name, inquiry.last_name].filter(Boolean).join(' '),
      id:    '',
      phone: inquiry.phone  ?? '',
      email: inquiry.email  ?? '',
    },

    client2: {
      name:   inquiry.contact2_name  ?? '',
      id:     '',
      phone:  inquiry.contact2_phone ?? '',
      email:  inquiry.contact2_email ?? '',
      hidden: false,
    },

    property: inquiry.city ?? '',

    scopeItems: [
      { text: 'תכנון בית מגורים כולל פיתוח שטח המגרש' },
      { text: 'הגשת בקשה להיתר בניה, כולל פיקוח עליון' },
      { text: 'הפקת תוכניות עבודה' },
      { text: 'ליווי בניה' },
    ],

    feeAmount: '',

    paymentRows: [
      { milestone: 'עם חתימת החוזה',                   scope: 'איסוף מידע ותכנון ראשוני',                  duration: '30 ימי עבודה מפגישת פרוגראמה',    pct: '15%' },
      { milestone: 'עם מסירת סקיצות ראשונות',          scope: 'פיתוח תוכנית סופית',                        duration: '10 ימי עבודה בין פגישה לפגישה',   pct: '20%' },
      { milestone: 'עם אישור חלופת תכנון',             scope: 'הכנת בקשה להיתר (גרמושקה)',                 duration: '30 ימי עבודה מאישור החלופה',      pct: '20%' },
      { milestone: 'עם פתיחת בקשה במערכת רישוי זמין', scope: 'טיפול בבקשה להיתר',                         duration: 'בהתאם לרשויות',                   pct: '20%' },
      { milestone: 'עם אישור ו.רישוי',                 scope: 'תוכניות עבודה, פיקוח עליון, שעות ייעוץ',   duration: '30 ימי עבודה + 10 ימי עיבוד',     pct: '20%' },
      { milestone: 'עם סיום הבניה *',                  scope: 'סיום פרויקט וחתימה על טופס 4',              duration: '—',                                pct: '5%'  },
    ],

    // ── Page 2 — Stage 01 תכנון ──
    s01_lead: 'תכנון בית מגורים ופיתוח שטח המגרש.',

    s01_prog: [
      'עם תחילת שלב התכנון תערך פגישת פרוגרמה וביקור המתכנן בשטח, בה יגבשו המתכנן והמזמין פרוגרמה תכנונית ועיצובית מפורטת — הכוללת הגדרת תכולה ואופי התכנון, צרכים, רצונות, סגנון עיצובי ודרישות מיוחדות — אשר תאושר ע״י המזמין.',
    ],

    s01_measure: [
      'התכנון יעשה על גבי קובץ מדידה להיתר בלבד, בפורמט DWG, אשר יועבר למתכנן על ידי מודד מוסמך. במידה והפרויקט כולל תכנון המשתלב במבנה קיים, נדרשת גם מדידת פנים/אל-הרס של המבנה הקיים בפורמט DWG.',
      'ההתקשרות מול מודד מוסמך תהיה ישירות על ידי המזמין ועל חשבונו.',
    ],

    s01_alts: [
      'המתכנן יגיש למזמין חלופות תכנון התואמות לפרוגרמה ולאפשרויות הקיימות. פגישה ראשונה להצגת החלופות תערך כחודש מפגישת הפרוגרמה, והמשך הפגישות בתדירות שבועית בכפוף לזמינות המשתתפים. הפגישות יערכו במשרדי סטודיו בתים או בזום.',
      'החלופות יכללו חלוקת חללים, העמדת ריהוט, כלים סניטריים ושימושי החצר, ויפותחו בתאום עם המזמין עד להגעה לחלופת תכנון סופית ומאושרת.',
      'מתום 4 חודשים קלנדריים מפגישת הפרוגרמה, במידה ולא אושרה סקיצה — מוסכם על תוספת של 500 ₪ עבור כל חודש נוסף.',
    ],

    s01_render: [
      'המתכנן יכין הדמיה תלת-ממדית ממוחשבת עבור חלופת תכנון סופית מאושרת, הכוללת מבטי חוץ לצרכי היתר בלבד.',
    ],

    // ── Page 2 — Stage 02 היתר בניה ──
    s02_planner: [
      'המתכנן הינו עורך הבקשה להיתר ואחראי לביקורת אדריכלות.',
      'המתכנן יגיש בקשה לקבלת תיק מידע מהוועדה לתכנון ובניה עם תחילת שלב התכנון הראשוני.',
      'המתכנן יגיש בקשה להיתר בניה (מאושרת וחתומה על ידי המזמין) לוועדה במערכת רישוי זמין, יטפל בכל שלבי הבקשה, וינחה את המזמין במטלות הנדרשות ממנו להשלמתה.',
      'המתכנן יתאם בין היועצים השונים (מהנדס קונסטרוקציה, יועץ אינסטלציה וכיו״ב). ההתקשרות מול היועצים תהיה ישירות על ידי המזמין ועל חשבונו.',
    ],

    s02_client: [
      'השגת מסמכים, חתימתם וחתימת עו״ד במידת הצורך, כדי לקדם את הבקשה מול הרשויות והגופים השונים ובהתאם לדרישות.',
      'בדיקת היקפי האגרות המוטלות על הבניה — דמי היתר רמ״י, היטל השבחה, אגרות פיתוח, אגרת ביוב, אגרת בניה וכיו״ב.',
      'מינוי אחראי לביקורת על ביצוע השלד ואחראי לביצוע שלד על-פי הנחיית וועדת התכנון.',
      'איסוף והחתמת המסמכים הדרושים והגשתם לוועדה לצורך קבלת טופס 4.',
    ],

    s02_supervision: [
      'בשלב הביצוע המתכנן יבצע פיקוח עליון לצורכי רישוי בלבד, הכולל 4 ביקורים (ראה פירוט בשלב ליווי הבניה).',
      'המתכנן יחתום על הטפסים הנדרשים כאחראי לביקורת אדריכלות וכעורך הבקשה: היתר בניה, טופס תחילת עבודה (טופס 2) וטופס גמר (טופס 4). חתימה על טפסי עורך בקשה לטופס 4 תבוצע לאחר העברת תשלום אחרון.',
    ],

    // ── Page 3 — Stage 03 תוכניות עבודה ──
    s03_lead:    'המתכנן יערוך תוכניות לביצוע (תואמות להיתר הבניה וללא חריגות) הכוללות:',
    s03_twoCol: [
      'תכנית בניה, חתכים וחזיתות עבור כל קומה',
      'תכנית העמדת הבניין במגרש',
      'תכנית העמדת ריהוט, כולל מטבח וחדרי רחצה במבט על',
      'פריסות חדרי רחצה',
      'תכנית חשמל, תקשורת ותאורה',
      'תכנית מיזוג אויר',
      'תוכנית אינסטלציה',
      'רשימת פתחי חלונות',
      'תוכנית גגות',
      'תכנית פיתוח שטח',
      'תוכנית מדרגות',
    ],
    s03_closing:  'בנוסף, יכין המתכנן מפרט כמויות גמר: חדרי רחצה, חיפויים, ריצופים ומשטחים.',
    s03_meetings: 'המתכנן יערוך פגישות עם המזמין להצגת התוכניות ויבצע סבב תיקונים אחד מול המזמין. לאחר מכן יוצאו התוכניות להצעות מחיר מקבלנים. עם בחירת הקבלן (ובהתאם לצורך, גם המפקח) יבוצע סבב תיקונים נוסף מולם, שלאחריו יימסרו התוכניות הסופיות לביצוע.',

    // ── Page 3 — Stage 04 ליווי בניה ──
    s04_supervision: [
      'במסגרת תפקיד המתכנן כמפקח עליון, יבוצעו 4 ביקורים לצורכי רישוי: סימון קווי בניין, גמר יסודות, גמר שלד וגמר בניין — בנוכחות מנהל עבודה/מפקח בניה, לצורך בקרה על התאמת הבניה להיתר בלבד.',
      'ליווי הבניה מוגבל ל-12 חודשים ממתן ההיתר. בתום תקופה זו יגבה תשלום של 500 ₪ בתוספת מע״מ עבור כל חודש נוסף של ליווי.',
    ],
    s04_extraVisits: [
      'המתכנן יבצע עד שני ביקורים נוספים בשטח לפגישות והסברים לבעלי המקצוע ולקבלן. עבור כל ביקור נוסף מעבר לכך יגבה סך של 650 ₪ + מע״מ.',
      'באחריות מנהל העבודה/המפקח/המזמין לעדכן את המתכנן בסוגיות ובשלבי הביצוע, ולתאם ביקור בשטח יומיים מראש לכל הפחות.',
      'המתכנן ייתן מענה לסוגיות תכנוניות שעולות במהלך הבניה מול בעלי המקצוע, ככל שנוגע לתחום אחריותו.',
    ],
    s04_finishConsult: [
      'המתכנן יעמיד לרשות המזמין פגישת ייעוץ בסטודיו לבחירת צבעי גמר קירות וחלונות.',
      'המתכנן יתלווה למזמין לסיור אחד בצנרת דרום באשקלון לבחירת חיפויים, ריצופים וכלים סניטריים.',
      'פגישת הייעוץ וליווי לצנרת דרום יעמדו לרשות המזמין בתאום מראש, ועד שנה מקבלת היתר בניה.',
    ],
    s04_instructions: [
      'המזמין (בעל ההיתר) מתחייב לבנות לפי תוכניות היתר הבניה. על פי חוק, מחובתו של המתכנן כאחראי לביקורת לדווח בכתב לוועדה לתכנון ובניה על כל סטייה מההיתר.',
      'המזמין ידאג למילוי ההוראות שבתוכניות העבודה ולבטיחות באתר בהתאם להוראות החוק ודרישת הוועדה המקומית.',
      'אחריות על טיב ביצוע העבודה והחומרים חלה על המבצעים.',
    ],

    // ── Page 4 — Terms (12 items flat; rendered in 3 groups of 4) ──
    terms: [
      // Group 1 — תנאי ההצעה (1–4)
      'הצעת המחיר תואמת לנתונים המפורטים בתכולת השירות ובפירוט שלבי העבודה. במידה וישתנו הנתונים תעודכן הצעת המחיר בהתאם.',
      'שינוי פרוגרמה, או כל שינוי אחר הכרוך בחזרה על שלבי עבודה שהסתיימו, וכן תוספת שעות מעבר למוגדר בהסכם (כגון שעות ייעוץ) — ייעשה תמורת תשלום של 350 ₪ לשעת עבודה, בתוספת מע״מ כחוק.',
      'משך הזמן המוגדר לכל שלב מהווה הערכה עקרונית, תוך גמישות והבנה כי קיימים אילוצים שונים שיכולים להשפיע על מסגרת הזמן — לרבות סיבות שאינן תלויות באף אחד מהצדדים ו/או כוח עליון.',
      'תשלום ראשון מהווה הסכמה של שני הצדדים להמשך עבודה על פי הסכם זה, ויהווה מתן תוקף להסכם.',
      // Group 2 — מה אינו כלול בהצעה (5–8)
      'שירותי יועצים שונים: מפקח בניה, מודד, יועץ קרקע, מהנדסי קונסטרוקציה/אינסטלציה/חשמל, אדריכל נוף, יועץ בטיחות אש וכיו״ב.',
      'תשלום אגרות, היטלים או כל תשלום אחר שיידרש על ידי הרשויות השונות.',
      'צילומי תוכניות והדפסות, שליחויות ע״י מכון הצילום ומשלוחי דואר. המזמין יפרע חיובים אלו ישירות מול מכון הצילום.',
      'סוגיות תכנון רישוי וביצוע חריגות — יתומחרו בנפרד בהתאם.',
      // Group 3 — זכויות ואחריות (9–12)
      'למתכנן שמורה זכות היוצרים על התכנון. המתכנן רשאי לעשות שימוש בתוכניות ללא הגבלה. המזמין אינו רשאי להשתמש בתוכניות או בהעתק שלהן למעט לצורך הקמת הפרויקט הכלול בהסכם זה בלבד.',
      'אין המתכנן אחראי על עבודה ללא היתר בניה ו/או בסטייה ממנו. המתכנן רשאי להפסיק את הטיפול בתיק ולהסיר כל אחריות במקרה של איחור בתשלומים, בניה ללא היתר או ביצוע חריגות בניה.',
      'לא יוחזר למזמין סכום אשר שולם למתכנן על חשבון שכר טרחתו — לרבות עקב השהיית הפרויקט, אי מתן היתר ו/או סירוב על פי החלטת הוועדה לתכנון ובניה או כל גוף או רשות אחרים.',
      'במידה והפרויקט מושהה מכל סיבה שהיא, בכל שלב, לפרק זמן העולה על 90 יום — הסכם זה יבוטל, והמשך העבודה ייעשה בהתקשרות מחודשת. כך גם במקרה של הפסקת בניה שהחלה לפרק זמן העולה על 90 יום.',
    ],

    validity:      'הסכם זה מהווה הצעת מחיר התקפה ל-60 יום מהתאריך הנקוב בה.',
    sig1:          { name: '', date: '', signature: '' },
    sig2:          { name: '', date: '', signature: '' },
    closingName:   'עינב שיפמן',
    closingStudio: 'סטודיו בתים',
  }
}

/* ═══════════════════════════════════════════════════════
   FIELD — transparent single-line input
═══════════════════════════════════════════════════════ */
function Field({ value, onChange, isReadOnly, className = '', style, dir, placeholder }) {
  if (isReadOnly) {
    return <span dir={dir} className={className} style={style}>{value || ''}</span>
  }
  return (
    <input
      type="text"
      className={`qp-field${className ? ' ' + className : ''}`}
      style={style}
      dir={dir}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}

/* ═══════════════════════════════════════════════════════
   DATE FIELD — native date picker; reads/writes YYYY-MM-DD
   Read-only display: converts to D/M/YYYY (matches RTL convention)
═══════════════════════════════════════════════════════ */
function DateField({ value, onChange, isReadOnly, className = '', style }) {
  const formatForDisplay = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    if (!y || !m || !d) return iso
    return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`
  }
  if (isReadOnly) {
    return <span className={className} style={style}>{formatForDisplay(value)}</span>
  }
  return (
    <input
      type="date"
      className={className}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid rgba(26,26,24,0.22)',
        padding: '2px 0',
        fontFamily: "'Heebo', sans-serif",
        fontSize: 'inherit',
        color: '#1a1a18',
        outline: 'none',
        cursor: 'pointer',
        direction: 'ltr',
        minWidth: '7em',
        ...style,
      }}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
    />
  )
}

/* ═══════════════════════════════════════════════════════
   AREA — transparent auto-expanding textarea
═══════════════════════════════════════════════════════ */
function Area({ value, onChange, isReadOnly, className = '', style }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])

  if (isReadOnly) {
    return <span className={className} style={style}>{value}</span>
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`qp-field-area${className ? ' ' + className : ''}`}
      style={style}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
    />
  )
}

/* ═══════════════════════════════════════════════════════
   PAGE HEADER — logo + editable date
═══════════════════════════════════════════════════════ */
function PageHeader({ dateValue, onDateChange, isReadOnly }) {
  return (
    <div className="header">
      <div className="logo">
        <span className="logo-main">סטודיו בתים</span>
        <span className="logo-vline" />
        <span className="logo-sub">BY EINAV SHIFMAN</span>
      </div>
      <div className="meta-date">
        <Field
          value={dateValue}
          onChange={onDateChange}
          isReadOnly={isReadOnly}
          style={{ width: '9em' }}
        />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
   SUBSTAGE LIST — editable bullet list
═══════════════════════════════════════════════════════ */
function SubstageList({ items, onUpdate, isReadOnly }) {
  return (
    <ul className="substage-list">
      {items.map((text, i) => (
        <li key={i}>
          <Area
            value={text}
            onChange={val => onUpdate(items.map((t, j) => j === i ? val : t))}
            isReadOnly={isReadOnly}
          />
        </li>
      ))}
    </ul>
  )
}

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   Props:
     inquiry        – inquiry row (for auto-fill via buildInitialData)
     content        – saved draft_content object
     data           – alias for content (backward compat with QuoteBuilder)
     onChange       – called with the full updated data object
     isReadOnly     – disables all editing when true
     editableFields – list of dot-paths that remain editable even when
                      isReadOnly=true (e.g. ['client1.name', 'sig1.date'])
═══════════════════════════════════════════════════════ */
export default function QuotePreview({
  inquiry = {},
  content,
  data: legacyData,   // QuoteBuilder passes data={...}
  onChange,
  isReadOnly = false,
  editableFields = [],
}) {
  const data = content ?? legacyData ?? buildInitialData(inquiry)
  const ro   = isReadOnly

  // Returns true when this field path should be interactive.
  // In full edit mode (!isReadOnly) everything is editable.
  // In read-only mode, only paths listed in editableFields are interactive.
  // Use '_locked' as the path for fields that are always locked in read-only.
  const canEdit = (path) => !isReadOnly || editableFields.includes(path)

  // Which sig box is currently open for drawing: 'sig1' | 'sig2' | null
  const [signingFor, setSigningFor] = useState(null)

  const patch = (key, val) => onChange?.({ ...data, [key]: val })

  // patchClient: update a client sub-field.
  // Auto-fills the matching sig name when in read-only (client signing) mode
  // and the client is filling in their name.
  const patchClient = (which, field, val) => {
    const updated = { ...data, [which]: { ...data[which], [field]: val } }
    if (isReadOnly && field === 'name') {
      const sigKey = which === 'client1' ? 'sig1' : 'sig2'
      updated[sigKey] = { ...data[sigKey], name: val }
    }
    onChange?.(updated)
  }

  // scope helpers
  const updateScope = (i, val) =>
    patch('scopeItems', data.scopeItems.map((s, j) => j === i ? { text: val } : s))
  const addScope    = ()  => patch('scopeItems', [...data.scopeItems, { text: '' }])
  const removeScope = (i) => patch('scopeItems', data.scopeItems.filter((_, j) => j !== i))

  // payment helpers
  const updatePayment = (i, field, val) =>
    patch('paymentRows', data.paymentRows.map((p, j) => j === i ? { ...p, [field]: val } : p))
  const addPayment    = ()  => patch('paymentRows', [...data.paymentRows, { milestone: '', scope: '', duration: '', pct: '' }])
  const removePayment = (i) => patch('paymentRows', data.paymentRows.filter((_, j) => j !== i))

  // page 2+ substage list helper
  const patchList = (key) => (newItems) => patch(key, newItems)

  // page 4 terms helper
  const updateTerm = (i, val) =>
    patch('terms', data.terms.map((t, j) => j === i ? val : t))

  /* ── PDF export via hidden iframe ── */
  const pagesRef = useRef(null)

  const handlePrint = async () => {
    const container = pagesRef.current
    if (!container) return

    // STEP A — Sync live DOM properties → attributes so cloneNode picks them up.
    container.querySelectorAll('input').forEach(el => {
      el.setAttribute('value', el.value)
    })
    container.querySelectorAll('textarea').forEach(el => {
      el.textContent = el.value
    })
    container.querySelectorAll('[contenteditable]').forEach(el => {
      // innerHTML already reflects user edits; nothing extra needed
    })

    // STEP B — Create a hidden iframe isolated from the main document's CSS cascade
    const iframe = document.createElement('iframe')
    iframe.style.cssText =
      'position:fixed;right:-10000px;top:0;width:210mm;height:297mm;border:none;visibility:hidden;'
    document.body.appendChild(iframe)

    try {
      const iDoc = iframe.contentDocument

      const linkTags = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(l => l.outerHTML).join('\n')

      const styleTags = Array.from(document.querySelectorAll('style'))
        .map(s => `<style>${s.innerHTML}</style>`).join('\n')

      const clone = container.cloneNode(true)
      clone.querySelectorAll('.qp-no-print, button').forEach(el => el.remove())

      iDoc.open()
      iDoc.write(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
${linkTags}
${styleTags}
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; direction: rtl; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .qp-pages > * {
    width: 210mm;
    height: 297mm;
    margin: 0 !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    overflow: hidden !important;
    page-break-after: always;
    break-after: page;
  }
  .qp-pages > *:last-child { page-break-after: auto; break-after: auto; }
  .qb-bar, .qb-bar-actions, .qb-status-badge, #pdf-btn,
  .qp-row-remove, .qp-row-add, .qp-col-hide-btn { display: none !important; }
  .qp-field, .qp-field-area { border-bottom-color: transparent !important; }
</style>
</head>
<body>
</body>
</html>`)
      iDoc.close()
      iDoc.body.appendChild(clone)

      await new Promise(resolve => {
        if (iframe.contentDocument.readyState === 'complete') resolve()
        else iframe.contentWindow.addEventListener('load', resolve, { once: true })
      })
      await iframe.contentDocument.fonts.ready
      await new Promise(r => setTimeout(r, 200))

      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } finally {
      setTimeout(() => iframe.remove(), 1000)
    }
  }

  return (
    <>
      <div data-qb-page className="qp-pages" ref={pagesRef}>

      {/* ════════════════════════════════════════════════
           PAGE 1 — הצעת מחיר + לוח תשלומים
      ════════════════════════════════════════════════ */}
      <div className="page">

        <PageHeader
          dateValue={data.date}
          onDateChange={val => patch('date', val)}
          isReadOnly={!canEdit('date')}
        />

        {/* Hero title */}
        <div className="hero">
          <h1 className="hero-title">
            הצעת מחיר{' '}
            <span style={{ color: 'var(--warm-gray)' }}>—</span>
            {' '}משפחת{' '}
            <Field
              value={data.clientLastName}
              onChange={val => patch('clientLastName', val)}
              isReadOnly={!canEdit('clientLastName')}
              style={{ minWidth: '3em', width: `${Math.max(3, (data.clientLastName?.length ?? 0) + 1)}ch` }}
            />
          </h1>
        </div>

        {/* Clients grid */}
        <div
          className="parties-clients"
          style={{ gridTemplateColumns: data.client2?.hidden ? '1fr' : '1fr 1fr' }}
        >
          {/* Client 1 */}
          <div>
            <div className="eyebrow">המזמין</div>
            <div className="party-name">
              <Field value={data.client1.name} onChange={val => patchClient('client1', 'name', val)} isReadOnly={!canEdit('client1.name')} style={{ width: '100%' }} />
            </div>
            <div className="party-detail">
              <span className="label">ת.ז.</span>{' '}
              <Field value={data.client1.id}    onChange={val => patchClient('client1', 'id',    val)} isReadOnly={!canEdit('client1.id')}    style={{ width: '8em' }} />
              <br />
              <span className="label">טלפון</span>{' '}
              <Field value={data.client1.phone} onChange={val => patchClient('client1', 'phone', val)} isReadOnly={!canEdit('client1.phone')} dir="ltr" style={{ width: '9em' }} />
              <br />
              <span className="label">דוא״ל</span>{' '}
              <Field value={data.client1.email} onChange={val => patchClient('client1', 'email', val)} isReadOnly={!canEdit('client1.email')} dir="ltr" style={{ width: '13em' }} />
            </div>
          </div>

          {/* Client 2 */}
          {!data.client2?.hidden && (
            <div className="party-client-spacer" style={{ position: 'relative' }}>
              {!ro && (
                <button
                  className="qp-col-hide-btn qp-no-print"
                  onClick={() => patch('client2', { ...data.client2, hidden: true })}
                  title="הסתר"
                >×</button>
              )}
              <div className="party-name">
                <Field value={data.client2.name} onChange={val => patchClient('client2', 'name', val)} isReadOnly={!canEdit('client2.name')} placeholder="שם 2" className="qp-placeholder-light" style={{ width: '100%' }} />
              </div>
              <div className="party-detail">
                <span className="label">ת.ז.</span>{' '}
                <Field value={data.client2.id}    onChange={val => patchClient('client2', 'id',    val)} isReadOnly={!canEdit('client2.id')}    style={{ width: '8em' }} />
                <br />
                <span className="label">טלפון</span>{' '}
                <Field value={data.client2.phone} onChange={val => patchClient('client2', 'phone', val)} isReadOnly={!canEdit('client2.phone')} dir="ltr" style={{ width: '9em' }} />
                <br />
                <span className="label">דוא״ל</span>{' '}
                <Field value={data.client2.email} onChange={val => patchClient('client2', 'email', val)} isReadOnly={!canEdit('client2.email')} dir="ltr" style={{ width: '13em' }} />
              </div>
            </div>
          )}
        </div>

        {/* Restore client2 */}
        {data.client2?.hidden && !ro && (
          <button
            className="qp-row-add qp-no-print"
            style={{ marginBottom: 8 }}
            onClick={() => patch('client2', { ...data.client2, hidden: false })}
          >+ הוסף מזמין נוסף</button>
        )}

        {/* Planner — always static */}
        <div className="party-planner">
          <div className="eyebrow">המתכנן</div>
          <div className="party-name">עינב שיפמן · סטודיו בתים</div>
          <div className="party-detail">
            <span className="label">ע.מ.</span> 031432826 &nbsp;·&nbsp;
            <span className="label">כתובת</span> קיבוץ נגבה &nbsp;·&nbsp;
            <span className="label">טלפון</span> 052-9593927 &nbsp;·&nbsp;
            <span className="label">דוא״ל</span> einav.studiob@gmail.com
          </div>
        </div>

        {/* Property */}
        <div className="info-row">
          <div className="info-label">כתובת הנכס</div>
          <div className="info-value">
            <Field value={data.property} onChange={val => patch('property', val)} isReadOnly={!canEdit('_locked')} style={{ width: '100%' }} />
          </div>
        </div>

        {/* Scope of service */}
        <div className="scope">
          <div className="eyebrow">תכולת השירות</div>
          <ul className="scope-list">
            {data.scopeItems.map((item, i) => (
              <li key={i} className="scope-item">
                <span className="scope-num">{i + 1}.</span>
                <Field
                  value={item.text}
                  onChange={val => updateScope(i, val)}
                  isReadOnly={!canEdit('_locked')}
                  style={{ flex: 1, minWidth: 0 }}
                />
                {!ro && (
                  <button className="qp-row-remove qp-no-print" onClick={() => removeScope(i)} title="הסר">×</button>
                )}
              </li>
            ))}
          </ul>
          {!ro && (
            <button className="qp-row-add qp-no-print" onClick={addScope}>+ הוסף שירות</button>
          )}
        </div>

        {/* Fee */}
        <div className="fee">
          <div className="fee-label">שכר טרחה כולל</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="fee-amount">
              <Field
                value={data.feeAmount}
                onChange={val => patch('feeAmount', val)}
                isReadOnly={!canEdit('_locked')}
                dir="ltr"
                style={{ minWidth: '4em', width: `${Math.max(4, (data.feeAmount?.length ?? 0) + 1)}ch` }}
              />
              {' ₪'}
            </span>
            <span className="fee-vat">בתוספת מע״מ כחוק</span>
          </div>
        </div>

        {/* Payment table */}
        <div>
          <div className="pay-heading">לוח תשלומים</div>
          <table className="pay">
            <colgroup>
              <col style={{ width: 30 }} />
              <col style={{ width: 215 }} />
              <col style={{ width: 200 }} />
              <col />
              <col style={{ width: 46 }} />
              {!ro && <col className="qp-no-print" style={{ width: 22 }} />}
            </colgroup>
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>מועד תשלום</th>
                <th>תכולת השלב</th>
                <th>משך זמן מוערך</th>
                <th className="col-pct">אחוז</th>
                {!ro && <th className="qp-no-print" />}
              </tr>
            </thead>
            <tbody>
              {data.paymentRows.map((p, i) => (
                <tr key={i}>
                  <td className="col-num">{i + 1}</td>
                  <td><Field value={p.milestone} onChange={val => updatePayment(i, 'milestone', val)} isReadOnly={!canEdit('_locked')} style={{ width: '100%' }} /></td>
                  <td><Field value={p.scope}     onChange={val => updatePayment(i, 'scope',     val)} isReadOnly={!canEdit('_locked')} style={{ width: '100%' }} /></td>
                  <td className="col-span"><Field value={p.duration} onChange={val => updatePayment(i, 'duration', val)} isReadOnly={!canEdit('_locked')} style={{ width: '100%' }} /></td>
                  <td className="col-pct"><Field  value={p.pct}      onChange={val => updatePayment(i, 'pct',      val)} isReadOnly={!canEdit('_locked')} dir="ltr" style={{ width: '100%' }} /></td>
                  {!ro && (
                    <td className="qp-no-print">
                      <button className="qp-row-remove" onClick={() => removePayment(i)} title="הסר">×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-note">* עד 12 חודשים מקבלת היתר</div>
          {!ro && (
            <button className="qp-row-add qp-no-print" onClick={addPayment}>+ הוסף שלב תשלום</button>
          )}
        </div>

        <div className="page-foot">
          <span>סטודיו בתים · אדריכלות ועיצוב פנים</span>
          <span>עמוד 1 · מתוך 4</span>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
           PAGE 2 — תכנון + היתר בניה
      ════════════════════════════════════════════════ */}
      <div className="page">

        <PageHeader dateValue={data.date} onDateChange={val => patch('date', val)} isReadOnly={!canEdit('_locked')} />

        <div className="hero hero-with-line" style={{ marginBottom: 20, paddingBottom: 14 }}>
          <div className="eyebrow">תהליך העבודה</div>
          <h1 className="hero-title" style={{ fontSize: 26 }}>פירוט שלבי העבודה</h1>
        </div>

        {/* STAGE 01 — תכנון */}
        <div className="stage">
          <div className="stage-head">
            <span className="stage-num">01</span>
            <span className="stage-title">תכנון</span>
          </div>
          <div className="stage-body">
            <p className="stage-lead">
              <Area value={data.s01_lead} onChange={val => patch('s01_lead', val)} isReadOnly={!canEdit('_locked')} />
            </p>
            <div className="substage">
              <div className="substage-title">פרוגרמה</div>
              <SubstageList items={data.s01_prog}    onUpdate={patchList('s01_prog')}    isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">מדידה</div>
              <SubstageList items={data.s01_measure} onUpdate={patchList('s01_measure')} isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">חלופות תכנון</div>
              <SubstageList items={data.s01_alts}    onUpdate={patchList('s01_alts')}    isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">הדמיה</div>
              <SubstageList items={data.s01_render}  onUpdate={patchList('s01_render')}  isReadOnly={!canEdit('_locked')} />
            </div>
          </div>
        </div>

        {/* STAGE 02 — היתר בניה */}
        <div className="stage stage-last">
          <div className="stage-head">
            <span className="stage-num">02</span>
            <span className="stage-title">היתר בניה</span>
          </div>
          <div className="stage-body">
            <div className="substage">
              <div className="substage-title">תפקיד המתכנן</div>
              <SubstageList items={data.s02_planner}     onUpdate={patchList('s02_planner')}     isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">אחריות המזמין</div>
              <SubstageList items={data.s02_client}      onUpdate={patchList('s02_client')}      isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">פיקוח וחתימות</div>
              <SubstageList items={data.s02_supervision} onUpdate={patchList('s02_supervision')} isReadOnly={!canEdit('_locked')} />
            </div>
          </div>
        </div>

        <div className="page-foot">
          <span>סטודיו בתים · אדריכלות ועיצוב פנים</span>
          <span>עמוד 2 · מתוך 4</span>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
           PAGE 3 — תוכניות עבודה + ליווי בניה
      ════════════════════════════════════════════════ */}
      <div className="page">

        <PageHeader dateValue={data.date} onDateChange={val => patch('date', val)} isReadOnly={!canEdit('_locked')} />

        {/* STAGE 03 — תוכניות עבודה */}
        <div className="stage">
          <div className="stage-head">
            <span className="stage-num">03</span>
            <span className="stage-title">תוכניות עבודה</span>
          </div>
          <div className="stage-body">
            <p>
              <Area value={data.s03_lead} onChange={val => patch('s03_lead', val)} isReadOnly={!canEdit('_locked')} />
            </p>
            <ul className="two-col">
              {data.s03_twoCol.map((item, i) => (
                <li key={i}>
                  <Field
                    value={item}
                    onChange={val => patch('s03_twoCol', data.s03_twoCol.map((t, j) => j === i ? val : t))}
                    isReadOnly={!canEdit('_locked')}
                    style={{ width: '100%' }}
                  />
                </li>
              ))}
            </ul>
            <p>
              <Area value={data.s03_closing}  onChange={val => patch('s03_closing',  val)} isReadOnly={!canEdit('_locked')} />
            </p>
            <p>
              <Area value={data.s03_meetings} onChange={val => patch('s03_meetings', val)} isReadOnly={!canEdit('_locked')} />
            </p>
          </div>
        </div>

        {/* STAGE 04 — ליווי בניה */}
        <div className="stage stage-last">
          <div className="stage-head">
            <span className="stage-num">04</span>
            <span className="stage-title">ליווי בניה</span>
          </div>
          <div className="stage-body">
            <div className="substage">
              <div className="substage-title">פיקוח עליון</div>
              <SubstageList items={data.s04_supervision}   onUpdate={patchList('s04_supervision')}   isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">ביקורים נוספים בשטח</div>
              <SubstageList items={data.s04_extraVisits}   onUpdate={patchList('s04_extraVisits')}   isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">ייעוץ ובחירות גמר</div>
              <SubstageList items={data.s04_finishConsult} onUpdate={patchList('s04_finishConsult')} isReadOnly={!canEdit('_locked')} />
            </div>
            <div className="substage">
              <div className="substage-title">הוראות ואחריות</div>
              <SubstageList items={data.s04_instructions}  onUpdate={patchList('s04_instructions')}  isReadOnly={!canEdit('_locked')} />
            </div>
          </div>
        </div>

        <div className="page-foot">
          <span>סטודיו בתים · אדריכלות ועיצוב פנים</span>
          <span>עמוד 3 · מתוך 4</span>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
           PAGE 4 — תנאים + חתימות
      ════════════════════════════════════════════════ */}
      <div className="page">

        <PageHeader dateValue={data.date} onDateChange={val => patch('date', val)} isReadOnly={!canEdit('_locked')} />

        <div className="hero hero-with-line" style={{ marginBottom: 20, paddingBottom: 14 }}>
          <div className="eyebrow">הערות ותנאים</div>
          <h1 className="hero-title" style={{ fontSize: 26 }}>תנאי ההתקשרות</h1>
        </div>

        {/* Terms — 3 groups of 4 */}
        {[
          { title: 'תנאי ההצעה',         start: 0, end: 4 },
          { title: 'מה אינו כלול בהצעה', start: 4, end: 8 },
          { title: 'זכויות ואחריות',      start: 8, end: 12 },
        ].map(({ title, start, end }) => (
          <div key={title} className="terms-group">
            <div className="terms-title">{title}</div>
            <ol className="terms-list">
              {data.terms.slice(start, end).map((text, i) => {
                const idx = start + i
                return (
                  <li key={idx}>
                    <span className="terms-num">{idx + 1}.</span>
                    <span style={{ flex: 1 }}>
                      <Area
                        value={text}
                        onChange={val => updateTerm(idx, val)}
                        isReadOnly={!canEdit('_locked')}
                      />
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}

        {/* Validity */}
        <div className="validity">
          <Area
            value={data.validity}
            onChange={val => patch('validity', val)}
            isReadOnly={!canEdit('_locked')}
            style={{ textAlign: 'center' }}
          />
        </div>

        {/* Signatures */}
        <div>
          <div className="sig-heading">אישור וחתימה</div>
          <p className="sig-intro">אנו החתומים מטה (המזמינים) מאשרים בזאת את ההצעה המפורטת לעיל ואת התנאים הכלולים בה.</p>
          <div className="sig-grid">
            {[
              { key: 'sig1', val: data.sig1 },
              { key: 'sig2', val: data.sig2 },
            ].map(({ key, val }) => (
              <div key={key} className="sig-box">
                <div className="sig-row">
                  <span className="sig-row-label">שם:</span>
                  <Field value={val.name} onChange={v => patch(key, { ...val, name: v })} isReadOnly={!canEdit(`${key}.name`)} style={{ flex: 1 }} />
                </div>
                <div className="sig-row" style={{ alignItems: 'center' }}>
                  {canEdit(`${key}.signature`) ? (
                    val.signature ? (
                      /* ── Signature drawn — show image + Pencil edit icon ── */
                      <>
                        <span className="sig-row-label">חתימה:</span>
                        <div style={{
                          flex: 1,
                          borderBottom: '1px solid rgba(26,26,24,0.4)',
                          height: 36,
                          display: 'flex',
                          alignItems: 'center',
                        }}>
                          <img
                            src={val.signature}
                            alt="חתימה"
                            style={{ maxHeight: 36, objectFit: 'contain', display: 'block' }}
                          />
                        </div>
                        <Pencil
                          size={14}
                          color="#8a8680"
                          style={{ opacity: 0.7, cursor: 'pointer', flexShrink: 0, marginRight: 6 }}
                          onClick={() => setSigningFor(key)}
                        />
                      </>
                    ) : (
                      /* ── No signature yet — full row is the click target ── */
                      <div
                        style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 6, cursor: 'pointer' }}
                        onClick={() => setSigningFor(key)}
                      >
                        <span className="sig-row-label">חתימה:</span>
                        <div style={{
                          flex: 1,
                          borderBottom: '1px solid rgba(26,26,24,0.4)',
                          height: 36,
                        }} />
                        <PenLine size={16} color="#8a8680" style={{ flexShrink: 0 }} />
                      </div>
                    )
                  ) : (
                    /* ── Admin / draft mode — static label only ── */
                    <span className="sig-row-label">חתימה:</span>
                  )}
                </div>
                <div className="sig-row">
                  <span className="sig-row-label">תאריך:</span>
                  <DateField value={val.date} onChange={v => patch(key, { ...val, date: v })} isReadOnly={!canEdit(`${key}.date`)} style={{ flex: 1 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Closing */}
        <div className="closing">
          <div className="closing-text">בברכה,</div>
          <div className="closing-name">
            <Field value={data.closingName}   onChange={val => patch('closingName',   val)} isReadOnly={!canEdit('_locked')} style={{ width: '100%', textAlign: 'center' }} />
          </div>
          <div className="closing-studio">
            <Field value={data.closingStudio} onChange={val => patch('closingStudio', val)} isReadOnly={!canEdit('_locked')} style={{ width: '100%', textAlign: 'center' }} />
          </div>
        </div>

        <div className="page-foot">
          <span>סטודיו בתים · אדריכלות ועיצוב פנים</span>
          <span>עמוד 4 · מתוך 4</span>
        </div>
      </div>

    </div>

    {/* Signature capture modal — rendered outside page flow so it overlays everything */}
    {signingFor && (
      <SignatureCanvas
        onSave={(dataUrl) => {
          patch(signingFor, { ...data[signingFor], signature: dataUrl })
          setSigningFor(null)
        }}
        onCancel={() => setSigningFor(null)}
      />
    )}
    </>
  )
}
