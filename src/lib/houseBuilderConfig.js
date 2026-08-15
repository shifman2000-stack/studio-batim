/**
 * houseBuilderConfig.js
 * מקור-האמת היחיד למבנה בונה הבית (חלק 2 של שאלון הפרוגרמה).
 * גם קומפוננטת בונה הבית וגם תצוגת המנהל (סיכום פגישת פרוגרמה) קוראות מכאן.
 *
 * שינוי מפלסים / חללים / מאפיינים = שינוי בקובץ הזה בלבד.
 * מבנה ה-DB (answers.house jsonb) לא מושפע משינויים כאן.
 */

/* המפלסים הפנימיים, בסדר תצוגה מלמעלה למטה. החצר נפרדת (yard), מוצגת מתחת לקו האדמה. */
export const FLOOR_DEFS = [
  { key: 'first',    label: 'קומה א׳' },
  { key: 'ground',   label: 'קומת קרקע' },
  { key: 'basement', label: 'מרתף' }
];

/* מפתחות המפלסים כולל חצר — לשימוש בסריאליזציה ובמעבר על כל האזורים */
export const AREA_KEYS = ['first', 'ground', 'basement', 'yard'];

/* תווית מוצגת לחצר (אינה ב-FLOOR_DEFS כי היא מטופלת בנפרד ויזואלית) */
export const YARD_LABEL = 'חצר';

/**
 * מודל הפלטה: רשימה מפורשת ומסודרת פר-אזור. אין BASE שמורכב אוטומטית
 * לכל הקומות — כל אזור מגדיר בעצמו את הסדר המדויק של החללים.
 *
 * הזנות ב-FLOOR_PALETTE הן CODE KEYS (מפתחי-סוג פנימיים, כפי שנשמרים
 * ב-state ו-jsonb). לרנדור נעביר אותן דרך displayType() — למשל
 * 'מקלחת' מוצג "חדר רחצה". רישום פר-קומה שומר על מספור-רץ פר-סוג
 * (r.type זהה = אותה סדרה), על ה-props ועל sizeKey.
 *
 * "חלל אחר" הוא שורת קלט חופשי ב-UI ולא מופיע כאן — הרנדור מוסיף אותו
 * תמיד אחרי הפלטה כך שהוא הפריט האחרון בכל אזור, בכל תצוגה.
 *
 * צרכן הפלטה חייב לקרוא ל-getPalette(areaKey), לא לקרוא ישירות למפה למטה.
 */
export const FLOOR_PALETTE = {
  first: [
    'סלון', 'מטבח', 'פינת אוכל', 'חדר ילדים', 'חדר הורים',
    'מקלחת',                       // מוצג "חדר רחצה"
    'פינת משפחה', 'מרפסת', 'משרד',
    'חדר כביסה', 'יחידת סוויטה', 'פינת קפה', 'יחידת דיור',
  ],
  ground: [
    'סלון', 'מטבח', 'פינת אוכל', 'חדר ילדים', 'חדר הורים',
    'משרד', 'מבואת כניסה', 'שירותי אורחים', 'ממ״ד',
    'מקלחת',                       // מוצג "חדר רחצה"
    'חדר משפחה',
  ],
  basement: [
    'סלון', 'מטבח', 'חדר', 'ממ״ד',
    'מקלחת',                       // מוצג "חדר רחצה"
    'חדר כושר', 'חדר משפחה', 'משרד', 'חלל משחקים', 'חדר יין',
  ],
  yard: [
    'מטבח חוץ', 'בריכה', 'פרגולה', 'מחסן', 'חניה',
  ],
};

/**
 * מחזיר את רשימת הסוגים לפלטה של אזור נתון (או [] אם אין).
 * "חלל אחר" לא כלול — הרנדור מוסיף אותו כשורת קלט חופשי אחרי הפלטה.
 */
export function getPalette(areaKey) {
  return FLOOR_PALETTE[areaKey] ? [...FLOOR_PALETTE[areaKey]] : [];
}

