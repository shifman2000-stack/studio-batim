-- ════════════════════════════════════════════════════════════════════════
-- הצעת מחיר v2 — שלב A: מודל הנתונים
-- ענף: feat/quote-v2-data · בסיס: master @ ab9b2ca
-- מקור התכנון: docs/quote-v2-design.md — פרקים A.4, A.6, והחלטות 19, 20
--
-- ⚠️ הקובץ אינו מוחל על ידי קלוד. לא הורץ כאן כלום, לא ב-Dev ולא ב-Prod.
--
-- סדר הרצה: 0 → 1 → 2 → 3 → 4 → 5 → 6. אין לדלג; 6 נגזר מ-5,
-- ו-5 תלוי ב-2. סעיף 0 הוא קריאה בלבד ואינו משנה דבר.
--
-- להריץ קודם ב-Dev במלואו, לרוץ על בדיקות השפיות, ורק אז ב-Prod.
-- הקובץ אידמפוטנטי: הרצה חוזרת לא תיצור כפילויות ולא תדרוס תוכן ערוך.
--
-- ⚠️ מה הקובץ הזה לא עושה: הוא לא נוגע ב-quotes, ב-quote_versions,
--    ב-inquiries או בכל טבלה קיימת. 15 ההצעות הקיימות לא מושפעות
--    בשום צורה — אין כאן ALTER ואין UPDATE על טבלה קיימת.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- 0. בדיקה מקדימה — קריאה בלבד. להריץ ולקרוא לפני שממשיכים.
-- ════════════════════════════════════════════════════════════════════════

-- מצופה: 0 שורות בכל אחת מהשלוש. אם משהו חוזר — לעצור ולדווח,
-- כי המשך ההרצה ידרוס אובייקט קיים ששייך למישהו אחר.

-- א. אין טבלאות בשמות האלה:
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('quote_templates', 'quote_library_items');

-- ב. אין פונקציות בשמות האלה (CREATE OR REPLACE היה דורס אותן בשקט):
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_studio_admin', 'quote_v2_touch_updated_at');

-- ג. יש טבלת profiles עם עמודת role — מדיניות ה-RLS נשענת עליה:
--    מצופה: שורה אחת, data_type = 'text'
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';


-- ════════════════════════════════════════════════════════════════════════
-- 1. פונקציות עזר
-- ════════════════════════════════════════════════════════════════════════

-- is_studio_admin — האם המשתמש המחובר הוא admin.
--
-- למה פונקציה ולא תת-שאילתה ישירות במדיניות: מדיניות RLS על
-- quote_templates שעושה SELECT מ-profiles תיתקל ב-RLS של profiles,
-- והתוצאה תהיה תלויה במדיניות של טבלה אחרת לגמרי. SECURITY DEFINER
-- מנתק את התלות הזו ומחזיר תשובה אחת ויציבה.
--
-- STABLE (ולא VOLATILE) כדי שהמתכנן יקרא לה פעם אחת לשאילתה ולא לכל שורה.
-- search_path מקובע כדי שלא ניתן יהיה להחליף את profiles בסכמה אחרת.
CREATE OR REPLACE FUNCTION public.is_studio_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  );
$function$;

COMMENT ON FUNCTION public.is_studio_admin() IS
  'true אם למשתמש המחובר יש profiles.role = ''admin''. משמשת את מדיניות ה-RLS של quote_templates ו-quote_library_items.';

REVOKE ALL ON FUNCTION public.is_studio_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_studio_admin() TO authenticated, service_role;


-- quote_v2_touch_updated_at — טריגר שמעדכן updated_at בכל כתיבה.
--
-- בלי זה updated_at היה נשאר על ערך היצירה, והעורך לא היה יכול
-- להציג "עודכן לאחרונה" אמין. השם ייחודי בכוונה כדי לא להתנגש
-- בפונקציית טריגר כללית שאולי קיימת כבר בפרויקט.
-- search_path ריק: הפונקציה לא נוגעת בשום אובייקט חוץ מ-now() שמגיע
-- מ-pg_catalog, ושורת ה-SET משתיקה את אזהרת ה-linter של Supabase.
CREATE OR REPLACE FUNCTION public.quote_v2_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════
-- 2. טבלה: quote_templates
--
-- ברירת המחדל שהצעה חדשה נפתחת איתה. התוכן הוא אותו מבנה sections
-- של content_v2 — בלי clients, בלי vars ובלי clientResponse, כי אלה
-- נגזרים מהפנייה בזמן יצירת ההצעה ואין להם מקום בתבנית.
--
-- ⚠️ התבנית אינה מקור חי. בזמן יצירת הצעה התוכן **מועתק** לתוך
--    quotes.draft_content, ומאותו רגע ההצעה עצמאית. עדכון התבנית
--    משפיע על הצעות חדשות בלבד (החלטה 14 במסמך התכנון).
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.quote_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  is_default  boolean     NOT NULL DEFAULT false,
  content     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- שתי בדיקות שמונעות שמירת תבנית שהעורך לא יידע לקרוא:
  CONSTRAINT quote_templates_schema_is_2
    CHECK ((content->>'schema') = '2'),
  CONSTRAINT quote_templates_sections_is_array
    CHECK (jsonb_typeof(content->'sections') = 'array')
);

