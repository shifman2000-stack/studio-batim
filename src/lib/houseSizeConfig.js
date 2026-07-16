/**
 * houseSizeConfig.js — מחשבון גודל הבית (טיוטה לתיקון ע"י עינב)
 *
 * לכל סוג חלל: שטח משוער במ"ר בשלוש תצורות — S (קטן) / M (בינוני) / L (גדול).
 * המשתמש בוחר תצורה לכל חלל (מאפיין בפירוט). ברירת מחדל: M.
 * חלל שאין לו ערך כאן (כולל "חלל אחר" חופשי) → DEFAULT_ROOM_SIZE.
 *
 * החישוב: סכום שטחי כל החללים × 1.10 (תוספת 10% למסדרונות, מעברים, קירות).
 *
 * ⚠️ המספרים הם טיוטה ראשונית לפי גדלים מקובלים למגורים — לתיקון לפי שיקול אדריכלי.
 */

export const ROOM_SIZES = {
  // ── חללים ציבוריים ──
  'סלון':            { S: 18, M: 25, L: 35 },
  'פינת משפחה':      { S: 12, M: 16, L: 22 },
  'חדר משפחה':       { S: 14, M: 18, L: 24 },
  'מטבח':            { S: 10, M: 14, L: 20 },
  'פינת אוכל':       { S: 8,  M: 12, L: 16 },
  'פינת קפה':        { S: 4,  M: 6,  L: 8 },
  'מבואת כניסה':     { S: 4,  M: 6,  L: 9 },

  // ── חדרי שינה ──
  'חדר הורים':       { S: 9,  M: 11, L: 14 },
  'חדר ילדים':       { S: 9,  M: 11, L: 14 },
  'חדר':             { S: 10, M: 13, L: 16 },  // חדר כללי (מרתף)
  'חדר שינה':        { S: 10, M: 13, L: 16 },  // ילד של יחידת סוויטה / יחידת דיור
  'חדר ארונות':      { S: 4,  M: 6,  L: 10 },  // walk-in closet — ילד של סוויטה

  // ── יחידות עצמאיות ──
  'יחידת סוויטה':    { S: 15, M: 20, L: 28 },
  'יחידת דיור':      { S: 20, M: 30, L: 45 },

  // ── רחצה ושירות ──
  'מקלחת':           { S: 3,  M: 5,  L: 8 },   // מוצג כ"חדר רחצה"
  'חדר רחצה':        { S: 4,  M: 6,  L: 9 },   // legacy — ראה DISPLAY_LABELS
  'שירותי אורחים':   { S: 2,  M: 3,  L: 4 },
  'ממ״ד':            { S: 9,  M: 9,  L: 12 },  // מינימום תקני ~9 מ"ר
  'חדר כביסה':       { S: 3,  M: 5,  L: 8 },

  // ── עבודה ופנאי ──
  'משרד':            { S: 6,  M: 9,  L: 12 },
  'חדר כושר':        { S: 10, M: 15, L: 22 },
  'חלל משחקים':      { S: 10, M: 14, L: 20 },
  'חדר יין':         { S: 4,  M: 6,  L: 10 },

  // ── חוץ ──
  'מרפסת':           { S: 6,  M: 10, L: 16 },
  'מטבח חוץ':        { S: 6,  M: 10, L: 15 },
  'פרגולה':          { S: 10, M: 16, L: 25 },
  'בריכה':           { S: 15, M: 24, L: 40 },
  'מחסן':            { S: 4,  M: 7,  L: 12 },
  'חניה':            { S: 12, M: 18, L: 30 },  // לרכב אחד/שניים
};

/* ערך ברירת מחדל לחלל לא-מוכר או "חלל אחר" חופשי */
export const DEFAULT_ROOM_SIZE = { S: 8, M: 12, L: 18 };

/* מקדם תוספת למסדרונות, מעברים, קירות */
export const CIRCULATION_FACTOR = 1.10;

/* תצורת ברירת מחדל לחלל חדש */
export const DEFAULT_SIZE_KEY = 'M';

/* תוויות התצורות */
export const SIZE_LABELS = {
  S: 'קטן',
  M: 'בינוני',
  L: 'גדול'
};

/**
 * חישוב שטח משוער.
 * @param roomsFlat מערך חללים: [{ type, sizeKey }] או [{ type, fixedArea }]
 *   • sizeKey = 'S'|'M'|'L' (ברירת מחדל M) — לחלל רגיל.
 *   • fixedArea = מספר חיובי — לחלל בעל שטח קבוע (מוגדר ב-FIXED_AREAS
 *     בקונפיג של בונה הבית). כאשר קיים fixedArea הוא גובר על ROOM_SIZES.
 * @param opts.sizesMap — אופציונלי. מפה מותאמת (למשל טעונה מ-Supabase)
 *   שגוברת על ROOM_SIZES הסטטי. אם לא סופק, נשתמש ב-ROOM_SIZES כברירת מחדל
 *   — כך שקריאה ללא אופציות שומרת על ההתנהגות הישנה בדיוק.
 * @returns מ"ר מעוגל (כולל תוספת מסדרונות)
 */
export function estimateArea(roomsFlat, opts = {}) {
  const sizesMap = (opts && opts.sizesMap && typeof opts.sizesMap === 'object')
    ? opts.sizesMap
    : ROOM_SIZES;
  let sum = 0;
  for (const r of roomsFlat) {
    if (typeof r.fixedArea === 'number' && Number.isFinite(r.fixedArea) && r.fixedArea > 0) {
      sum += r.fixedArea;
      continue;
    }
    const sizes = sizesMap[r.type] || ROOM_SIZES[r.type] || DEFAULT_ROOM_SIZE;
    const key = r.sizeKey || DEFAULT_SIZE_KEY;
    sum += sizes[key] != null ? sizes[key] : sizes.M;
  }
  return Math.round(sum * CIRCULATION_FACTOR);
}
