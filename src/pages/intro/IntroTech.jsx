// src/pages/intro/IntroTech.jsx
//
// Area 03 — "טכנולוגיה מתקדמת". Two halves: the client's app on a phone,
// and the VR walk-through.
//
// The phone holds the REAL ClientPortal, mounted the way the admin's
// "תצוגת לקוח" preview mounts it — its own ClientContext instead of a
// client session — over fictional rows (introDemo.jsx). The captions
// beside it name what that portal actually shows this family: the
// progress map, the documents tab, the shared space and the meeting
// summaries. If a tab is ever turned off for the demo project, its line
// here should go with it.
//
// The video is muted + playsInline + loop, which is what lets a browser
// autoplay it at all. The still doubles as the poster, so the first
// frame on screen is a photograph rather than black.

import ClientPortal from '../ClientPortal'
import { ClientContext } from '../../components/ClientRoute'
import { PhoneFrame, useDemoReads, DEMO_PROJECT_ID, DEMO_CLIENT_ID } from './introDemo'

const POINTS = [
  ['מעקב אחרי שלבי הפרויקט', 'מפת ההתקדמות, בכל רגע, בלי להתקשר ולשאול איפה הדברים עומדים'],
  ['מסמכים ותוכניות במקום אחד', 'כל מה שהופק עד היום, פתוח מהטלפון'],
  ['מרחב משותף', 'תמונות השראה והתכתבות — לא נעלם בתוך צ׳אט'],
  ['סיכומי פגישות', 'מה סוכם, שחור על גבי לבן, אחרי כל פגישה'],
]

export default function IntroTech() {
  useDemoReads()

  return (
    <div className="im-two im-two--tech">
      {/* ימין — האפליקציה */}
      <section className="im-panel">
        <h3 className="im-panel-title">אפליקציית הלקוח</h3>
        <div className="im-tech-right">
          <PhoneFrame>
            <ClientContext.Provider
              value={{ id: DEMO_CLIENT_ID, project_id: DEMO_PROJECT_ID, first_name: 'דנה', previewMode: true }}
            >
              <ClientPortal />
            </ClientContext.Provider>
          </PhoneFrame>
          <div className="im-tech-points">
            {POINTS.map(([t, s]) => (
              <div className="im-tech-point" key={t}>
                <b>{t}</b>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* שמאל — VR */}
      <section className="im-panel">
        <h3 className="im-panel-title">משקפי VR</h3>
        {/* צמוד לכותרת, מעל הסרטון. */}
        <p className="im-vr-cap">מסתובבים בבית לפני שהונחה הלבנה הראשונה</p>
        <div className="im-vr">
          {/* ⚠️ muted is not decoration: a browser refuses to autoplay a
              video that can make noise, and this file still carries an
              audio track.
              The poster is the still, and only that — it covers the
              moment before the first frame decodes, and is gone after. */}
          <video
            src="/intro/vr.mp4"
            poster="/intro/vr-studio.jpg"
            autoPlay
            muted
            loop
            playsInline
          />
        </div>
      </section>
    </div>
  )
}