COMMENT ON TABLE  public.quote_templates            IS 'תבניות ברירת מחדל להצעות מחיר v2. התוכן מועתק להצעה בזמן היצירה ואינו מקור חי.';
COMMENT ON COLUMN public.quote_templates.is_default IS 'בדיוק אחת true, נאכף באינדקס ייחודי חלקי.';
COMMENT ON COLUMN public.quote_templates.content    IS 'מבנה content_v2 בלי clients/vars/clientResponse. חייב schema=2 ומערך sections.';

-- בדיוק תבנית ברירת מחדל אחת. אינדקס ייחודי חלקי: הוא מתעלם
-- מכל השורות שבהן is_default = false, ולכן מאפשר כמה תבניות
-- משניות אבל רק ברירת מחדל אחת.
CREATE UNIQUE INDEX IF NOT EXISTS quote_templates_one_default_idx
  ON public.quote_templates (is_default) WHERE is_default;

DROP TRIGGER IF EXISTS quote_templates_touch ON public.quote_templates;
CREATE TRIGGER quote_templates_touch
  BEFORE UPDATE ON public.quote_templates
  FOR EACH ROW EXECUTE FUNCTION public.quote_v2_touch_updated_at();


-- ════════════════════════════════════════════════════════════════════════
-- 3. טבלה: quote_library_items
--
-- ספריית הפריטים הרב-פעמיים. שני מפלסים חיים כאן יחד, ו-type הוא
-- שמבדיל ביניהם:
--   סעיף שלם:  opening · stage · fee · signing
--   פריט בודד: qa (שאלה אחת ב"ומה אם…?") · extra (תוספת אחת)
-- כך אפשר להוסיף שלב שלם מהספרייה, או תנאי בודד, מאותה מגירה.
--
-- ⚠️ שים לב להבדל בשמות: סעיף התוספות ב-content נקרא 'extras' (רבים),
--    ואילו פריט תוספת בודד בספרייה נקרא 'extra' (יחיד). זה מכוון —
--    הספרייה לא מחזיקה את סעיף התוספות כולו, רק תוספות בודדות.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.quote_library_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text        NOT NULL,
  title       text        NOT NULL,
  payload     jsonb       NOT NULL,
  tags        text[]      NOT NULL DEFAULT '{}',
  archived    boolean     NOT NULL DEFAULT false,
  usage_count integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quote_library_items_type_valid
    CHECK (type IN ('opening', 'stage', 'fee', 'qa', 'extra', 'signing')),
  CONSTRAINT quote_library_items_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT quote_library_items_usage_not_negative
    CHECK (usage_count >= 0)
);

COMMENT ON TABLE  public.quote_library_items             IS 'ספריית סעיפים ופריטים רב-פעמיים להצעות v2.';
COMMENT ON COLUMN public.quote_library_items.type        IS 'סעיף שלם: opening/stage/fee/signing · פריט בודד: qa/extra';
COMMENT ON COLUMN public.quote_library_items.payload     IS 'גוף הסעיף או הפריט, בלי id/enabled/libraryId.';
COMMENT ON COLUMN public.quote_library_items.archived    IS 'מסתירים במקום למחוק — הצעות ישנות עשויות להצביע לכאן דרך libraryId.';
COMMENT ON COLUMN public.quote_library_items.usage_count IS 'מונה שימושים, למיון הספרייה. מעודכן ע״י העורך, לא ע״י טריגר.';

-- מיון הספרייה הוא תמיד "לפי טיפוס, ורק מה שלא בארכיון".
CREATE INDEX IF NOT EXISTS quote_library_items_type_idx
  ON public.quote_library_items (type) WHERE NOT archived;

DROP TRIGGER IF EXISTS quote_library_items_touch ON public.quote_library_items;
CREATE TRIGGER quote_library_items_touch
  BEFORE UPDATE ON public.quote_library_items
  FOR EACH ROW EXECUTE FUNCTION public.quote_v2_touch_updated_at();


-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS והרשאות — admin בלבד
--
-- שתי הטבלאות הן כלי עבודה של עינב. הלקוח לעולם לא קורא מהן: התוכן
-- מועתק ל-quotes.draft_content ומשם ל-quote_versions.content, ורק
-- האחרון מוגש ללקוח דרך get_quote_by_token.
--
-- ⚠️ שים לב להבדל מהטבלאות הקיימות: quotes מתירה הכול ל-authenticated
--    וקריאה ל-anon. כאן מצומצם ל-admin בלבד, ול-anon אין שום גישה.
--    זו החמרה מכוונת ולא העתקה של התבנית הקיימת.
--
-- service_role עוקף RLS מעצם הגדרתו, ולכן פונקציות השרת ימשיכו לעבוד.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.quote_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_library_items ENABLE ROW LEVEL SECURITY;

-- FOR ALL עם USING ו-WITH CHECK זהים: admin רואה ועורך הכול,
-- וכל מי שאינו admin לא רואה כלום ולא יכול לכתוב כלום.
DROP POLICY IF EXISTS "admin full access on quote_templates" ON public.quote_templates;
CREATE POLICY "admin full access on quote_templates"
  ON public.quote_templates
  FOR ALL
  TO authenticated
  USING (public.is_studio_admin())
  WITH CHECK (public.is_studio_admin());

