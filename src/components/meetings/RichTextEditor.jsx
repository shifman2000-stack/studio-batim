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

export default function RichTextEditor({ value, onChange, placeholder }) {
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
       contenteditable root (ProseMirror). */
    editorProps: {
      attributes: {
        class: 'rte-content',
        dir: 'rtl',
        spellCheck: 'false',
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

  return (
    <div className="rte-root" dir="rtl">
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
      </div>

      <EditorContent editor={editor} placeholder={placeholder} />
    </div>
  )
}
