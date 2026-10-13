// src/pages/intro/IntroVr.jsx
//
// The VR walk-through, on its own. Reached from the "תלת מימד" stage on
// the map — which is exactly where it belongs in the story.
//
// The video is muted + playsInline + loop, which is what lets a browser
// autoplay it at all; the still is its poster, covering the moment
// before the first frame decodes. object-fit is contain: this is the
// only thing on the screen and it is meant to be seen whole.

export default function IntroVr() {
  return (
    <div className="im-vr-only">
      <p className="im-vr-cap">מסתובבים בבית לפני שהונחה הלבנה הראשונה</p>
      <div className="im-vr">
        <video src="/intro/vr.mp4" poster="/intro/vr-studio.jpg"
          autoPlay muted loop playsInline />
      </div>
    </div>
  )
}
