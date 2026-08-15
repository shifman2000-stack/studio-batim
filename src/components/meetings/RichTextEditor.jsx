// src/components/meetings/RichTextEditor.jsx
//
// Minimal WYSIWYG editor used for meeting summaries. Built on TipTap +
// StarterKit, but the user-facing toolbar is intentionally limited to
// two actions: Bold and Ordered (numbered) list. StarterKit's other
// extensions (italic, headings, bullet list, etc.) remain available
// internally — they're just not exposed in the toolbar — so pasted
// content with those marks won't be stripped.
//
// Storage format: HTML (editor.getHTML()). Saved verbatim into the
// existing text column. RTL is forced on the editable surface so
// Hebrew lists render with markers on the visual right.

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'

/* ── hasRichText — THE single definition of "this field has content".
   TipTap never returns a truly empty string: an untouched editor
   serialises to "<p></p>", and one the user typed into and cleared can
   leave "<p><br></p>" or a stray &nbsp;. A naive `html && html.trim()`
   therefore reads every opened-but-unused editor as non-empty, which
   is exactly how the has_* flags would get written as true for a field
   the user never filled in.

   Strips tags and HTML entities that render as blank, then asks
   whether anything is left. Used for ALL of: computing has_client_tasks
   / has_studio_tasks on save, auto-opening a section on edit, the
   button's has-content dot, and whether a section renders in the two
   read views. Do not re-implement this check inline anywhere. */
export function hasRichText(html) {
  if (typeof html !== 'string' || html === '') return false
  const text = html
    /* Entities that are visually blank. */
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#xa0;/gi, ' ')
    /* Any tag — <p>, <br>, list scaffolding, formatting marks. */
    .replace(/<[^>]*>/g, '')
    /* Unicode whitespace incl. NBSP / zero-width. */
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]+/g, '')
  return text.length > 0
}

export default function RichTextEditor({ value, onChange, placeholder, ariaLabel }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        /* Heading control isn't exposed in our toolbar; bullet list is
           a built-in extension still available to paste-handling, but
           keeps it from being applied accidentally — no UI for it. */
      }),
    ],
    content: value || '',
    /* RTL + cream surface styling. attributes go straight onto the
       contenteditable root (ProseMirror).

       `data-placeholder` feeds the CSS-only placeholder (see
       .rte-root--empty in MeetingSummariesTab.css). The official
       @tiptap/extension-placeholder isn't installed, and adding a
       dependency for one hint would be overkill — the attribute plus
       an ::before on the empty state does the same job.

       `aria-label` keeps the surface announced now that its visible
       label has been removed from the form. */
    editorProps: {
      attributes: {
        class: 'rte-content',
        dir: 'rtl',
        spellCheck: 'false',
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
        ...(ariaLabel   ? { 'aria-label': ariaLabel }         : {}),
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  /* Keep external `value` in sync when the parent swaps cards or
     resets. Only setContent if the editor's current HTML actually
     differs (avoids cursor jumps on every keystroke). */
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const incoming = value || ''
    if (incoming !== current) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  if (!editor) return null

  const isBold        = editor.isActive('bold')
  const isOrderedList = editor.isActive('orderedList')
  const isBulletList  = editor.isActive('bulletList')

  return (
    /* --empty drives the placeholder hint. `editor.isEmpty` is read at
       render time; useEditor re-renders this component on every
       transaction, so it flips as soon as the user types or clears. */
    <div
      className={'rte-root' + (editor.isEmpty ? ' rte-root--empty' : '')}
      dir="rtl"
    >
      <div className="rte-toolbar">
        <button
          type="button"
          className={'rte-tool-btn' + (isBold ? ' rte-tool-btn--active' : '')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="מודגש (Ctrl+B)"
          aria-pressed={isBold}
        >
          <span style={{ fontWeight: 800 }}>B</span>
          <span className="rte-tool-label">מודגש</span>
        </button>
        <button
          type="button"
          className={'rte-tool-btn' + (isOrderedList ? ' rte-tool-btn--active' : '')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="רשימה ממוספרת"
          aria-pressed={isOrderedList}
        >
          <span style={{ fontWeight: 600 }}>1.</span>
          <span className="rte-tool-label">רשימה ממוספרת</span>
        </button>
        <button
          type="button"
          className={'rte-tool-btn' + (isBulletList ? ' rte-tool-btn--active' : '')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="רשימה (כוכביות)"
          aria-pressed={isBulletList}
        >
          <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1 }}>*</span>
          <span className="rte-tool-label">רשימה</span>
        </button>
      </div>

      {/* `placeholder` is applied via the data-placeholder attribute
          above, not here — EditorContent has no placeholder prop. */}
      <EditorContent editor={editor} />
    </div>
  )
}
