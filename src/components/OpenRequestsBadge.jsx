// src/components/OpenRequestsBadge.jsx
//
// Small red WhatsApp-style badge — a circle (or pill for 2+ digits)
// with a white number. Hidden entirely when count is falsy or ≤ 0.
//
// Consumers position it either inline (next to a caption) or absolute
// (top-corner of a tile) by passing `style`. In an RTL layout the
// natural "leading top" corner is the physical top-right, matching the
// WhatsApp / iOS notification convention.

/* The one alert-red used for open-request affordances. Exported so
   the per-row dot in ClientDocuments reuses this exact value instead
   of re-declaring a hex that could drift from the badge. */
export const OPEN_REQUEST_RED = '#d9534f'

export default function OpenRequestsBadge({ count, size = 'sm', style }) {
  if (!count || count <= 0) return null
  const dim = size === 'lg' ? 22 : 18
  const fs  = size === 'lg' ? 13 : 11
  return (
    <span
      aria-label={`${count} בקשות פתוחות`}
      style={{
        display:         'inline-flex',
        alignItems:      'center',
        justifyContent:  'center',
        minWidth:        dim,
        height:          dim,
        padding:         '0 6px',
        borderRadius:    999,
        background:      OPEN_REQUEST_RED,  /* alert-red, matches the
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