DROP POLICY IF EXISTS "admin full access on quote_library_items" ON public.quote_library_items;
CREATE POLICY "admin full access on quote_library_items"
  ON public.quote_library_items
  FOR ALL
  TO authenticated
  USING (public.is_studio_admin())
  WITH CHECK (public.is_studio_admin());

-- הרשאות ברמת הטבלה. Supabase מעניקה כברירת מחדל הרשאות רחבות
-- לתפקידים anon ו-authenticated על כל טבלה חדשה בסכמה public;
-- RLS היה חוסם בפועל גם בלי זה, אבל שתי שכבות עדיפות על אחת.
REVOKE ALL ON TABLE public.quote_templates     FROM anon;
REVOKE ALL ON TABLE public.quote_library_items FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_templates     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_library_items TO authenticated;


-- ████████████████████████████████████████████████████████████████████████
--
--                              S E E D
--
--  מכאן והלאה: נתונים, לא מבנה. סעיפים 5 ו-6 יוצרים את תבנית
--  ברירת המחדל ואת הספרייה ההתחלתית מהתוכן האמיתי של היום.
--
--  מקורות התוכן, ומה נלקח מכל אחד:
--    QuotePreview.jsx:38-215  → שמות רשמיים, אחוזים, מועדי תשלום, משכי זמן,
--                               ו-12 התנאים (גוף הטקסט מילה במילה)
--    docs/mockups/quote-journey.html → כותרות סיפוריות, התהליך, התוצר,
--                               טקסטי הפתיחה והחתימה, שתי התוספות
--
--  שתי הערות חשובות לפני שרצים:
--
--  א. היכן שהמוקאפ וה-v1 נחלקו על עובדה — **v1 ניצח**. המוקאפ כותב
--     "כ-90 יום" לשלב 2 ו"כ-8-10 חודשים" לשלב 4; בלוח התשלומים של
--     v1 כתוב "10 ימי עבודה בין פגישה לפגישה" ו"בהתאם לרשויות".
--     נשמרו ערכי v1, כי הם אלה שנחתמו ב-15 הצעות.
--
--  ב. טקסטים שהועתקו **כלשונם מ-v1** נשמרו כלשונם גם כשהם נראים
--     כשגיאה. ראו את הערות ⚠️ בגוף ה-SEED.
--
-- ████████████████████████████████████████████████████████████████████████


