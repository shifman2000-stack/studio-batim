-- docs/sql/template-plural-only.sql
--
-- מעבר התבנית לנוסח ברבים בלבד.
--
-- מה זה עושה: בתבנית ברירת המחדל, כל {יחיד|רבים} מוחלף בצד
-- הרבים. "{בוא|בואו} נבנה" → "בואו נבנה".
--
-- ⚠️ להריץ ב-DEV קודם, ואז ב-PROD. להריץ **פעם אחת**; הרצה
-- שנייה אינה מזיקה (אין יותר חלופות להחליף) אבל תיצור גיבוי
-- מיותר.
--
-- ⚠️ מה הסקריפט הזה **לא** נוגע בו:
--   · {{משתנה}}  — הביטוי הרגולרי אוסר { } | בתוך החלופה, ולכן
--     {{firstNames}} לעולם אינו נתפס בו.
--   · [[קטע מותנה]] — סוגריים מרובעים, לא מסולסלים.
--   · הצעות קיימות (quotes.draft_content, quote_versions.content)
--     — הן קפואות ונשארות בדיוק כפי שהן. ה-resolver ממשיך לתמוך
--     ב-{יחיד|רבים}, ולכן כל הצעה שנשלחה או נחתמה תרנדר כמו קודם.
--   · גיבויים קודמים (is_default = false).
--
-- אחרי ההרצה: הצעה חדשה ללקוח יחיד מומרת ליחיד על ידי
-- api/quote-singularize בעת יצירתה.

begin;

-- ── 1. גיבוי של התבנית הנוכחית ─────────────────────────────────
insert into public.quote_templates (name, is_default, content)
select 'גיבוי · לפני מעבר לרבים', false, content
from public.quote_templates
where is_default = true;

-- ── 2. ההחלפה ──────────────────────────────────────────────────
-- ⚠️ regexp_replace על הייצוג הטקסטואלי של ה-jsonb, ואז חזרה
-- ל-jsonb. זו הדרך היחידה להגיע לכל שדה בעץ בלי לפרק ולהרכיב
-- אותו ידנית, והיא בטוחה כאן כי התבנית היא טקסט בלבד: אין בה
-- מפתח או ערך שמכיל { } | מחוץ לתחביר שלנו.
--
-- הביטוי: { ואז צד יחיד בלי { } | , ואז | , ואז צד רבים בלי
-- { } | , ואז }. הדגל 'g' מחליף את כולם.
-- ‎\2 הוא צד הרבים.
update public.quote_templates
set content = regexp_replace(
      content::text,
      '\{([^{}|]*)\|([^{}|]*)\}',
      '\2',
      'g'
    )::jsonb,
    updated_at = now()
where is_default = true;

commit;

-- ── 3. אימות: חייב להחזיר 0 ────────────────────────────────────
-- כמה חלופות נשארו בתבנית ברירת המחדל.
select count(*) as alternates_left
from public.quote_templates
where is_default = true
  and content::text ~ '\{[^{}|]*\|[^{}|]*\}';

-- ── 4. אימות נגדי: המשתנים והקטעים המותנים שרדו ────────────────
-- שתי השורות האלה צריכות להחזיר את אותם מספרים כמו לפני ההרצה.
-- ההשוואה היא מול הגיבוי שנוצר בשלב 1.
select
  (select count(*) from regexp_matches(d.content::text, '\{\{\w+\}\}', 'g')) as vars_after,
  (select count(*) from regexp_matches(b.content::text, '\{\{\w+\}\}', 'g')) as vars_before,
  (select count(*) from regexp_matches(d.content::text, '\[\[[^\[\]]*\]\]', 'g')) as optionals_after,
  (select count(*) from regexp_matches(b.content::text, '\[\[[^\[\]]*\]\]', 'g')) as optionals_before
from
  (select content from public.quote_templates where is_default = true) d,
  (select content from public.quote_templates
    where is_default = false and name = 'גיבוי · לפני מעבר לרבים'
    order by updated_at desc limit 1) b;
