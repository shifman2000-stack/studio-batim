/**
 * houseSizeConfig.js — מחשבון גודל הבית (טיוטה לתיקון ע"י עינב)
 *
 * לכל סוג חלל: שטח משוער במ"ר בשלוש תצורות — S (קטן) / M (בינוני) / L (גדול).
 * המשתמש בוחר תצורה לכל חלל (מאפיין בפירוט). ברירת מחדל: M.
 * חלל שאין לו ערך כאן (כולל "חלל אחר" חופשי) → DEFAULT_ROOM_SIZE.
 *
 * החישוב: סכום שטחי כל החללים × (1 + (מעברים% + עובי קירות%) / 100).
 * שני האחוזים (וכן אחוז הסטייה המותר מול יעד הלקוח) ניתנים לעריכה במסך
 * "אפיון מערכת בונה הבית" → "פרמטרי מחשבון", ונשמרים ב-
 * house_builder_config.config.calcParams. DEFAULT_CALC_PARAMS למטה הם
 * רק ה-fallback כשאין קונפיג פעיל ב-DB (ראו houseBuilderConfigSource.js).
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

/* פרמטרי מחשבון — ברירות מחדל (fallback כשאין קונפיג פעיל ב-DB, וגם
   הערכים המשמשים חלל שאין לו ערך מוגדר בקונפיג). corridorsPct = "מעברים",
   wallsPct = "עובי קירות" — שני אחוזים שמתווספים על סכום שטחי החללים.
   toleranceDeviationPct = אחוז הסטייה המותר בין השטח המחושב ליעד הלקוח
   בשאלון (ClientProgrammingQuestionnaire).

   corridorsPct ו-wallsPct מכאן ואילך משקפים את הקונפיג הפעיל בשני
   הסביבות, Dev ו-Prod כאחד, נכון ל-19.09.2026: 7 + 10 (מכפיל 1.17).
   קודם לכן היו 10 + 0 (מכפיל 1.10) — ערך מורשת מימי
   CIRCULATION_FACTOR הקבוע, שכבר לא תאם אף סביבה.

   ⚠️ שוויון המכפיל אינו מספיק כדי ששני המסלולים יחזירו אותו מספר:
   ROOM_SIZES הסטטי כאן ורשימת החללים המוחרגים מהחישוב עדיין שונים
   מאלה שבקונפיג ב-DB, ולכן מסלול ה-fallback עדיין נותן תוצאה אחרת.
   ראו את הדוח שנלווה לשינוי הזה. */
export const DEFAULT_CALC_PARAMS = {
  corridorsPct: 7,
  wallsPct: 10,
  /* לא שונה בכוונה — ראו הדוח: שתי הסביבות מגדירות 5. */
  toleranceDeviationPct: 10,
};

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
 *   • excludeFromAreaCalc = true — לחלל שסוגו מוגדר ב-EXCLUDE_FROM_AREA_CALC_TYPES
 *     (בקונפיג של בונה הבית). השטח שלו מדולג לגמרי מהסכום, גם אם יש
 *     לו fixedArea או sizeKey.
 * @param opts.sizesMap — אופציונלי. מפה מותאמת (למשל טעונה מ-Supabase)
 *   שגוברת על ROOM_SIZES הסטטי. אם לא סופק, נשתמש ב-ROOM_SIZES כברירת מחדל
 *   — כך שקריאה ללא אופציות שומרת על ההתנהגות הישנה בדיוק.
 * @param opts.calcParams — אופציונלי. { corridorsPct, wallsPct } (אחוזים,
 *   למשל טעונים מ-house_builder_config.config.calcParams). כל ערך חסר/לא
 *   תקין נופל בחזרה לברירת המחדל שלו ב-DEFAULT_CALC_PARAMS.
 * @returns מ"ר מעוגל (כולל תוספת מעברים + עובי קירות)
 */