-- ════════════════════════════════════════════════════════════════════════
-- 5. תבנית ברירת המחדל
--
-- מבנה ה-content: schema + drawingVariant + sections. אין clients,
-- אין vars, אין clientResponse — אלה נולדים בזמן יצירת ההצעה.
--
-- תחביר הטקסט, שני מנגנונים נפרדים (פרק A.6 במסמך התכנון):
--   {{משתנה}}      — מוחלף בערך מהפנייה
--   {יחיד|רבים}    — נבחר לפי מספר הלקוחות
-- סדר הפתרון: קודם משתנים, אחר כך חלופות.
--
-- האחוזים: 15+20+20+20+20+5 = 100. אם משנים כאן — לוודא שוב.
--
-- ה-INSERT מותנה: אם כבר קיימת תבנית ברירת מחדל, הוא לא עושה כלום.
-- כך הרצה חוזרת לא תדרוס תבנית שעינב כבר ערכה.
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO public.quote_templates (name, is_default, content)
SELECT
  'ברירת מחדל — בית מגורים',
  true,
  $json$
{
  "schema": 2,
  "drawingVariant": "newHouse",
  "sections": [

    {
      "id": "sec_open_1",
      "type": "opening",
      "enabled": true,
      "libraryId": null,
      "greeting": "{{firstNames}},\n{בוא|בואו} נבנה\n{לך|לכם} בית.",
      "intro": "תכנון אדריכלי, רישוי וליווי של בית מגורים של כ-{{houseArea}} מ״ר ב{{settlement}}, עם פיתוח מגרש של כ-{{plotArea}} מ״ר. {גלול|גללו} למטה, והבית ייבנה מול העיניים, שלב אחרי שלב, בדיוק בסדר שבו נעבוד יחד."
    },

    {
      "id": "sec_stage_1",
      "type": "stage",
      "enabled": true,
      "libraryId": null,
      "storyTitle": "מקשיבים, ומשרטטים את הקו הראשון",
      "formalTitle": "איסוף מידע ותכנון ראשוני",
      "body": "נשב יחד לפגישת פרוגרמה: {מה אתה צריך, איך אתה חי, איזה בית אתה רואה בעיניים|מה אתם צריכים, איך אתם חיים, איזה בית אתם רואים בעיניים}. במקביל נלמד את המגרש לעומק, את המדידה, את התב״ע ואת הזכויות, ונבקר בשטח. מכל זה ייצאו חלופות תכנון ראשונות.",
      "deliverable": "סקיצות ראשונות לבחינה משותפת, עם חלוקת חללים פנים וחוץ והעמדת ריהוט.",
      "duration": "30 ימי עבודה מפגישת פרוגראמה",
      "paymentPct": 15,
      "paymentTrigger": "עם חתימת החוזה"
    },

    {
      "id": "sec_stage_2",
      "type": "stage",
      "enabled": true,
      "libraryId": null,
      "storyTitle": "הבית מקבל צורה",
      "formalTitle": "פיתוח תוכנית סופית",
      "body": "את החלופה {שבחרת|שבחרתם} נפתח לתוכניות מפורטות: קומות, גג, חזיתות, ופיתוח המגרש לפרטיו, משבילי הגישה והחניה ועד המרפסות. בסוף השלב {תטייל|תטיילו} בבית עם משקפי VR, עוד לפני שהונחה בו לבנה אחת.",
      "deliverable": "סט תוכניות אדריכליות סופיות ומודל תלת-ממדי של הבית.",
      "duration": "10 ימי עבודה בין פגישה לפגישה",
      "paymentPct": 20,
      "paymentTrigger": "עם מסירת סקיצות ראשונות"
    },

    {
      "id": "sec_stage_3",
      "type": "stage",
      "enabled": true,
      "libraryId": null,
      "storyTitle": "מתרגמים את החלום לשפה של הוועדה",
      "formalTitle": "הכנת בקשה להיתר (גרמושקה)",
      "body": "נקבל מהוועדה את תיק המידע, ונהפוך את התוכניות לגרמושקה רשמית עם כל הטפסים והנספחים. נתאם את כל יועצי הרישוי, מהמודד ועד הקונסטרוקטור, ונטמיע את התכנון שלהם בבקשה.",
      "deliverable": "תיק רישוי מלא ומסודר, מוכן להגשה.",
      "duration": "30 ימי עבודה מאישור החלופה",
      "paymentPct": 20,
      "paymentTrigger": "עם אישור חלופת תכנון"
    },

    {
      "id": "sec_stage_4",
      "type": "stage",
      "enabled": true,
      "libraryId": null,
      "storyTitle": "החותמת",
      "formalTitle": "טיפול בבקשה להיתר",
      "body": "נפתח את הבקשה ב״רישוי זמין״ ונלווה אותה לאורך כל הבקרות מול הוועדה, נענה לכל דרישה {ונכוון אותך במה שבאחריותך|ונכוון אתכם במה שבאחריותכם}, כמו חתימות היישוב והסכמים. זה השלב הארוך והסבלני.",
      "deliverable": "היתר בנייה מאושר וחתום.",
      "duration": "בהתאם לרשויות",
      "paymentPct": 20,
      "paymentTrigger": "עם פתיחת בקשה במערכת רישוי זמין"
    },

    {
      "id": "sec_stage_5",
      "type": "stage",
      "enabled": true,
      "libraryId": null,
      "storyTitle": "כל פרט, כל חלון, כל שקע",
      "formalTitle": "תוכניות עבודה, פיקוח עליון, שעות ייעוץ",
      "body": "נפיק את סט תוכניות העבודה, שבו כל היועצים מסונכרנים לתוך הסט האדריכלי: חתכים, חשמל ותאורה, אינסטלציה, מיזוג, אלומיניום, מטבח וחדרי רחצה. בנוסף נכין מפרט כמויות לחיפויים, לריצופים ולכלים הסניטריים.",
      "deliverable": "סט תוכניות מלא למכרז ולביצוע.",
      "duration": "30 ימי עבודה + 10 ימי עיבוד",
      "paymentPct": 20,
      "paymentTrigger": "עם אישור ו.רישוי"
    },

    {
      "id": "sec_stage_6",
      "type": "stage",
      "enabled": true,
      "libraryId": null,
      "storyTitle": "{ונשארים איתך עד שנדלק האור|ונשארים איתכם עד שנדלק האור}",
      "formalTitle": "סיום פרויקט וחתימה על טופס 4",
      "body": "נגיש את טופס 2 ונלווה את הבנייה: ארבעה ביקורי פיקוח עליון בנקודות המפתח, מענה שוטף מול הקבלנים, פגישת עיצוב פנים וסיור משותף באולם התצוגה. כשהבנייה תסתיים, נגיש את הטפסים לטופס 4.",
      "deliverable": "ליווי אדריכלי עד המפתח, ותעודת גמר.",
      "duration": "—",
      "paymentPct": 5,
      "paymentTrigger": "עם סיום הבניה *"
    },

    {
      "id": "sec_fee_1",
      "type": "fee",
      "enabled": true,
      "libraryId": null,
      "question": "אז כמה זה עולה?",
      "note": "על כל מה {שראית|שראיתם} למעלה · בתוספת מע״מ"
    },

    {
      "id": "sec_qa_1",
      "type": "qa",
      "enabled": true,
      "libraryId": null,
      "title": "ומה אם…?",
      "subtitle": "התנאים, בתור השאלות {שאתה בטח כבר שואל|שאתם בטח כבר שואלים}.",
      "pdfTitle": "תנאי ההתקשרות",
      "items": [

        {
          "id": "qa_01_scope",
          "question": "…נתוני הפרויקט ישתנו בדרך?",
          "formalTitle": "התאמת ההצעה לנתוני הפרויקט",
          "body": "הצעת המחיר תואמת לנתונים המפורטים בתכולת השירות ובפירוט שלבי העבודה. במידה וישתנו הנתונים תעודכן הצעת המחיר בהתאם."
        },
        {
          "id": "qa_02_changes",
          "question": "…נרצה לשנות משהו שכבר אישרנו?",
          "formalTitle": "שינויים וחזרה על שלבים שהסתיימו",
          "body": "שינוי פרוגרמה, או כל שינוי אחר הכרוך בחזרה על שלבי עבודה שהסתיימו, וכן תוספת שעות מעבר למוגדר בהסכם (כגון שעות ייעוץ) — ייעשה תמורת תשלום של 350 ₪ לשעת עבודה, בתוספת מע״מ כחוק."
        },
        {
          "id": "qa_03_timeline",
          "question": "…הרשויות יתעכבו?",
          "formalTitle": "לוחות זמנים",
          "body": "משך הזמן המוגדר לכל שלב מהווה הערכה עקרונית, תוך גמישות והבנה כי קיימים אילוצים שונים שיכולים להשפיע על מסגרת הזמן — לרבות סיבות שאינן תלויות באף אחד מהצדדים ו/או כוח עליון."
        },
        {
          "id": "qa_04_validity",
          "question": "ממתי ההסכם בתוקף?",
          "formalTitle": "כניסת ההסכם לתוקף",
          "body": "תשלום ראשון מהווה הסכמה של שני הצדדים להמשך עבודה על פי הסכם זה, ויהווה מתן תוקף להסכם."
        },
        {
          "id": "qa_05_consultants",
          "question": "אילו יועצים לא כלולים בהצעה?",
          "formalTitle": "אינו כלול — שירותי יועצים",
          "body": "שירותי יועצים שונים: מפקח בניה, מודד, יועץ קרקע, מהנדסי קונסטרוקציה/אינסטלציה/חשמל, אדריכל נוף, יועץ בטיחות אש וכיו״ב."
        },
        {
          "id": "qa_06_fees",
          "question": "מי משלם אגרות והיטלים?",
          "formalTitle": "אינו כלול — אגרות והיטלים",
          "body": "תשלום אגרות, היטלים או כל תשלום אחר שיידרש על ידי הרשויות השונות."
        },
        {
          "id": "qa_07_printing",
          "question": "מי משלם על הדפסות ושליחויות?",
          "formalTitle": "אינו כלול — הדפסות ושליחויות",
          "body": "צילומי תוכניות והדפסות, שליחויות ע״י מכון הצילום ומשלוחי דואר. המזמין יפרע חיובים אלו ישירות מול מכון הצילום."
        },
        {
          "id": "qa_08_deviations",
          "question": "…יתברר שיש חריגות בנייה?",
          "formalTitle": "אינו כלול — חריגות בנייה",
          "body": "סוגיות תכנון רישוי וביצוע חריגות — יתומחרו בנפרד בהתאם."
        },
        {
          "id": "qa_09_copyright",
          "question": "של מי התוכניות?",
          "formalTitle": "זכויות יוצרים בתכנון",
          "body": "למתכנן שמורה זכות היוצרים על התכנון. המתכנן רשאי לעשות שימוש בתוכניות ללא הגבלה. המזמין אינו רשאי להשתמש בתוכניות או בהעתק שלהן למעט לצורך הקמת הפרויקט הכלול בהסכם זה בלבד."
        },
        {
          "id": "qa_10_nopermit",
          "question": "…ייבנה משהו שלא לפי ההיתר?",
          "formalTitle": "בנייה ללא היתר או בסטייה ממנו",
          "body": "אין המתכנן אחראי על עבודה ללא היתר בניה ו/או בסטייה ממנו. המתכנן רשאי להפסיק את הטיפול בתיק ולהסיר כל אחריות במקרה של איחור בתשלומים, בניה ללא היתר או ביצוע חריגות בניה."
        },
        {
          "id": "qa_11_norefund",
          "question": "…הפרויקט לא ייצא לפועל?",
          "formalTitle": "אי-החזר תשלומים",
          "body": "לא יוחזר למזמין סכום אשר שולם למתכנן על חשבון שכר טרחתו — לרבות עקב השהיית הפרויקט, אי מתן היתר ו/או סירוב על פי החלטת הוועדה לתכנון ובניה או כל גוף או רשות אחרים."
        },
        {
          "id": "qa_12_suspension",
          "question": "…נעצור את הפרויקט לתקופה?",
          "formalTitle": "השהיית הפרויקט",
          "body": "במידה והפרויקט מושהה מכל סיבה שהיא, בכל שלב, לפרק זמן העולה על 90 יום — הסכם זה יבוטל, והמשך העבודה ייעשה בהתקשרות מחודשת. כך גם במקרה של הפסקת בניה שהחלה לפרק זמן העולה על 90 יום."
        }

      ]
    },

    {
      "id": "sec_extras_1",
      "type": "extras",
      "enabled": true,
      "libraryId": null,
      "title": "רוצים עוד?",
      "subtitle": "שירותים שלא כלולים בהצעה. {סמן|סמנו} מה {מעניין אותך|מעניין אתכם}, ועינב {תחזור אליך|תחזור אליכם} עם הצעה נפרדת.",
      "items": [
        {
          "id": "ex_carpentry",
          "title": "פרטי נגרות בהתאמה אישית",
          "sub": "ארונות, ספריות ומטבח, מתוכננים עד הבורג"
        },
        {
          "id": "ex_import",
          "title": "ליווי רכישות ביבוא אישי",
          "sub": "חיפויים, תאורה וכלים סניטריים מחו״ל"
        }
      ]
    },

    {
      "id": "sec_sign_1",
      "type": "signing",
      "enabled": true,
      "libraryId": null,
      "headline": "אז, מתחילים?",
      "subtitle": "חתימה כאן מאשרת את ההצעה ואת התנאים שלמעלה, ומניחה את הלבנה הראשונה.",
      "consentLabel": "קראתי את ההצעה ואת תנאי ההתקשרות ואני מאשר/ת",
      "legal": "עם החתימה יישלח {אליך|אליכם} עותק PDF של ההצעה החתומה.",
      "doneHeadline": "הלבנה הראשונה הונחה.",
      "doneBody": "תודה, {{firstNames}}. עינב תיצור {איתך|איתכם} קשר בימים הקרובים לתיאום פגישת הפרוגרמה."
    }

  ]
}
$json$::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.quote_templates WHERE is_default
);

