// src/components/gantt/gridDefinition.js
//
// Single source of truth for the manager Gantt grid (the hardcoded 19-row ×
// 4-column structure originally in ProjectGantt.jsx). Reused by the client
// portal's read-only "שלבי התקדמות" screen so both views stay in sync.
//
// Each non-null cell carries a stable `id` — the same key written into
// projects.gantt_state by the manager view (values: 'done'|'current'|'future';
// missing key → 'future'). Both views read status from that map.

export const GANTT_GRID = [
  { col0: { id: 'programma',      label: 'פרוגרמה' },                                      col1: null, col2: null, col3: null },
  { col0: { id: 'tikun_rishoni',  label: 'תכנון ראשוני' },                                  col1: null, col2: null, col3: null },
  { col0: { id: 'bchira_skitsa',  label: 'בחירת סקיצה' },                                   col1: null, col2: null, col3: null },
  { col0: { id: 'tiyuv_skitsa',   label: 'טיוב סקיצה' },                                    col1: null, col2: null, col3: null },
  { col0: { id: 'ishur_rishoni',  label: 'אישור ראשוני',          arrowTo: 'col1' },         col1: { id: 'tik_meida',          label: 'תיק מידע' },                         col2: null, col3: null },
  { col0: { id: 'tlat_meimad',    label: 'תלת מימד' },                                       col1: null, col2: null, col3: null },
  { col0: { id: 'ishur_skitsa',   label: 'אישור סקיצה סופי',      arrowTo: 'col1' },         col1: { id: 'garmushka',          label: 'הכנת גרמושקה' },                     col2: null, col3: null },
  { col0: null, col1: { id: 'ishur_yishuv',    label: 'אישור ישוב' },                        col2: null, col3: null },
  { col0: null, col1: { id: 'ptikha_bakasha',  label: 'פתיחה בקשה להיתר' },                 col2: null, col3: null },
  { col0: null, col1: { id: 'bkira_merchavit', label: 'בקרה מרחבית' },                       col2: null, col3: null },
  { col0: null, col1: { id: 'ishur_risuy',     label: 'אישור רישוי',      arrowTo: 'col2' }, col2: { id: 'hachanat_tochniot', label: 'הכנת תוכניות לביצוע' },             col3: null },
  { col0: null, col1: { id: 'bkarat_techn',    label: 'בקרת תכן' },                          col2: { id: 'pgisha_ishur',       label: 'פגישת אישור' },                      col3: null },
  { col0: null, col1: { id: 'kabalat_heter',   label: 'קבלת היתר' },                         col2: { id: 'hachanat_yoatzim',   label: 'הכנת תוכניות יועצים' },             col3: null },
  { col0: null, col1: null, col2: { id: 'hagasha_makhraz', label: 'הגשת תיק פרויקט למכרז', arrowTo: 'col3' }, col3: { id: 'bchira_mefakech', label: 'בחירת מפקח/קבלן' } },
  { col0: null, col1: null, col2: null,         col3: { id: 'pgisha_biytsuv', label: 'פגישה תכנון-ביצוע' } },
  { col0: null, col1: { id: 'tofes_2', label: 'טופס 2 – אישור בנייה', arrowTo: 'col3' },    col2: null, col3: { id: 'tchilat_bniya',   label: 'תחילת בנייה' } },
  { col0: null, col1: null, col2: null,         col3: { id: 'pikuach',        label: 'פיקוח עליון + ליווי פרויקט' } },
  { col0: null, col1: null, col2: null,         col3: { id: 'pgishat_gmarim', label: 'פגישת גמרים' } },
  { col0: null, col1: { id: 'tofes_4', label: 'טופס 4 – תעודת גמר' },                       col2: null, col3: { id: 'siyum_bniya', label: 'סיום בנייה', arrowTo: 'col1' } },
]

export const GANTT_COL_KEYS = ['col0', 'col1', 'col2', 'col3']

// Short mega-stage labels for client-facing groupings. The manager Gantt
// uses prefixed labels like 'שלב א׳ – תכנון' in its column headers; the
// client-side journey shows just the short name.
export const MEGA_STAGE_LABELS = {
  col0: 'תכנון',
  col1: 'רישוי',
  col2: 'תוכניות עבודה',
  col3: 'בנייה',
}

// Flatten the 2-D grid into a single chronological list: all of שלב א׳
// (top-to-bottom row order) → then שלב ב׳ → then ג׳ → then ד׳. Each item:
// { pointId, label, megaStage }.
export function buildFlatGanttList() {
  const out = []
  for (const col of GANTT_COL_KEYS) {
    for (const row of GANTT_GRID) {
      const cell = row[col]
      if (cell) {
        out.push({
          pointId: cell.id,
          label: cell.label,
          megaStage: MEGA_STAGE_LABELS[col],
        })
      }
    }
  }
  return out
}

// Optional per-point client-facing notes — rendered as a soft chip under
// the point's label on the client "שלבי התקדמות" screen. Unkeyed points
// render no note. Add a key only when a note should actually appear.
// Shape: { [pointId: string]: string }
export const CLIENT_NOTES = {
  ishur_rishoni:     'אחרי השלמת שלב זה, ניתן לעבור לשלב רישוי לפתיחת תיק מידע',
  tik_meida:         'שלב זה מותנה באישור ראשוני בשלב התכנון',
  garmushka:         'שלב זה מותנה באישור סקיצה סופית בשלב התכנון',
  ishur_risuy:       'אחרי השלמת שלב זה, ניתן לעבור לשלב תוכניות עבודה להכנת תוכניות לביצוע',
  hachanat_tochniot: 'שלב זה מותנה בהשלמת אישור הרישוי בשלב הרישוי',
  hagasha_makhraz:   'אחרי השלמת שלב זה, ניתן לעבור לבחירת מפקח/קבלן בשלב הבנייה',
  bchira_mefakech:   'שלב זה מותנה בסיום הגשת תיק פרויקט למכרז (בשלב תוכניות העבודה)',
  tofes_2:           'אחרי השלמת שלב זה, ניתן להתחיל בנייה',
  tchilat_bniya:     'שלב זה מותנה בקבלת טופס 2 (בשלב הרישוי)',
  tofes_4:           'שלב זה מותנה בסיום הבנייה',
  siyum_bniya:       'לאחר השלמת שלב זה ניתן להגיש בקשה לטופס 4 (בשלב הרישוי)',
}
