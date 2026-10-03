-- ════════════════════════════════════════════════════════════════════════
-- PHASE 0 — תיקוני הצעות מחיר קיימים
-- ענף: fix/quote-phase0 · בסיס: master @ 0e3e357
--
-- ⚠️ וודאי שאת מול הסביבה הנכונה ב-Supabase (Dev / Prod) לפני הרצת הפקודה.
--
-- להריץ קודם ב-Dev. רק אחרי שהבדיקות עוברות — ב-Prod, ורק עם הקוד
-- של הענף הזה כבר בייצור (או במקביל אליו).
--
-- הקובץ אינו מוחל על ידי קלוד. אני לא מריץ כאן כלום.
--
-- סדר הרצה: 1 → 2 → 3. שלושתן עצמאיות, אבל 3 חייבת לרוץ אחרי 2
-- כדי שה-GRANT יחול על הפונקציה החדשה ולא על הישנה.
-- ════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────
-- 1. עמודת ראיות החתימה
--
-- מוסיפה עמודת jsonb ל-quote_versions שבה ייכתבו, בזמן החתימה: חותמת זמן
-- של השרת, כתובת IP, User-Agent, ה-SHA-256 של ה-PDF החתום, והאם סומן
-- צ׳קבוקס התנאים. העמודה מתווספת כ-NULL, ולכן 15 השורות הקיימות אינן
-- משתנות ואינן נוגעות — NULL פירושו "לא נרשמו ראיות", וזה בדיוק המצב.
--
-- ⚠️ העמודה לא נחשפת ללקוח: get_quote_by_token מחזיר רשימת עמודות
-- מפורשת שאינה כוללת אותה, ולכן הוספתה אינה מרחיבה את מה שה-anon רואה.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS signature_evidence jsonb;

COMMENT ON COLUMN public.quote_versions.signature_evidence IS
  'ראיות חתימה שנרשמות ע״י api/finalize-quote: serverSignedAt, ip, userAgent, pdfSha256, pdfBytes, consentChecked, schema. NULL = לא נרשמו (כל השורות שנחתמו לפני phase 0).';


