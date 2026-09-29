// src/components/InlineField.jsx
//
// Label-and-value that turns into an input on demand, and saves on blur.
//
// MOVED VERBATIM out of ProjectDetail.jsx, where it had lived as a local
// function, so the project-settings modal in ProjectsKanban could use the
// same control instead of growing a parallel one. ProjectDetail's own
// behaviour is unchanged: it passes exactly the props it always did, and
// every default here matches what it relied on.
//
// The additions are strictly OPT-IN and inert unless asked for:
//
//   withPencil  — renders a pencil button beside the value and makes the
//                 pencil the ONLY way in. Without it the whole value
//                 stays click-to-edit, which is what ProjectDetail does.
//   renderInput — lets a caller supply its own editor (the settings
//                 modal uses it for the אחראית <select>), so "label +
//                 pencil" can front something other than a text box.
//   displayValue — what the RESTING state shows, when that differs from
//                 the stored value. Needed by any editor whose value is
//                 an id: the אחראית select stores responsible_id but has
//                 to read as the person's name.
//   splitCells  — return the pencil and the value as two SIBLINGS rather
//                 than one wrapped unit, so a grid can place them in
//                 different columns. The settings modal's link rows put
//                 the pencil beside the label and the value over at the
//                 far edge, which is impossible while the two are welded
//                 together. Pencil comes first in DOM order.
//   pencilClassName — class for the pencil button, so the caller can
//                 assign it to a grid column.
//   className / inputClassName — the CSS hooks. They default to
//                 ProjectDetail's original 'pd-field-value' /
//                 'pd-field-input' so nothing there needs touching.
//
// A caller that passes none of these gets byte-for-byte the previous
// behaviour: click the text, edit, blur to save, and a value prop that
// arrives later syncs in.

import { useEffect, useState } from 'react'

function PencilIcon({ size = 13 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export default function InlineField({
  value,
  onSave,
  placeholder = '',
  type = 'text',
  multiline = false,
  readOnly = false,
  /* ── opt-in extras; every one is a no-op when omitted ── */
  withPencil = false,
  renderInput = null,
  displayValue = undefined,
  splitCells = false,
  pencilClassName = '',
  className = 'pd-field-value',
  inputClassName = 'pd-field-input',
  emptyClassName = 'pd-field-empty',
  ariaLabel,
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value ?? '')

  useEffect(() => { setVal(value ?? '') }, [value])

  /* Shared by every editor shape so "blur saves, and only when the value
     actually changed" can't drift between them. */
  const commit = () => {
    setEditing(false)
    if (val !== (value ?? '')) onSave(val)
  }

  if (editing && !readOnly) {
    const props = {
      value: val,
      onChange: e => setVal(e.target.value),
      onBlur: commit,
      autoFocus: true,
      className: inputClassName,
    }
    /* A caller-supplied editor (e.g. a <select>) gets the same contract:
       controlled value, onChange, and blur-to-save. */
    const editor = renderInput
      ? renderInput(props)
      : multiline
        ? <textarea rows={3} {...props} />
        : <input type={type} {...props} />

    /* splitCells means the caller has PLACED the resting value in a slot of
       its own layout — the settings modal pins it to grid column 3 through
       `className`. The editor has to land in that same slot. Returned bare,
       it carries no placement at all, so the grid auto-places it into the
       next free cell — the 26px pencil column — and the field collapses to
       a pill you cannot read what you type in.

       Wrapping it in the value's own class puts the editor exactly where the
       text was. The wrapper rather than the element itself, because a
       caller's renderInput sets its own className on the editor (the
       אחראית and דגם נבחר selects both do) and would silently drop any class
       passed through props.

       justifySelf: 'stretch' as well as width:100%, because the row that
       carries a copy button sizes its value column to CONTENT — and against
       an auto-sized track a percentage width has nothing definite to resolve
       against, so the editor fell back to an <input>'s intrinsic ~20
       characters. Stretching fills the track however it was sized, and it
       also overrides the `justify-self: end` that the LTR rows set. */
    if (splitCells) {
      return (
        <span
          className={className}
          style={{ display: 'block', justifySelf: 'stretch', width: '100%', minWidth: 0 }}
        >
          {editor}
        </span>
      )
    }
    return editor
  }

  /* What the resting row reads as. Falls back to the stored value, so
     a caller that doesn't pass displayValue behaves exactly as before. */
  const shown = displayValue !== undefined ? displayValue : val

  const valueSpan = (
    <span
      className={className + (shown ? '' : ' ' + emptyClassName)}
      /* Click-to-edit stays on the text ONLY when there is no pencil.
         With a pencil, the text is just text and the pencil is the
         affordance — otherwise there would be two overlapping ways in
         and the pencil would be decorative. */
      onClick={withPencil || readOnly ? undefined : () => setEditing(true)}
      style={(readOnly || withPencil) ? { cursor: 'default' } : {}}
    >
      {shown || placeholder}
    </span>
  )

  if (!withPencil) return valueSpan

  const pencilButton = !readOnly ? (
    <button
      type="button"
      className={pencilClassName || undefined}
      onClick={() => setEditing(true)}
      aria-label={ariaLabel ? `עריכת ${ariaLabel}` : 'עריכה'}
      title={ariaLabel ? `עריכת ${ariaLabel}` : 'עריכה'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: 'none', padding: 2, margin: 0,
        color: '#9ca3af', cursor: 'pointer', flexShrink: 0, lineHeight: 1,
      }}
    >
      <PencilIcon />
    </button>
  ) : null

  /* Two siblings, no wrapper — the caller's grid places each in its own
     column. Pencil first so it lands in the action column beside the
     label, with the value further along the row. */
  if (splitCells) {
    return (
      <>
        {pencilButton}
        {valueSpan}
      </>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {valueSpan}
      {pencilButton}
    </span>
  )
}
