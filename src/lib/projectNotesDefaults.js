// src/lib/projectNotesDefaults.js
//
// Single source of truth for the three project-level "general notes"
// defaults that the manager tabs auto-seed into the DB on first load.
// Importing from one place keeps the manager tab, the client mirror
// screen, and any PDF/print views in sync.

export const DEFAULT_QUANTITIES_NOTES = `* יש לרשום ברשימה בסעיפים חיפוי/ריצוף גודל אריח סופי וצבע

* תיאום מועד הזמנה מול הקבלן

* על הקבלן לוודא כמויות סופיות בשטח למניעת חוסרים/עודפים

* על הלקוח והקבלן להיות בשטח בזמן ההספקה

* כמויות חיפוי בחדרים רטובים יישתנו בהתאם לתכנון החיפוי בחדרים אלה

* כמויות אינן כוללות פחת`

export const DEFAULT_FINISHING_NOTES = 'באחריות הלקוח לוודא כמויות סופיות בשטח למניעת חוסרים/עודפים'

export const DEFAULT_CONTRACTOR_SPEC_NOTES = '* באחריות הקבלן לוודא כמויות סופיות בשטח למניעת חוסרים/עודפים'