-- ⚠️ הערות על ה-SEED שלמעלה — לקרוא לפני אישור התוכן:
--
--  1. "30 ימי עבודה מפגישת פרוגראמה" — "פרוגראמה" באל״ף, כך זה כתוב
--     ב-v1 היום (QuotePreview.jsx:74) וכך נשלח ב-15 הצעות. הועתק
--     כלשונו. אם רוצים לתקן ל"פרוגרמה" — זה תיקון תוכן, לא תיקון קוד.
--
--  2. "עם סיום הבניה *" — הכוכבית הזו מפנה ב-v1 להערת שוליים מתחת
--     ללוח התשלומים: "* עד 12 חודשים מקבלת היתר". **למודל v2 אין
--     שדה להערת שוליים**, ולכן הכוכבית כאן תלויה באוויר. הועתקה
--     כלשונה כדי לא לשנות נוסח חתום, אבל זו החלטה שצריכה הכרעה.
--
--  3. שלב 2 מבטיח "משקפי VR". **ב-v1 אין התחייבות ל-VR** — s01_render
--     מבטיח "הדמיה תלת-ממדית ממוחשבת... מבטי חוץ לצרכי היתר בלבד".
--     זו התחייבות חדשה שהמוקאפ הכניס. נשמרה כי ההנחיה הייתה לקחת את
--     הטקסטים הסיפוריים מהמוקאפ, אבל היא דורשת אישור מפורש של עינב.
--
--  4. מהמוקאפ הוסרו שלושה פרטים ספציפיים לפרויקט לדוגמה, כי תבנית
--     ברירת מחדל לא יכולה להבטיח אותם: "דו-קומתי", "ובריכת שחייה"
--     (פעמיים — בפתיחה ובשלב 2), ו"כולל מיקום מוקדם לבריכה" (שלב 1).
--
--  5. סדר 12 התנאים הוא **סדר v1** (תנאי ההצעה → מה אינו כלול →
--     זכויות ואחריות), כדי שה-PDF ייקרא באותו סדר כמו היום. בחוויה
--     אפשר יהיה לסדר מחדש בגרירה; זה לא משנה את התוכן.
--
--  6. פריטים 5-8 נכתבו ב-v1 כפריטי רשימה תחת הכותרת "מה אינו כלול
--     בהצעה", ולכן הם שברי משפט. אסור לנסח אותם מחדש, ולכן ההקשר
--     החסר נישא בכותרת הרשמית ("אינו כלול — …") ובשאלה.
--
--  7. libraryId הוא null בכל הסעיפים. הקישור לספרייה נוצר רק כשעינב
--     מוסיפה סעיף מהספרייה בעורך (שלב 6). לסעיפים הזרועים אין צורך
--     בו, כי ה-id שלהם יציב ומועתק להצעה.
--
--
-- ────────────────────────────────────────────────────────────────────────
-- 12 התנאים — טבלת אישור
--
-- "גוף הטקסט" הוא terms[n] של v1, **מילה במילה**. אומת תו-בתו מול
-- QuotePreview.jsx:191-207 — 12/12 זהים.
-- מה שנכתב חדש הוא רק הכותרת הרשמית והשאלה.
--
--  #  | כותרת רשמית (ל-PDF)              | שאלה (לחוויה)                  | מילות הפתיחה של הגוף
-- ────┼──────────────────────────────────┼────────────────────────────────┼──────────────────────────
--  1  | התאמת ההצעה לנתוני הפרויקט        | …נתוני הפרויקט ישתנו בדרך?      | "הצעת המחיר תואמת לנתונים המפורטים בתכולת…"
--  2  | שינויים וחזרה על שלבים שהסתיימו   | …נרצה לשנות משהו שכבר אישרנו?   | "שינוי פרוגרמה, או כל שינוי אחר…"
--  3  | לוחות זמנים                       | …הרשויות יתעכבו?                | "משך הזמן המוגדר לכל שלב מהווה…"
--  4  | כניסת ההסכם לתוקף                 | ממתי ההסכם בתוקף?               | "תשלום ראשון מהווה הסכמה של שני…"
--  5  | אינו כלול — שירותי יועצים          | אילו יועצים לא כלולים בהצעה?    | "שירותי יועצים שונים: מפקח בניה, מודד,…"
--  6  | אינו כלול — אגרות והיטלים          | מי משלם אגרות והיטלים?          | "תשלום אגרות, היטלים או כל תשלום…"
--  7  | אינו כלול — הדפסות ושליחויות       | מי משלם על הדפסות ושליחויות?    | "צילומי תוכניות והדפסות, שליחויות ע״י מכון…"
--  8  | אינו כלול — חריגות בנייה           | …יתברר שיש חריגות בנייה?        | "סוגיות תכנון רישוי וביצוע חריגות —…"
--  9  | זכויות יוצרים בתכנון              | של מי התוכניות?                 | "למתכנן שמורה זכות היוצרים על התכנון.…"
-- 10  | בנייה ללא היתר או בסטייה ממנו     | …ייבנה משהו שלא לפי ההיתר?      | "אין המתכנן אחראי על עבודה ללא…"
-- 11  | אי-החזר תשלומים                   | …הפרויקט לא ייצא לפועל?         | "לא יוחזר למזמין סכום אשר שולם…"
-- 12  | השהיית הפרויקט                    | …נעצור את הפרויקט לתקופה?       | "במידה והפרויקט מושהה מכל סיבה שהיא,…"
--
-- הסדר הוא סדר v1: 1-4 "תנאי ההצעה", 5-8 "מה אינו כלול בהצעה",
-- 9-12 "זכויות ואחריות". שלוש כותרות הקבוצות של v1 אינן נשמרות כשדה —
-- בקבוצה 2 ההקשר נישא בתחילית "אינו כלול —" של הכותרת הרשמית.
-- ────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════
-- 6. ספריית הפריטים ההתחלתית
--
-- נגזרת ישירות מהתבנית שנוצרה בסעיף 5, ולא מועתקת בנפרד — כך
-- מובטח שהספרייה והתבנית מתחילות זהות מילה במילה.
--
-- payload מנוקה מ-id, enabled ו-libraryId: אלה שייכים למופע בתוך
-- הצעה מסוימת, לא לפריט בספרייה.
--
-- כל INSERT מוגן בתנאי על הטיפוס שלו, כדי שהרצה חוזרת לא תכפיל.
-- ════════════════════════════════════════════════════════════════════════

