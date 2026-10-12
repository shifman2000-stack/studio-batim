// src/components/gantt/blockArt.jsx
//
// THE isometric block, and nothing else — the shadow, the three faces, and
// the four hollow cells with their lips and grain edges.
//
// Lifted verbatim out of ClientProgressJourney.jsx when the staff "שלבי
// התקדמות" screen (ProjectGantt) adopted the same drawing. One file, so a
// change to the block is a change to BOTH screens and the two can never
// drift into looking like cousins.
//
// Colour is NOT here: it comes from the .cpj-block--<status> class on a
// wrapping <g>, defined in ClientProgressJourney.css, which both screens
// import. Size is not here either — the map and the staff grid each place
// and scale the drawing in their own units.

/* The drawing, in its own units: the faces span x ∓18 and y −9…17, and the
   shadow reaches x 19 / y 19. */
export function BlockDrawing() {
  const project = (u, v) => [-18 + 26 * u + 10 * v, -2 - 7 * u + 8 * v]
  const pts = (arr) => arr.map(p => p.join(',')).join(' ')

  const cells = []
  for (const [u0, u1] of [[0.10, 0.44], [0.56, 0.90]]) {
    for (const [v0, v1] of [[0.13, 0.43], [0.57, 0.87]]) {
      const a = project(u0, v0), b = project(u1, v0)
      const c = project(u1, v1), d = project(u0, v1)
      cells.push({ a, b, c, d })
    }
  }

  return (
    <>
      <ellipse className="cpj-shadow" cx={1} cy={17} rx={18} ry={2} />
      <polygon className="cpj-face cpj-face--side"  points="-18,-2 -8,6 -8,17 -18,9" />
      <polygon className="cpj-face cpj-face--front" points="-8,6 18,-1 18,10 -8,17" />
      <polygon className="cpj-face cpj-face--top"   points="-18,-2 8,-9 18,-1 -8,6" />
      {cells.map(({ a, b, c, d }, i) => (
        <g key={i}>
          <polygon className="cpj-cell"      points={pts([a, b, c, d])} />
          <polygon className="cpj-cell-lip"  points={pts([a, b, [b[0], b[1] + 1.25], [a[0], a[1] + 1.25]])} />
          <path    className="cpj-cell-edge" d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}`} fill="none" />
        </g>
      ))}
    </>
  )
}

/* Legend swatch: the same block, seen smaller. The viewBox is the drawing's
   FULL extent, so nothing is cropped and the proportions are the map's
   exactly. Size comes from the SVG's CSS box alone, which takes the strokes
   down with it. */
export function MiniBlock({ status }) {
  return (
    <svg className="cpj-mini" viewBox="-19 -10 38 30" aria-hidden="true" focusable="false">
      <g className={`cpj-block--${status}`}><BlockDrawing /></g>
    </svg>
  )
}
