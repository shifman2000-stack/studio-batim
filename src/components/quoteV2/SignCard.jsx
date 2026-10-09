import { useCallback } from 'react'
import useSignaturePad from '../../hooks/useSignaturePad'
import { isFilled } from '../../lib/quoteV2/resolve'

/* ═══════════════════════════════════════════════════════════════════════
   SignCard — כרטיס החתימה בפן השיווקי

   שני מצבים:
   · בלי client  → תצוגה בלבד (מעבדה). השדות מושבתים, הכפתור מת.
   · עם client   → חתימה אמיתית. המצב כולו חי אצל ההורה (QuoteSignV2),
                   כי אותו אובייקט בדיוק הוא מה שנשלח לשרת.

   כלל השליחה (D.0 במסמך): צ׳קבוקס + כל החותמים חתמו. שני לקוחות →
   שתי חתימות, בדיוק כמו ב-v1.
   ═══════════════════════════════════════════════════════════════════════ */

/* onPatch ולא onChange עם האובייקט המלא: שני פדים ושני שדות שם
   יכולים להתעדכן באותו tick, וכל עדכון שמחושב מ-value של הרינדור
   הקודם היה דורס את אלה שלפניו. העדכון מתמזג אצל ההורה, פונקציונלית. */
function SignerPad({ label, value, onPatch, disabled, placeholder }) {
  const set = useCallback((patch) => onPatch(patch), [onPatch])
  const { canvasRef, inked, clear, handlers } = useSignaturePad({
    onChange: (image) => set({ image }),
  })

  return (
    <div className="qj-signer">
      {label && <div className="qj-signer-label">{label}</div>}

      <div className="qj-row">
        <label>
          שם מלא
          <input
            value={value.name ?? ''}
            disabled={disabled}
            onChange={e => set({ name: e.target.value })}
          />
        </label>
        <label>
          תעודת זהות
          <input
            value={value.idNumber ?? ''}
            inputMode="numeric"
            disabled={disabled}
            onChange={e => set({ idNumber: e.target.value })}
          />
        </label>
      </div>

      <div className="qj-pad">
        {disabled ? (
          <div className="qj-padbox">{placeholder}</div>
        ) : (
          <>
            <canvas ref={canvasRef} className="qj-padcanvas" {...handlers} />
            {!inked && <div className="qj-padph">{placeholder}</div>}
            <button type="button" className="qj-padclear" onClick={clear}>ניקוי</button>
          </>
        )}
      </div>
    </div>
  )
}

export default function SignCard({ section, t, clientCount, clients = [], client }) {
  const live = !!client
  const signatures = client?.response?.signatures ?? []

  const setSignature = (i, patch) => {
    client.setResponse(prev => {
      const cur = prev?.signatures ?? []
      const list = Array.from({ length: clientCount }, (_, k) => cur[k] ?? { clientIndex: k })
      list[i] = { ...list[i], ...patch, clientIndex: i }
      return { ...prev, signatures: list }
    })
  }

  const placeholder = clientCount > 1 ? 'חתמו כאן באצבע' : 'חתום כאן באצבע'
  const consent = !!client?.response?.consentChecked

  /* אותו תנאי בדיוק כמו ב-v1 (QuotePublic.jsx:85), בתוספת הצ׳קבוקס. */
  const allSigned = Array.from({ length: clientCount })
    .every((_, i) => isFilled(signatures[i]?.image) && isFilled(signatures[i]?.name))
  const canSubmit = live && consent && allSigned && !client.submitting && !client.submitted

  if (live && client.submitted) {
    return (
      <section className="qj-sign">
        <div className="qj-card">
          <div className="qj-done">
            <h3>{t(section.doneHeadline)}</h3>
            <p>{t(section.doneBody)}</p>
            {client.signedFileUrl && (
              <a className="qj-donelink" href={client.signedFileUrl} target="_blank" rel="noreferrer">
                ⇣ הורדת ההצעה החתומה
              </a>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="qj-sign">
      <h2 className="qj-serif">{t(section.headline)}</h2>
      <p className="qj-sub">{t(section.subtitle)}</p>

      <div className="qj-card">
        {Array.from({ length: clientCount }).map((_, i) => (
          <SignerPad
            key={i}
            index={i}
            label={clientCount > 1
              ? `חותם ${i + 1}${clients[i]?.firstName ? ' · ' + clients[i].firstName : ''}`
              : null}
            value={signatures[i] ?? {}}
            onPatch={patch => setSignature(i, patch)}
            disabled={!live}
            placeholder={placeholder}
          />
        ))}

        <label className="qj-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={!live}
            onChange={e => client.setResponse(prev => ({ ...prev, consentChecked: e.target.checked }))}
          />
          <span>{t(section.consentLabel)}</span>
        </label>

        <button
          className="qj-go"
          type="button"
          disabled={!canSubmit}
          onClick={() => client?.onSubmit?.()}
        >
          {!live ? 'תצוגה מקדימה — החתימה מושבתת'
            : client.submitting ? 'שולחים…'
              : t(section.ctaLabel) || 'מניחים את הלבנה הראשונה ←'}
        </button>

        {live && !canSubmit && !client.submitting && (
          <div className="qj-why">
            {!allSigned && 'כדי לשלוח צריך למלא שם ולחתום'}
            {allSigned && !consent && 'צריך לסמן שקראתם את ההצעה המלאה'}
          </div>
        )}
        {live && client.error && <div className="qj-why qj-err">{client.error}</div>}

        <div className="qj-legal">{t(section.legal)}</div>
      </div>
    </section>
  )
}
