import LinkedField from './LinkedField'
import { Card, Faces } from './bits'
import { displayValue } from '../../../lib/quoteV2/linked'

/* 4 · התנאים — קבוצות, ובתוך כל קבוצה פריטים (החלטה 23).

   בראש הסעיף שורה קבועה שמסמנת אותו כמחייב (החלטה 17). כל מה
   שכאן נכנס במלואו להצעה הכתובה, גם כשבטלפון מוצגת תשובה ידידותית. */

export default function SectionTerms({
  groups, vars, nClients, open, readOnly, f,
  onToggle, onGroupTitle, onGroupUp, onGroupDown, onRemoveGroup,
  onAddGroup, onAddTerm, onAddFromLibrary, onRemoveTerm, onTermUp, onTermDown,
}) {
  return (
    <div className="qe-sec">
      <h2>
        <span className="qe-n">4</span>התנאים
        <small>בטלפון הם מופיעים כ״ומה אם…?״</small>
      </h2>
      <div className="qe-note">כל מה שכאן הוא תנאי מחייב, ומופיע במלואו בהצעה הכתובה.</div>

      {groups.map((g, gi) => (
        <div key={g.id}>
          <div className="qe-grp">
            <input
              value={g.title ?? ''}
              disabled={readOnly}
              title="שם הנושא — אפשר לשנות"
              onChange={e => onGroupTitle(g.id, e.target.value)}
            />
            {!readOnly && (
              <>
                <button type="button" className="qe-ic" title="למעלה" disabled={gi === 0} onClick={() => onGroupUp(g.id)}>▲</button>
                <button type="button" className="qe-ic" title="למטה" disabled={gi === groups.length - 1} onClick={() => onGroupDown(g.id)}>▼</button>
                <button type="button" className="qe-ic" title="מחיקת נושא" onClick={() => onRemoveGroup(g)}>🗑</button>
              </>
            )}
          </div>

          {(g.items ?? []).map((it, ii) => {
            const title = displayValue({ raw: it.formalTitle, frozen: f.frozen(it.id, 'formalTitle'), vars, clientCount: nClients })
            const q = displayValue({ raw: it.question, frozen: f.frozen(it.id, 'question'), vars, clientCount: nClients })
            return (
              <Card
                key={it.id}
                num="·"
                title={title || q || 'תנאי'}
                sub={title ? q : ''}
                open={open === it.id}
                readOnly={readOnly}
                canUp={ii > 0}
                canDown={ii < (g.items ?? []).length - 1}
                onToggle={() => onToggle(it.id)}
                onUp={() => onTermUp(it.id)}
                onDown={() => onTermDown(it.id)}
                onRemove={() => onRemoveTerm(it)}
              >
                <Faces
                  marketingTitle="בטלפון — בתור שאלה"
                  written={<>
                    <LinkedField
                      label="כותרת רשמית" disabled={readOnly}
                      hint="רשות. ריק = פסקה בלי תווית מודגשת ב-PDF."
                      {...f.bind(it.id, 'formalTitle', it.formalTitle)}
                    />
                    <LinkedField label="הנוסח המחייב" textarea rows={5} disabled={readOnly}
                      {...f.bind(it.id, 'body', it.body)} />
                  </>}
                  marketing={<>
                    <LinkedField label="השאלה" disabled={readOnly} {...f.bind(it.id, 'question', it.question)} />
                    <LinkedField
                      label="תשובה בשפה פשוטה" textarea rows={4} disabled={readOnly}
                      hint="לא חובה. אם ריק — יוצג הנוסח המחייב."
                      {...f.bind(it.id, 'marketingAnswer', it.marketingAnswer)}
                    />
                  </>}
                />
              </Card>
            )
          })}

          {!readOnly && (
            <div>
              <button type="button" className="qe-addt" onClick={() => onAddTerm(g.id)}>+ תנאי בנושא הזה</button>
              <button type="button" className="qe-addt" onClick={() => onAddFromLibrary(g.id)}>+ מהספרייה</button>
            </div>
          )}
        </div>
      ))}

      {!readOnly && <button type="button" className="qe-add" onClick={onAddGroup}>+ נושא חדש</button>}
    </div>
  )
}
