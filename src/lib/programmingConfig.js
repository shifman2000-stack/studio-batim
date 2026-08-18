/**
 * programmingConfig.js
 * מקור-האמת היחיד למבנה שאלון הפרוגרמה (חלק השאלון בלבד — בונה הבית מוגדר בנפרד).
 * גם טופס הלקוח וגם תצוגת המנהל (סיכום פגישת פרוגרמה) קוראים מכאן.
 *
 * מבנה כללי:
 *   QUESTIONNAIRE_STEPS: מערך שלבים. כל שלב = { key, title, intro, blocks: [...] }
 *   כל block הוא אחד מהסוגים:
 *     - 'people'      : ניהול בני הבית (דינמי; ידועים מהתיק + הוספה ידנית)
 *     - 'per_person'  : שדות שחוזרים לכל בן בית (עיסוק, תחביבים)
 *     - 'textareas'   : רשימת שדות טקסט חופשי (label + placeholder + key)
 *     - 'options'     : רשת אפשרויות רב-בחירה (checkbox) עם key לכל אפשרות
 *     - 'textarea'    : שדה טקסט חופשי בודד
 *
 * כל התשובות נשמרות תחת answers.questionnaire ב-jsonb, לפי ה-keys שמוגדרים כאן.
 */

/* בני בית "ידועים" — בפועל יגיעו מ-project_contacts; כאן ברירת מחדל לדמו */
export const KNOWN_PEOPLE_FALLBACK = [];

export const AGE_RANGES = [
  '0-2', '3-6', '7-12', '13-18', '19-30', '31-45', '46-60', '60+'
];

export const SEX_OPTIONS = ['זכר', 'נקבה', 'לא לציין'];

