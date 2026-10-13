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
    <div className="im-two">
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
        <div className="im-vr">
          <video
            src="/intro/vr.mp4"
            poster="/intro/vr-studio.jpg"
            autoPlay
            muted
            loop
            playsInline
            /* ⚠️ muted is not decoration: a browser refuses to autoplay a
               video that can make noise, and this file still carries an
               audio track. */
          />
          <p className="im-vr-cap">מסתובבים בבית לפני שהונחה הלבנה הראשונה</p>
          <img className="im-vr-still" src="/intro/vr-studio.jpg" alt="" />
        </div>
      </section>
    </div>
  )
}
