// src/pages/intro/IntroSketch.jsx
//
// The sketch, reached from the "בחירת סקיצה" stage on the map. Built
// like the VR screen next to it: the intro header above, "חזור" top
// left, and one thing on the paper.
//
// Half the screen tall and never cropped — contain, not cover. A
// sketch is a drawing with edges, and cutting them is cutting the
// drawing.

export default function IntroSketch() {
  return (
    <div className="im-sketch">
      <img src="/intro/sketch-demo.png" alt="סקיצה לדוגמה" />
    </div>
  )
}