/**
 * מיפוי תצוגה: type-key פנימי → תווית מוצגת. משתמשים ב-displayType(type)
 * בכל מקום שסוג החלל מוצג למשתמש (פלטה, קוביה בבית הסכמטי, כותרת שלב 3).
 * המפתחות הפנימיים ב-state / ב-jsonb לא משתנים — רק הלייבל.
 */
export const DISPLAY_LABELS = {
  'מקלחת': 'חדר רחצה',
};

export function displayType(type) {
  return (type && DISPLAY_LABELS[type]) || type;
}

/* ─── Container types ("חלל על") ──────────────────────────────────
 * A container is a room that HOLDS other rooms as an optional
 * `children` array. Two containers exist today, both listed only on
 * קומה א׳ in FLOOR_PALETTE: יחידת סוויטה (small nested set) and
 * יחידת דיור (self-contained sub-house). Containers themselves have
 * no props / no sizeKey — the size calculator walks their `children`
 * instead. Nesting is capped at ONE level — no container inside a
 * container. The palette rendering does NOT filter container types
 * out of a container's allowed-children set at import time; it does
 * so via `isContainer(t)` at runtime (see LIVING_UNIT_ALLOWED_CHILDREN
 * below).
 */
export const CONTAINER_TYPES = ['יחידת סוויטה', 'יחידת דיור'];

export function isContainer(type) {
  return CONTAINER_TYPES.includes(type);
}

/* יחידת סוויטה — small nested set. חדר שינה is REQUIRED: an auto-child
   is inserted on suite creation, and any removal path (palette "−",
   right-click "הסר חלל", props panel "הסר חלל זה") refuses to remove
   the LAST remaining חדר שינה in the suite. */
const SUITE_ALLOWED_CHILDREN = ['חדר שינה', 'חדר רחצה', 'חדר ארונות'];
const SUITE_AUTO_CHILDREN    = ['חדר שינה'];
const SUITE_REQUIRED_TYPES   = ['חדר שינה'];

/* יחידת דיור — self-contained sub-house. Allowed children = every
   REGULAR (non-container) type that appears in an interior floor's
   palette, plus the two shared bedroom-adjacent types (חדר שינה,
   חדר ארונות) that live in ROOM_SIZES but aren't in FLOOR_PALETTE
   directly. Computed once at module load; container types are
   excluded so a container can never nest inside another container. */