-- ────────────────────────────────────────────────────────────────────────
-- 2. צמצום get_quote_for_print לשדות שבאמת בשימוש
--
-- הפונקציה הקיימת היא SECURITY DEFINER עם EXECUTE ל-anon, והיא מחזירה
-- to_jsonb(i.*) — כלומר את *כל* שורת הפנייה: טלפון, מייל, הערות, תקציב,
-- סטטוס שאלון וכל השאר. מזהה ההצעה הוא UUID רגיל ולא טוקן סודי, ולכן כל
-- מי שמשיג אותו קורא את הפנייה המלאה בלי להזדהות.
--
-- הגרסה החדשה מחזירה אך ורק את שמונת השדות ש-QuotePrintView משתמש בהם
-- בפועל (דרך buildInitialData ב-QuotePreview.jsx:38-62), ומההצעה — רק
-- draft_content. החתימה, שמות העמודות המוחזרות וצורת ה-JSON נשמרות
-- במדויק, ולכן אתר הקריאה ב-QuotePrintView.jsx:22 אינו משתנה.
--
-- CASE על i.id משמר התנהגות קיימת: ב-LEFT JOIN בלי התאמה, to_jsonb(i.*)
-- החזיר NULL, ו-QuotePrintView בודק `if (!quote || !inq)`. בלי ה-CASE,
-- jsonb_build_object היה מחזיר אובייקט מלא ב-NULL-ים — אובייקט אמיתי
-- שהבדיקה לא הייתה תופסת, וההצעה הייתה מרונדרת בלי פרטי לקוח במקום
-- להציג שגיאה.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quote_for_print(p_quote_id uuid)
RETURNS TABLE(quote jsonb, inquiry jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    jsonb_build_object(
      'draft_content', q.draft_content
    ) AS quote,
    CASE WHEN i.id IS NULL THEN NULL::jsonb ELSE
      jsonb_build_object(
        'first_name',     i.first_name,
        'last_name',      i.last_name,
        'phone',          i.phone,
        'email',          i.email,
        'contact2_name',  i.contact2_name,
        'contact2_phone', i.contact2_phone,
        'contact2_email', i.contact2_email,
        'city',           i.city
      )
    END AS inquiry
  FROM quotes q
  LEFT JOIN inquiries i ON i.id = q.inquiry_id
  WHERE q.id = p_quote_id;
$function$;


-- ────────────────────────────────────────────────────────────────────────
-- 3. הרשאות הריצה על הפונקציה החדשה
--
-- CREATE OR REPLACE שומר על ההרשאות הקיימות, אבל מצהירים עליהן במפורש
-- כדי שלא יהיה תלוי במצב קודם. anon נחוץ כי Puppeteer ניגש למסלול
-- /quote-print/:quoteId בלי הזדהות.
-- ────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_quote_for_print(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quote_for_print(uuid) TO anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════
-- בדיקות שפיות — להריץ אחרי 1-3. קריאה בלבד, לא משנות דבר.
-- ════════════════════════════════════════════════════════════════════════

-- א. העמודה נוספה וכל השורות הקיימות NULL:
--    מצופה: total = 15 (ב-Prod), with_evidence = 0
-- SELECT count(*) AS total,
--        count(signature_evidence) AS with_evidence
-- FROM public.quote_versions;

-- ב. הפונקציה מחזירה בדיוק 8 שדות פנייה ושדה הצעה אחד:
--    מצופה: inquiry_keys = 8, quote_keys = 1
-- SELECT jsonb_object_keys(inquiry) FROM public.get_quote_for_print(
--   (SELECT id FROM public.quotes ORDER BY created_at DESC LIMIT 1));

-- ג. אין יותר דליפה — השדות הרגישים נעלמו:
--    מצופה: 0 שורות
-- SELECT k FROM public.get_quote_for_print(
--          (SELECT id FROM public.quotes ORDER BY created_at DESC LIMIT 1)),
--        LATERAL jsonb_object_keys(inquiry) k
-- WHERE k IN ('notes','project_description','extra_notes','form_token',
--             'questionnaire_status','proposal_status','meeting_date','source');

-- ד. הצעה שאין לה פנייה מחזירה inquiry = NULL ולא אובייקט ריק:
--    (רק אם קיימת כזו; אם אין — לדלג)
-- SELECT (inquiry IS NULL) AS inquiry_is_null
-- FROM public.get_quote_for_print(
--   (SELECT id FROM public.quotes WHERE inquiry_id IS NULL LIMIT 1));


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — החזרה למצב שלפני
--
-- להריץ בסדר הפוך: 3 → 2 → 1.
-- ⚠️ שלב 1 של ה-rollback מוחק את עמודת הראיות ואת כל מה שנרשם בה.
--    אם כבר נחתמו הצעות אחרי ההחלה — הראיות שלהן יאבדו. לגבות קודם:
--    SELECT id, signature_evidence FROM public.quote_versions
--    WHERE signature_evidence IS NOT NULL;
-- ════════════════════════════════════════════════════════════════════════

-- ROLLBACK 3+2. החזרת הפונקציה לנוסח המקורי, מילה במילה.
/*
CREATE OR REPLACE FUNCTION public.get_quote_for_print(p_quote_id uuid)
RETURNS TABLE(quote jsonb, inquiry jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    to_jsonb(q.*) AS quote,
    to_jsonb(i.*) AS inquiry
  FROM quotes q
  LEFT JOIN inquiries i ON i.id = q.inquiry_id
  WHERE q.id = p_quote_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_quote_for_print(uuid) TO anon, authenticated, service_role;
*/

-- ROLLBACK 1. הסרת עמודת הראיות.
/*
ALTER TABLE public.quote_versions
  DROP COLUMN IF EXISTS signature_evidence;
*/
