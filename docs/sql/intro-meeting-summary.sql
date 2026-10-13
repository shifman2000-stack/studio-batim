-- ════════════════════════════════════════════════════════════════════════
-- סיכום פגישת ההיכרות — עמודה אחת על inquiries
--
-- להריץ ב-DEV קודם, ואז ב-PROD. בטוח להרצה חוזרת.
--
-- מה זה שומר: ה-HTML שה-RichTextEditor מייצר (אותו עורך של סיכומי
-- הפגישות בכרטיס הפרויקט, ששומר HTML לתוך summary_md). טקסט, לא jsonb.
--
-- ⚠️ אין כאן שום שינוי הרשאות, ובכוונה. RLS על inquiries מוגדר ברמת
-- השורה ולא ברמת העמודה: המדיניות הקיימת (ראו את הבדיקה בסוף) מתירה
-- לצוות לקרוא ולעדכן את השורה כולה, ועמודה חדשה נכנסת תחתיה כמו כל
-- עמודה אחרת. לא נדרשת מדיניות חדשה, לא GRANT ולא שינוי ל-view או
-- לפונקציה — אין view או פונקציה שמונים את עמודות הטבלה הזו.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS intro_meeting_summary text;

COMMENT ON COLUMN public.inquiries.intro_meeting_summary IS
  'סיכום פגישת ההיכרות, HTML מה-RichTextEditor. נכתב ממסך /intro/:inquiryId וממסך הפניות.';


-- ── בדיקה אחרי ההרצה ────────────────────────────────────────────────────
-- 1) העמודה קיימת:
--
--    select column_name, data_type, is_nullable
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'inquiries'
--      and column_name  = 'intro_meeting_summary';
--
-- 2) ההרשאות שכבר קיימות על הטבלה — לוודא שיש מדיניות UPDATE לצוות,
--    ושאינה מזכירה עמודות בשמן:
--
--    select polname,
--           polcmd::text                                as cmd,
--           pg_get_expr(polqual,      polrelid)          as using_expr,
--           pg_get_expr(polwithcheck, polrelid)          as check_expr
--    from pg_policy p
--    join pg_class c on c.oid = p.polrelid
--    where c.relname = 'inquiries';
--
--    אם אחת מהן כן מזכירה רשימת עמודות מפורשת — עצרו ודווחו, כי אז
--    צריך להוסיף אליה גם את העמודה הזו. בבדיקה שנעשתה ב-DEV אף מדיניות
--    על inquiries לא עשתה זאת.