-- 6א. סעיפים שלמים: פתיחה, 6 שלבים, שכר טרחה, חתימה = 9 פריטים
INSERT INTO public.quote_library_items (type, title, payload, tags)
SELECT
  s->>'type',
  CASE s->>'type'
    WHEN 'stage'   THEN s->>'formalTitle'
    WHEN 'opening' THEN 'פתיחה — ברירת מחדל'
    WHEN 'fee'     THEN 'שכר טרחה — ברירת מחדל'
    WHEN 'signing' THEN 'חתימה — ברירת מחדל'
  END,
  s - 'id' - 'enabled' - 'libraryId',
  ARRAY['בית מגורים']
FROM public.quote_templates t,
     LATERAL jsonb_array_elements(t.content->'sections') AS s
WHERE t.is_default
  AND s->>'type' IN ('opening', 'stage', 'fee', 'signing')
  AND NOT EXISTS (
    SELECT 1 FROM public.quote_library_items
    WHERE type IN ('opening', 'stage', 'fee', 'signing')
  );

-- 6ב. 12 פריטי "ומה אם…?" — כל אחד נכנס לספרייה בנפרד,
--     כדי שאפשר יהיה להוסיף תנאי בודד להצעה בלי להביא את כולם.
INSERT INTO public.quote_library_items (type, title, payload, tags)
SELECT
  'qa',
  i->>'formalTitle',
  i - 'id',
  ARRAY['תנאי התקשרות']