export function estimateArea(roomsFlat, opts = {}) {
  const sizesMap = (opts && opts.sizesMap && typeof opts.sizesMap === 'object')
    ? opts.sizesMap
    : ROOM_SIZES;
  const calcParams = (opts && opts.calcParams && typeof opts.calcParams === 'object')
    ? opts.calcParams
    : {};
  const corridorsPct = (typeof calcParams.corridorsPct === 'number' && Number.isFinite(calcParams.corridorsPct))
    ? calcParams.corridorsPct
    : DEFAULT_CALC_PARAMS.corridorsPct;
  const wallsPct = (typeof calcParams.wallsPct === 'number' && Number.isFinite(calcParams.wallsPct))
    ? calcParams.wallsPct
    : DEFAULT_CALC_PARAMS.wallsPct;
  let sum = 0;
  for (const r of roomsFlat) {
    if (r.excludeFromAreaCalc === true) {
      continue;
    }
    if (typeof r.fixedArea === 'number' && Number.isFinite(r.fixedArea) && r.fixedArea > 0) {
      sum += r.fixedArea;
      continue;
    }
    const sizes = sizesMap[r.type] || ROOM_SIZES[r.type] || DEFAULT_ROOM_SIZE;
    const key = r.sizeKey || DEFAULT_SIZE_KEY;
    sum += sizes[key] != null ? sizes[key] : sizes.M;
  }
  return Math.round(sum * (1 + (corridorsPct + wallsPct) / 100));
}

/* Is this area key a yard? The builder config decides, from its own
   isYard flag (see houseBuilderConfigSource). The derivation below is
   only the fallback for a config object that predates isYardArea: an
   area key that is not one of the interior FLOOR_DEFS, which is how
   the summary page has always told them apart. A config carrying
   neither excludes nothing by area, exactly as before this rule. */
function isYardAreaKey(cfg, key) {
  if (typeof cfg.isYardArea === 'function') return cfg.isYardArea(key);
  const areaKeys  = Array.isArray(cfg.AREA_KEYS)  ? cfg.AREA_KEYS  : null;
  const floorDefs = Array.isArray(cfg.FLOOR_DEFS) ? cfg.FLOOR_DEFS : null;
  if (!areaKeys || !floorDefs) return false;
  return areaKeys.includes(key) && !floorDefs.some(f => f && f.key === key);
}

/**
 * שטח משוער עבור קבוצת אזורים מתוך עץ ה-rooms השמור.
 *
 * ONE formula, two uses: the hub's whole-house total passes every area
 * key, the summary's per-floor breakdown passes one key at a time.
 * Both land in estimateArea above, so corridorsPct + wallsPct are
 * applied by the SAME line — per floor when called per floor.
 *
 * estimateArea itself takes a FLAT list and does not recurse, and
 * fixedArea / excludeFromAreaCalc are TYPE-level flags that live in the
 * builder config rather than on the stored room, so the tree is
 * flattened (children included) and each room annotated from the config
 * before the call. That walk used to live inline in
 * ClientProgrammingQuestionnaire; it is here so there is one copy.
 *
 * ⚠️ Rounding happens ONCE per call, at the end of estimateArea. Calling
 * this per floor therefore rounds per floor, and the per-floor figures
 * need not sum to the whole-house figure. Neither number is wrong; they
 * round at different points. Do not "fix" that by reconciling them.
 *
 * Areas the config flags as a yard contribute ZERO whatever is in
 * them — see isYardAreaKey above.
 *
 * @param roomsByArea עץ החדרים: { [areaKey]: [room] }
 * @param areaKeys מפתחות האזורים לחישוב (למשל ['ground'] או כולם)
 * @param config קונפיג בונה הבית הפעיל (isYardArea / getFixedArea / isExcludedFromAreaCalc / ROOM_SIZES / calcParams)
 * @returns מ"ר מעוגל
 */
export function estimateAreaForAreaKeys(roomsByArea, areaKeys, config) {
  if (!roomsByArea || typeof roomsByArea !== 'object') return 0;
  const cfg = config || {};
  const flat = [];
  const visit = (list) => {
    for (const r of (Array.isArray(list) ? list : [])) {
      flat.push(r);
      if (Array.isArray(r.children)) visit(r.children);
    }
  };
  for (const areaKey of (Array.isArray(areaKeys) ? areaKeys : [])) {
    /* A YARD HAS NO BUILT AREA. Skip the whole area, with its nested
       children, before any room is even looked at — so a free-text
       room the client typed there, whose type the config has never
       seen and therefore cannot flag, counts for nothing too. This is
       ADDITIONAL to the per-type excludeFromAreaCalc check below,
       which is unchanged and still applies everywhere. */
    if (isYardAreaKey(cfg, areaKey)) continue;
    visit(roomsByArea[areaKey]);
  }

  const annotated = flat.map(r => ({
    type:                r.type,
    sizeKey:             r.sizeKey,
    fixedArea:           cfg.getFixedArea ? cfg.getFixedArea(r.type) : null,
    excludeFromAreaCalc: cfg.isExcludedFromAreaCalc ? cfg.isExcludedFromAreaCalc(r.type) : false,
  }));
  return estimateArea(annotated, { sizesMap: cfg.ROOM_SIZES, calcParams: cfg.calcParams });
}
