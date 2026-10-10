import LinkedField from './LinkedField'
import { Card, Faces } from './bits'
import { displayValue } from '../../../lib/quoteV2/linked'

/* 3 · השלבים — רשימה מכווצת; פתיחת שלב מראה את שני הפנים זה לצד זה.

   זה המקום היחיד בעורך שבו 📄 ו-📱 מופיעים יחד, כי שם הם באמת
   מתארים את אותו דבר בשתי שפות (C.1). */

export default function SectionStages({
  stages, vars, nClients, open, readOnly, f,
  onToggle, onUp, onDown, onRemove, onAdd, poolOn, onPool,
}) {
  return (
    <div className="qe-sec">
      <h2>
        <span className="qe-n">3</span>השלבים
        <small>{stages.length} שלבים</small>
      </h2>

      {stages.length === 0 && <div className="qe-note">אין עדיין שלבים.</div>}

      {stages.map((s, i) => {
        const name = displayValue({ raw: s.formalName, frozen: f.frozen(s.id, 'formalName'), vars, clientCount: nClients })
        const trig = displayValue({ raw: s.trigger, frozen: f.frozen(s.id, 'trigger'), vars, clientCount: nClients })
        return (
          <Card
            key={s.id}
            num={i + 1}
            title={name}
            sub={`${s.pct ?? 0}%${trig ? ' · ' + trig : ''}`}
            open={open === s.id}
            readOnly={readOnly}
            canUp={i > 0}
            canDown={i < stages.length - 1}
            onToggle={() => onToggle(s.id)}
            onUp={() => onUp(s.id)}
            onDown={() => onDown(s.id)}
            onRemove={() => onRemove(s)}
          >
            <Faces
              written={<>
                <LinkedField label="שם השלב" disabled={readOnly} {...f.bind(s.id, 'formalName', s.formalName)} />
                <LinkedField label="מועד התשלום" disabled={readOnly} {...f.bind(s.id, 'trigger', s.trigger)} />
                <LinkedField label="משך" disabled={readOnly} {...f.bind(s.id, 'duration', s.duration)} />
                <LinkedField label="התהליך" textarea rows={5} disabled={readOnly} {...f.bind(s.id, 'process', s.process)} />
                <LinkedField label="התוצר" textarea rows={3} disabled={readOnly} {...f.bind(s.id, 'output', s.output)} />
              </>}
              marketing={<>
                <LinkedField label="כותרת" disabled={readOnly} {...f.bind(s.id, 'storyTitle', s.storyTitle)} />
                <LinkedField label="מה קורה בשלב" textarea rows={5} disabled={readOnly} {...f.bind(s.id, 'storyBody', s.storyBody)} />
                <LinkedField label="מה תקבלו" textarea rows={3} disabled={readOnly} {...f.bind(s.id, 'storyDeliverable', s.storyDeliverable)} />
                <LinkedField
                  label="שם קצר (בפס התשלומים)" disabled={readOnly}
                  hint="רשות. מילה אחת. אם ריק — יוצג מספר השלב בלבד."
                  {...f.bind(s.id, 'shortLabel', s.shortLabel)}
                />
              </>}
            />
          </Card>
        )
      })}

      {!readOnly && (
        <div className="qe-addrow">
          <button type="button" className="qe-add" onClick={onAdd}>+ הוספת שלב</button>
          <button type="button" className="qe-add" onClick={() => onPool(!poolOn)}>
            {poolOn ? '− בריכה' : '+ בריכה'}
          </button>
        </div>
      )}
      {!readOnly && (
        <div className="qe-note">
          ״בריכה״ מחליפה בלחיצה אחת את תכולת השירות ואת שלבים 1-3 בנוסח שכולל בריכת שחייה, ובחזרה.
          האחוזים שלך נשמרים.
        </div>
      )}
    </div>
  )
}