FROM public.quote_templates t,
     LATERAL jsonb_array_elements(t.content->'sections') AS s,
     LATERAL jsonb_array_elements(s->'items') AS i
WHERE t.is_default
  AND s->>'type' = 'qa'
  AND NOT EXISTS (
    SELECT 1 FROM public.quote_library_items WHERE type = 'qa'
  );

-- 6ג. שתי התוספות
INSERT INTO public.quote_library_items (type, title, payload, tags)
SELECT
  'extra',
  i->>'title',
  i - 'id',
  ARRAY['תוספת']
FROM public.quote_templates t,
     LATERAL jsonb_array_elements(t.content->'sections') AS s,
     LATERAL jsonb_array_elements(s->'items') AS i
WHERE t.is_default
  AND s->>'type' = 'extras'
  AND NOT EXISTS (
    SELECT 1 FROM public.quote_library_items WHERE type = 'extra'
  );


-- ════════════════════════════════════════════════════════════════════════
-- בדיקות שפיות — להריץ אחרי 1-6. קריאה בלבד, לא משנות דבר.
-- ════════════════════════════════════════════════════════════════════════

-- א. תבנית אחת, ברירת מחדל, 11 סעיפים:
--    מצופה: templates = 1, sections = 11
-- SELECT count(*) AS templates,
--        jsonb_array_length((SELECT content->'sections'
--                            FROM public.quote_templates WHERE is_default)) AS sections
-- FROM public.quote_templates;