export const QUESTIONNAIRE_STEPS = [
  {
    key: 'people',
    title: 'מי גר בבית',
    intro: 'בפרק זה נכיר את מי שיגור בבית',
    blocks: [
      { type: 'people', key: 'people', sectionLabel: 'בני הבית', addLabel: '+ הוספת אדם' },
      { type: 'textarea', key: 'composition', label: 'תרצו לספר לנו עוד על הרכב הבית?',
        placeholder: 'למשל: ילד בדרך, בן משפחה שמתארח לעיתים, שינוי צפוי' },
      { type: 'textarea', key: 'pets', label: 'בעלי חיים בבית',
        placeholder: 'למשל: כלב גדול, חתול' }
    ]
  },
  {
    key: 'occupation',
    title: 'תעסוקה ותחביבים',
    intro: 'ספרו לנו על כל אחד מבני הבית — העיסוקים והתחביבים עוזרים לנו להבין צרכים ייחודיים.',
    blocks: [
      { type: 'per_person', fields: [
        { kind: 'input',    key: 'occ', placeholder: 'עיסוק' },
        { kind: 'textarea', key: 'hob', placeholder: 'תחביבים ותחומי עניין' }
      ] }
    ]
  },
  {
    key: 'lifestyle',
    title: 'אורח חיים',
    intro: 'איך נראים החיים בבית? מה השגרה שלכם?',
    blocks: [
      { type: 'textareas', store: 'ls', items: [
        { key: 'shop',     label: 'הרגלי קניות (תדירות, אחסון, מזווה)', placeholder: 'למשל: קנייה גדולה שבועית, צריך מזווה גדול' },
        { key: 'host',     label: 'האם הבית מארח? (תדירות, כמות אורחים)', placeholder: 'למשל: אירוח משפחתי גדול בשבתות' },
        { key: 'activity', label: 'פעילויות משותפות אהובות', placeholder: 'למשל: בישול ביחד, משחקי קופסה' },
        { key: 'eat',      label: 'הרגלי אכילה', placeholder: 'למשל: ארוחות משותפות, אוכלים מול הטלוויזיה' },
        { key: 'tv',       label: 'הרגלי צפייה בטלוויזיה', placeholder: 'למשל: צפייה משפחתית בערב' },
        { key: 'hours',    label: 'שעות הפעילות העיקריות בבית', placeholder: 'למשל: בעיקר בערב, עבודה מהבית בבוקר' },
        /* 'sport' ("ספורט ופעילות גופנית") was removed from the
           questionnaire. Rows saved before then may still carry an
           `ls.sport` value; it is deliberately NOT migrated away.
           normalizeQData shallow-merges the stored `ls` object rather
           than rebuilding it from these items, so the old value simply
           rides along untouched — no longer rendered, no longer
           collected. Don't reuse this key for something else. */
        { key: 'work',     label: 'עבודה מהבית / עבודה מול מחשב', placeholder: 'למשל: אני עובד מהבית על מחשב נייח ורוצה בעמדת עבודה גם פינת קפה' }
      ] }
    ]
  },
  {
    key: 'atmosphere',
    title: 'אווירה וסגנון',
    intro: 'איזו תחושה תרצו שהבית ישדר? בחרו כל מה שמדבר אליכם.',
    blocks: [
      { type: 'options', store: 'feel', sectionLabel: 'תחושה כללית', options: [
        ['חמים ונעים','warm'], ['מזמין ומארח','hosting'], ['מרשים','impressive'], ['מסודר ומאורגן','organized'],
        ['פונקציונלי','functional'], ['ייחודי','unique'], ['יצירתי','creative'], ['ייצוגי','formal'],
        ['צנוע','modest'], ['מתמזג בסביבה','blend'], ['בולט בסביבה','standout']
      ] },
      { type: 'options', store: 'style', sectionLabel: 'סגנון עיצובי', options: [
        ['מודרני','modern'], ['כפרי','rustic'], ['קלאסי','classic'], ['סקנדינבי','scandi'],
        ['תעשייתי','industrial'], ['מינימליסטי','minimal'], ['בוהו','boho'], ['ים-תיכוני','medi']
      ] },
      /* Roof-type chips (גג רעפים / גג שטוח / גג משולב) were removed —
         the roof is chosen in the house builder (answers.house.general.roof),
         so offering it here too was redundant. Existing rows that already
         stored roof_tile/roof_flat/roof_mix keep those keys in
         answers.questionnaire.arch; they simply no longer render. */
      { type: 'options', store: 'arch', sectionLabel: 'אלמנטים אדריכליים וחומרי גמר', options: [
        ['קורות חשופות','beams'],
        ['קשתות','arches'], ['חלונות גדולים','bigwin'], ['תקרה גבוהה','highceil'], ['חלל כפול','double_h'],
        ['אבן','stone'], ['בריקים','bricks'], ['עץ','wood'], ['טיח מינרלי','mineral_plaster'], ['ברזל','iron']
      ] },
      { type: 'textarea', key: 'style_notes', label: 'עוד על האווירה והסגנון',
        placeholder: 'כל דבר שיעזור לנו להבין את הטעם שלכם' }
    ]
  },
  {
    /* Chapter 5 — house-level toggles that used to live inside the
       house builder (V2 Step 1 "החלטות כלליות"). Moved out here so
       Einav gets a dedicated questionnaire chapter for them. Data
       still lives in answers.house.general.floorHeatingFloors and
       answers.house.general.elevator — no data reshape. Rendered
       by a bespoke section in ClientProgrammingQuestionnaire
       (blocks:[] is intentional — the render is special-cased on
       step.key === 'house_general'). */
    key: 'house_general',
    title: 'החלטות כלליות לבית',
    intro: 'פרטים טכניים שיעזרו לנו לתכנן',
    blocks: []
  },
  {
    key: 'inspiration',
    title: 'תמונות השראה',
    intro: 'יש לכם תמונות שאתם אוהבים? בפגישה נעבור עליהן יחד. כאן אפשר לספר לנו על סגנונות או בתים שאהבתם.',
    blocks: [
      { type: 'textarea', key: 'inspiration_notes', label: 'תיאור / קישורים לתמונות השראה',
        placeholder: 'למשל: קישור ל-Pinterest, תיאור בית שראיתם ואהבתם' }
    ]
  }
];

/* מבנה answers.questionnaire הצפוי (לתיעוד):
   {
     people: [ { name, sex, age, known } ],
     composition: '', pets: '',
     occ: { [name]: '' }, hob: { [name]: '' },
     ls: { shop, host, activity, eat, tv, hours, work },   // + legacy `sport` on pre-removal rows
     feel: {...}, style: {...}, arch: {...}, style_notes: '',
     inspiration_notes: ''
   }
*/