const LIVING_UNIT_ALLOWED_CHILDREN = (() => {
  const seen = new Set();
  const out = [];
  for (const areaKey of Object.keys(FLOOR_PALETTE)) {
    if (areaKey === 'yard') continue;
    for (const t of FLOOR_PALETTE[areaKey]) {
      if (CONTAINER_TYPES.includes(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  for (const extra of ['חדר שינה', 'חדר ארונות']) {
    if (!seen.has(extra)) { seen.add(extra); out.push(extra); }
  }
  return out;
})();

export function getContainerAllowedChildren(type) {
  if (type === 'יחידת סוויטה') return [...SUITE_ALLOWED_CHILDREN];
  if (type === 'יחידת דיור')   return [...LIVING_UNIT_ALLOWED_CHILDREN];
  return [];
}

export function getContainerAutoChildren(type) {
  if (type === 'יחידת סוויטה') return [...SUITE_AUTO_CHILDREN];
  return [];
}

export function getContainerRequiredTypes(type) {
  if (type === 'יחידת סוויטה') return [...SUITE_REQUIRED_TYPES];
  return [];
}

/**
 * מאפיינים פר-סוג-חלל. כל קבוצה:
 *   { t: כותרת, radio?: true, opts: [אפשרויות] }
 *   radio:true  = בחירה בלעדית (כפתורי רדיו) — נשמר כערך יחיד תחת props['r'+groupIndex]
 *   ללא radio   = צ'קבוקס (בחירה מרובה)      — כל אפשרות נשמרת כ-bool תחת props['c'+groupIndex+'_'+opt]
 *
 * הערה: המבנה גמיש לחלוטין. הוספת/שינוי מאפיין כאן לא נוגעת ב-DB (jsonb חופשי).
 * כרגע מטבח מפורט; שאר החללים מדגמיים — יורחבו לפי הצורך.
 */
export const ROOM_PROPS = {
  'מטבח': [
    { t: 'כיריים',     radio: true, noTitle: true, opts: ['כיריים 60 ס״מ', 'כיריים 90 ס״מ'] },
    { t: 'סוג כיריים', radio: true, noTitle: true, opts: ['כיריים אינדוקציה', 'כיריים גז'] },
    { t: 'אי',         radio: true, noTitle: true, opts: ['יש אי', 'ללא אי'] },
    { t: 'על השיש',                 opts: ['תמי 4', 'מכונת קפה', 'מיקסר', 'בלנדר'] },
    { t: 'כשרות',      radio: true, noTitle: true, opts: ['מטבח כשר', 'כשרות לא רלוונטית'] }
  ],
  'סלון': [
    { t: 'טלוויזיה', radio: true, noTitle: true, opts: ['עם טלוויזיה', 'ללא טלוויזיה'] },
    { t: 'אופי',     radio: true, noTitle: true, opts: ['אופי פתוח', 'אופי אינטימי'] },
    { t: 'תוספות',                opts: ['קמין', 'ספרייה'] }
  ],
  'חדר ילדים': [
    /* מיטה = בחירה יחידה (segmented). noTitle כדי שהכפתורים ירצו
       ללא כותרת מעליהם, כמו בשאר השדות הרדיו noTitle בקונפיג. */
    { t: 'מיטה',  radio: true, noTitle: true, opts: ['מיטת יחיד', 'מיטה וחצי', 'מיטה כפולה'] },
    /* ריהוט = צ'קבוקסים ללא כותרת (t נשאר לצורך aria בלבד). */
    { t: 'ריהוט',              noTitle: true, opts: ['ארון', 'שולחן עבודה', 'טלוויזיה'] },
    { t: 'תוספות',                            opts: ['פינת ישיבה', 'יציאה למרפסת'] }
  ],
  'חדר הורים': [
    { t: 'מיטה',  radio: true, noTitle: true, opts: ['מיטת יחיד', 'מיטה וחצי', 'מיטה כפולה'] },
    { t: 'ריהוט',              noTitle: true, opts: ['ארון', 'שולחן עבודה', 'טלוויזיה'] },
    { t: 'תוספות',                            opts: ['פינת ישיבה', 'יציאה למרפסת'] }
  ],
  /* מפתח הקוד 'מקלחת' — displayType ממפה אותו ל-"חדר רחצה" בממשק.
     ROOM_PROPS חייב להיות תחת מפתח הקוד (r.type ב-state / jsonb). */
  'מקלחת': [
    { t: 'קבועות',              noTitle: true, opts: ['מקלחת', 'אמבטיה', 'אסלה', 'בידה'] },
    { t: 'כיור',   radio: true, noTitle: true, opts: ['כיור יחיד', 'כיור כפול'] }
  ],
  'מטבח חוץ': [
    { t: 'מיקום', radio: true, noTitle: true, opts: ['מטבח חוץ מקורה', 'מטבח חוץ פתוח'] },
    { t: 'אבזור',              opts: ['מנגל פחמים', 'מנגל גז', 'טאבון', 'מקרר', 'כיור'] }
  ],
  'פינת משפחה': [
    { t: 'פעילות בחדר משפחה', opts: ['טלוויזיה', 'משחקי מחשב', 'פינת עבודה', 'פינת יצירה', 'משחקי ילדים'] },
    { t: 'פתחים',             opts: ['יציאה למרפסת', 'חלון'] }
  ]
};

/* ─── Fixed-area room types ──────────────────────────────────────
 * Room types whose area (in sqm) is fixed by design, not chosen by
 * the user. In step 3 the S/M/L segmented selector is HIDDEN for
 * these rooms, and the size calculator adds this exact value instead
 * of doing a ROOM_SIZES × sizeKey lookup. Non-fixed rooms behave as
 * today. Meant for small/standardized spaces where the size question
 * isn't meaningful.
 *
 * Currently: פינת משפחה = 9 sqm.
 */
export const FIXED_AREAS = {
  'פינת משפחה': 9,
};

/**
 * Returns the fixed area (positive finite number) for a room type,
 * or null if the type doesn't have one. Callers should treat null
 * as "fall through to the normal S/M/L path".
 */
export function getFixedArea(type) {
  const v = FIXED_AREAS[type];
  return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null;
}

export function hasFixedArea(type) {
  return getFixedArea(type) !== null;
}

/* ─── Rooms excluded from the total house-area calculation ────────
 * Room types whose area should NOT count toward the summed house
 * size (e.g. a room type that overlaps another, or is otherwise
 * outside what "house size" is meant to represent) — independent of
 * whether the room is in fixed-area or sized (S/M/L) mode; whichever
 * area it would otherwise contribute is simply skipped from the sum.
 * None flagged today — the admin report is how these get added.
 */
export const EXCLUDE_FROM_AREA_CALC_TYPES = [];

export function isExcludedFromAreaCalc(type) {
  return EXCLUDE_FROM_AREA_CALC_TYPES.includes(type);
}

/* מאפייני ברירת מחדל לחלל שאין לו הגדרה ייעודית ב-ROOM_PROPS */
export const DEFAULT_PROPS = [
  { t: 'אפיון', opts: ['דורש חלון', 'קרבה לחלל הציבורי', 'דגש מיוחד'] }
];

/* ============ הסברים למשתמש ============ */

/* מסך פתיחה — מוצג בכל כניסה לבונה הבית, לפני המסך המפוצל */
export const INTRO = {
  title: 'איך בונים את הבית?',
  steps: [
    { n: '1', title: 'בוחרים מפלסים', text: 'סמנו אילו קומות יש בבית (קרקע, קומה א׳, מרתף) והאם יש חצר.' },
    { n: '2', title: 'ממלאים חללים', text: 'לחצו על מפלס, והוסיפו לו חדרים (סלון, מטבח, חדר ילדים...) בעזרת כפתור +.' },
    { n: '3', title: 'מפרטים כל חלל', text: 'לחצו על חדר שיצרתם, ובחרו את אפיון החלל (סוג מטבח, ריהוט, וכו׳).' },
    { n: '4', title: 'בוחרים מאפיינים ייחודיים', text: 'בחרו מאפיינים כגון גג, חימום רצפתי ומעלית' }
  ],
  footer: 'אפשר לשנות הכל בכל שלב — פשוט שחקו עם זה 🙂',
  cta: 'בואו נתחיל'
};

/* רמז הכוונה קצר בראש הפאנל, לפי המצב */
export const MODE_HINTS = {
  floors:  'שלב 1 — בחרו את המפלסים של הבית',
  rooms:   'שלב 2 — הוסיפו חללים למפלס. למעבר בין קומות לחצו על הקומה הרצויה',
  props:   'שלב 3 — בחרו את אפיון החלל הזה',
  general: 'שלב 4 — הגדירו מאפיינים כלליים של הבית'
};

/* אפשרויות הגג לשלב 4 — סדר תצוגה משמאל לימין (בהקשר RTL: הראשון בימין) */
export const ROOF_OPTIONS = ['שטוח', 'רעפים', 'משולב'];

/**
 * מבנה answers.house הצפוי (jsonb):
 * {
 *   floors: { first: bool, ground: bool, basement: bool },
 *   yard:   bool,
 *   rooms: {
 *     ground:   [ { type: 'מטבח', props: { r0:'90 ס״מ', c3_'תמי 4':true }, freeProps: ['...'] }, ... ],
 *     first:    [...], basement: [...], yard: [...]
 *   }
 * }
 * התווית הממוספרת ("מטבח 2") מחושבת בתצוגה (גלובלי פר-סוג), לא נשמרת.
 */