-- ב. האחוזים מסתכמים ל-100:
--    מצופה: 100
-- SELECT sum((s->>'paymentPct')::int) AS total_pct
-- FROM public.quote_templates t,
--      LATERAL jsonb_array_elements(t.content->'sections') AS s
-- WHERE t.is_default AND s->>'type' = 'stage';

-- ג. 12 תנאים בדיוק, ולכל אחד שאלה, כותרת רשמית וגוף:
--    מצופה: items = 12, complete = 12
-- SELECT count(*) AS items,
--        count(*) FILTER (WHERE i->>'question'    <> ''
--                           AND i->>'formalTitle' <> ''
--                           AND i->>'body'        <> '') AS complete
-- FROM public.quote_templates t,
--      LATERAL jsonb_array_elements(t.content->'sections') AS s,
--      LATERAL jsonb_array_elements(s->'items') AS i
-- WHERE t.is_default AND s->>'type' = 'qa';

-- ד. הספרייה: 23 פריטים — 1 פתיחה, 6 שלבים, 1 שכר טרחה, 1 חתימה,
--    12 תנאים, 2 תוספות:
--    מצופה: בדיוק השורות האלה
-- SELECT type, count(*) FROM public.quote_library_items
-- GROUP BY type ORDER BY type;

-- ה. כל חלופות הדקדוק תקינות — בדיוק קו אנכי אחד בכל {…}:
--    מצופה: 0 שורות
--    הערה: regexp_replace מסיר קודם את {{המשתנים}}, אחרת הסוגריים
--    הפנימיים שלהם היו נראים כמו חלופה פגומה. החרגת " בתוך הסוגר
--    היא מה שמבדיל חלופה מאובייקט JSON רגיל.
-- SELECT m[1] AS bad
-- FROM public.quote_templates t,
--      LATERAL regexp_matches(
--        regexp_replace(t.content::text, '\{\{[A-Za-z]+\}\}', '', 'g'),
--        '\{[^{}"]*\}', 'g') AS m
-- WHERE t.is_default
--   AND (length(m[1]) - length(replace(m[1], '|', ''))) <> 1;

-- ו. ספירת חלופות ומשתנים — שומר מפני מחיקה בשוגג:
--    מצופה: alternates = 15, variables = 5
-- SELECT
--   (SELECT count(*) FROM regexp_matches(
--      regexp_replace(t.content::text, '\{\{[A-Za-z]+\}\}', '', 'g'),
--      '\{[^{}"]*\|[^{}"]*\}', 'g')) AS alternates,
--   (SELECT count(*) FROM regexp_matches(
--      t.content::text, '\{\{[A-Za-z]+\}\}', 'g')) AS variables
-- FROM public.quote_templates t WHERE t.is_default;

-- ז. ה-RLS באמת חוסם: להריץ מחובר כמשתמש שאינו admin.
--    מצופה: 0 שורות (ולא שגיאה)
-- SELECT count(*) FROM public.quote_templates;

-- ח. אי אפשר ליצור ברירת מחדל שנייה:
--    מצופה: שגיאת duplicate key על quote_templates_one_default_idx
-- INSERT INTO public.quote_templates (name, is_default, content)
-- VALUES ('בדיקה', true, '{"schema":2,"sections":[]}'::jsonb);

-- ט. ה-CHECK על schema באמת חוסם:
--    מצופה: שגיאת check constraint על quote_templates_schema_is_2
-- INSERT INTO public.quote_templates (name, is_default, content)
-- VALUES ('בדיקה', false, '{"sections":[]}'::jsonb);


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — החזרה מלאה למצב שלפני
--
-- להריץ בסדר הפוך: 6 → 5 → 4 → 3 → 2 → 1.
--
-- ⚠️ DROP TABLE מוחק גם את התבנית וגם את כל הספרייה, כולל כל עריכה
--    שעינב עשתה אחרי ההחלה. לגבות קודם:
--      SELECT content FROM public.quote_templates WHERE is_default;
--      SELECT type, title, payload FROM public.quote_library_items;
--
-- ⚠️ אם כבר נוצרו הצעות v2 — הן לא נמחקות (הן ב-quotes), אבל הן
--    מאבדות את ההפניה לספרייה. זה לא שובר אותן: התוכן כבר הועתק
--    אליהן, ו-libraryId הופך למצביע מת.
--
-- הטריגרים נמחקים יחד עם הטבלאות ואין צורך להסיר אותם בנפרד.
-- ════════════════════════════════════════════════════════════════════════

-- ROLLBACK 6+5+4+3+2 — הטבלאות, הנתונים, המדיניות והאינדקסים.
/*
DROP TABLE IF EXISTS public.quote_library_items;
DROP TABLE IF EXISTS public.quote_templates;
*/

-- ROLLBACK 1 — פונקציות העזר.
-- ⚠️ רק אם שום דבר אחר לא משתמש בהן. אם is_studio_admin כבר אומצה
--    במדיניות של טבלה אחרת — לדלג על השורה הראשונה.
/*
DROP FUNCTION IF EXISTS public.is_studio_admin();
DROP FUNCTION IF EXISTS public.quote_v2_touch_updated_at();
*/
