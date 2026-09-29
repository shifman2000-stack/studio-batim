// src/components/LogoStacked.jsx
//
// The stacked wordmark — title, hairline, subtitle — as real HTML text.
//
// WHY THIS EXISTS. The same mark used to live in src/logo-A-stacked.svg and
// was pulled in with <img src=…>. Two things go wrong that way, and both of
// them only bite on iOS:
//
//   1. BIDI. The Hebrew title was an SVG <text> carrying letter-spacing and
//      direction="rtl". WebKit (iOS Safari, and every in-app browser on the
//      platform — WhatsApp included) reorders spaced RTL runs in SVG text
//      incorrectly, so "סטודיו בתים" painted as "םיתב וידוטס". Blink gets it
//      right, which is why it only ever showed up on a phone. The Latin
//      subtitle is LTR, so it was never affected.
//   2. FONTS. An SVG referenced by <img> renders in a resource-restricted
//      mode: its @import of Google Fonts never loads, so the mark fell back
//      to a system sans everywhere, not just on iOS.
//
// Real HTML text fixes both. The browser applies its normal bidi algorithm
// to a normal text node, and the fonts are the ones the app has already
// loaded through theme.css.
//
// Geometry is taken from the original SVG (viewBox 0 0 380 76) and scaled by
// `height`, so the four screens that used the asset keep the size they had.

const BASE_H = 76          // the source viewBox height
const TITLE_SIZE = 30
const TITLE_TRACKING = 2
const RULE_WIDTH = 260
const SUB_SIZE = 9
const SUB_TRACKING = 4

export default function LogoStacked({ height = BASE_H, style, title = 'סטודיו בתים' }) {
  const k = height / BASE_H

  return (
    <div
      aria-label={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        lineHeight: 1,
        ...style,
      }}
    >
      {/* dir="rtl" on the element that actually holds the Hebrew, so the
          run is reordered by the browser's own bidi pass rather than by
          anything we do to it. */}
      <span
        dir="rtl"
        style={{
          fontFamily: "'Rubik', sans-serif",
          fontWeight: 300,
          fontSize: `${TITLE_SIZE * k}px`,
          letterSpacing: `${TITLE_TRACKING * k}px`,
          color: 'var(--text-primary)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>

      <span
        aria-hidden="true"
        style={{
          width: `${RULE_WIDTH * k}px`,
          height: '1px',
          marginBlock: `${10 * k}px 0`,
          background:
            'linear-gradient(to left, transparent, var(--sand) 25%, var(--sand) 75%, transparent)',
        }}
      />

      <span
        dir="ltr"
        style={{
          fontFamily: "'Heebo', sans-serif",
          fontWeight: 200,
          fontSize: `${SUB_SIZE * k}px`,
          letterSpacing: `${SUB_TRACKING * k}px`,
          color: 'var(--text-secondary)',
          lineHeight: 1,
          marginBlockStart: `${7 * k}px`,
          whiteSpace: 'nowrap',
        }}
      >
        BY EINAV SHIFMAN
      </span>
    </div>
  )
}
