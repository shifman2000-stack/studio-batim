// src/components/ActionRequiredBadge.jsx
//
// The visual vocabulary of "דרוש טיפול". Two shapes, one colour:
//
//   · ActionRequiredBadge — a red WhatsApp-style circle (pill for 2+
//     digits) with a white count. Used where a NUMBER is meaningful:
//     tiles and stage headers. Hidden entirely when the count is falsy
//     or ≤ 0.
//   · ActionRequiredDot   — the same red as a bare dot, no number. Used
//     where the item is a single thing that either needs attention or
//     doesn't, so a "1" would be noise.
//
// Neither decides ANYTHING — what counts as needing attention lives in
// src/lib/actionRequired.js. These only draw it.
//
// Consumers position the badge either inline (next to a caption) or
// absolute (top-corner of a tile) by passing `style`. In an RTL layout
// the natural "leading top" corner is the physical top-right, matching
// the WhatsApp / iOS notification convention.

/* The one alert-red used for every דרוש-טיפול affordance. Exported so
   the per-row dot in ClientDocuments reuses this exact value instead of
   re-declaring a hex that could drift from the badge. */
export const ACTION_REQUIRED_RED = '#d9534f'

/* Bare dot, no number — for a single item that needs attention. */
export function ActionRequiredDot({ size = 8, style, label = 'דרוש טיפול' }) {
  return (
    <span
      aria-label={label}
      role="img"
      style={{
        flexShrink:   0,
        width:        size,
        height:       size,
        borderRadius: 999,
        background:   ACTION_REQUIRED_RED,
        display:      'inline-block',
        ...style,
      }}
    />
  )
}

/* `label` exists so the STAFF side can say "3 עדכונים חדשים" instead of
   the client's "3 פריטים הדורשים טיפול" — same shape, same red, same
   component. Added as a prop rather than forking the component, and it
   defaults to the client wording, so every existing call site is
   unchanged. Takes the count so a caller can phrase it however it needs. */
export default function ActionRequiredBadge({ count, size = 'sm', style, label }) {
  if (!count || count <= 0) return null
  const dim = size === 'lg' ? 22 : 18
  const fs  = size === 'lg' ? 13 : 11
  return (
    <span
      aria-label={label ? label(count) : `${count} פריטים הדורשים טיפול`}
      style={{
        display:         'inline-flex',
        alignItems:      'center',
        justifyContent:  'center',
        minWidth:        dim,
        height:          dim,
        padding:         '0 6px',
        borderRadius:    999,
        background:      ACTION_REQUIRED_RED,  /* alert-red, matches the
                                         app's danger tokens elsewhere */
        color:           '#ffffff',
        fontSize:        fs,
        fontWeight:      700,
        lineHeight:      1,
        boxSizing:       'border-box',
        whiteSpace:      'nowrap',
        userSelect:      'none',
        ...style,
      }}
    >
      {count}
    </span>
  )
}
