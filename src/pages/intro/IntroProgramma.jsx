// src/pages/intro/IntroProgramma.jsx
//
// Area 02 — "הפרוגרמה". The questionnaire and the house builder, side by
// side, as the client will meet them at home.
//
// Both are the REAL components, not mock-ups:
//   * ClientProgrammingQuestionnaire, opened straight onto its form via
//     the `initialView` prop (default 'hub' everywhere else, so no other
//     call site changes behaviour).
//   * HouseBuilderV2 standalone. It loads its own configuration through
//     loadHouseBuilderConfig() — the real one from the database; the
//     in-code fallback is only the seed it renders for one frame.
//
// Nothing here can be saved: useDemoReads turns the app-wide write guard
// on for as long as this area is mounted, and off when it goes away.
// HouseBuilderV2's onChange is deliberately dropped on the floor — its
// own state is local, so the demo stays fully interactive while the
// parent stores nothing.

import ClientProgrammingQuestionnaire from '../client/ClientProgrammingQuestionnaire'
import HouseBuilderV2 from '../../components/questionnaire/HouseBuilderV2'
import { PhoneFrame, useDemoReads, DEMO_PROJECT_ID } from './introDemo'

export default function IntroProgramma({ mode }) {
  useDemoReads()

  const panel = (title, body) => (
    <section className="im-panel">
      <h3 className="im-panel-title">{title}</h3>
      {mode === 'phone'
        ? <PhoneFrame>{body}</PhoneFrame>
        : <div className="im-panel-body">{body}</div>}
    </section>
  )

  return (
    <>
      <p className="im-caption">
        את השאלון ואת בונה הבית תקבלו הביתה לקראת פגישת הפרוגרמה
      </p>
      <div className="im-two">
        {panel('שאלון הפרוגרמה', (
          <ClientProgrammingQuestionnaire
            embedded
            embeddedProjectId={DEMO_PROJECT_ID}
            initialView="questionnaire"
          />
        ))}
        {panel('בונה הבית', (
          <HouseBuilderV2 onChange={() => {}} />
        ))}
      </div>
    </>
  )
}

/* The view switch lives here so the header can render it, but the state
   belongs to the screen above — the area is remounted on every entry
   and the choice should survive that within one meeting. */
export function ProgrammaModeSwitch({ mode, onMode }) {
  return (
    <span className="im-seg">
      <button type="button" className={mode === 'wide' ? 'on' : ''}
        onClick={() => onMode('wide')}>🖥 מסך מלא</button>
      <button type="button" className={mode === 'phone' ? 'on' : ''}
        onClick={() => onMode('phone')}>📱 כמו בטלפון</button>
    </span>
  )
}
