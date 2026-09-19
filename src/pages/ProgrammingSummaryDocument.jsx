// src/pages/ProgrammingSummaryDocument.jsx
//
// Draws the read-only "סיכום פרוגרמה" document from the plain description
// built by lib/programmingSummary.js. It decides nothing — every label,
// value and "unanswered" call is already made by the model.
//
// ── DENSE BY DESIGN ───────────────────────────────────────────────────────
// Maximum information per screen. Every row is ONE line (.ps-line): a person,
// a "label: value" answer, a group of short answers joined by " · ", a room.
// A short value never gets a line of its own, and unanswered fields are named
// once, in a single muted line at the end of their chapter. The only
// headings are the page title and the chapter titles; chapters flow in two
// columns on wide screens.
//
// ── IT IS A DOCUMENT ──────────────────────────────────────────────────────
// No buttons, inputs, selects, textareas, contenteditable, canvas or house
// drawing. The only interactive elements are the inspiration thumbnails,
// which open the image in a new tab.
//
// ── RTL ───────────────────────────────────────────────────────────────────
// The page is right-to-left. Spacing uses logical properties throughout
// (see ProgrammingSummary.css). Free text uses unicode-bidi: plaintext so a
// run typed in Latin script keeps its own direction. File names follow the
// documents table: the extension once as a chip, stripped from the name, so
// "plan.pdf" does not render as "pdf.plan".

import { Fragment } from 'react'
import { getFileExtension } from '../components/documents/filePreview'
import {
  UNANSWERED_LIST_LABEL,
  NOTHING_ANSWERED_LABEL,
  PERSON_EMPTY_LABEL,
  UNANSWERED_MARK,
} from '../lib/programmingSummary'
import '../styles/appScroll.css'
import './ProgrammingSummary.css'

/* Display-only: drop a trailing extension, because the chip beside the name
   already says it. Semantics copied deliberately from DocumentsTab's
   stripExtension (module-local there, so it cannot be imported), exactly as
   ContractorDocuments already does:
     · no dot at all          → unchanged  ("plan")
     · dot only at position 0 → unchanged  (".gitignore")
     · dot at the very end    → unchanged  ("plan.")
     · dots inside the name   → only the LAST segment goes
   Never touches the stored name; the full name stays in the title. */
function stripExtension(name) {
  if (!name) return name
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return name
  return name.slice(0, dot)
}

const Muted = ({ children }) => <span className="ps-muted">{children}</span>

/* "label: value · label: value" — a dash for an unanswered value. */
function Pairs({ items }) {
  return (
    <p className="ps-line">
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="ps-sep" aria-hidden="true"> · </span>}
          <span className="ps-label">{it.label}:</span>{' '}
          {it.value === null ? <Muted>{UNANSWERED_MARK}</Muted> : <span className="ps-text">{it.value}</span>}
        </Fragment>
      ))}
    </p>
  )
}

/* A room on one line, then its nested rooms indented one step each. */
function RoomLines({ room, depth }) {
  const hasTail = room.extras.length > 0 || room.note
  return (
    <>
      <p className="ps-line ps-room" style={{ '--ps-depth': depth }}>
        {depth > 0 && <span className="ps-nest" aria-hidden="true">↳ </span>}
        {room.label !== null
          ? <span className="ps-room-name">{room.label}</span>
          : <Muted>{UNANSWERED_MARK}</Muted>}
        {room.size && <span className="ps-size"> ({room.size})</span>}
        {hasTail && <span className="ps-sep"> — </span>}
        {room.extras.length > 0 && <span className="ps-text">{room.extras.join(', ')}</span>}
        {room.note && (
          <span className="ps-muted ps-text">{room.extras.length > 0 ? ', ' : ''}{room.note}</span>
        )}
      </p>
      {room.children.map((child, i) => <RoomLines key={i} room={child} depth={depth + 1} />)}
    </>
  )
}

function Block({ block }) {
  switch (block.kind) {
    case 'person':
      return (
        <p className="ps-line">
          {block.named
            ? <>
                <span className="ps-name">{block.parts[0]}</span>
                {block.parts.length > 1 && <span className="ps-text">, {block.parts.slice(1).join(', ')}</span>}
              </>
            : <span className="ps-text">{block.parts.join(', ')}</span>}
          {block.empty && <Muted> — {PERSON_EMPTY_LABEL}</Muted>}
        </p>
      )

    case 'inline':
      return (
        <p className="ps-line">
          <span className="ps-label">{block.label}:</span>{' '}
          <span className={block.multiline ? 'ps-text ps-multiline' : 'ps-text'}>{block.text}</span>
        </p>
      )

    case 'orphans':
      return (
        <p className="ps-line ps-muted">
          {block.label}:{' '}
          <span className="ps-text">
            {block.entries.map(e => `${e.name ?? UNANSWERED_MARK} — ${e.parts.join(', ')}`).join('; ')}
          </span>
        </p>
      )

    case 'pairs':
      return <Pairs items={block.items} />

    case 'floor':
      return (
        <div className="ps-floor">
          {/* The floor's name starts its block as an inline label, not a
              heading. */}
          <p className="ps-line"><span className="ps-floor-label">{block.label}</span></p>
          {block.rooms.map((room, i) => <RoomLines key={i} room={room} depth={0} />)}
        </div>
      )

    case 'images':
      return (
        <div className="ps-images">
          {block.images.map((img, i) => (
            <div key={i} className="ps-image">
              {img.url && (
                <a
                  className="ps-thumb"
                  href={img.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={img.fileName || undefined}
                >
                  <img src={img.url} alt={img.fileName || ''} loading="lazy" />
                </a>
              )}
              {img.fileName && (
                <div className="ps-file" title={img.fileName}>
                  <span className="ps-file-ext">{getFileExtension({ file_name: img.fileName, file_url: img.url })}</span>
                  <span className="ps-file-name">{stripExtension(img.fileName)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )

    default:
      return null
  }
}

function Chapter({ chapter }) {
  return (
    <section className="ps-chapter">
      <h2 className="ps-chapter-title">{chapter.title}</h2>
      {chapter.nothingAnswered ? (
        <p className="ps-line ps-muted">{chapter.emptyText || NOTHING_ANSWERED_LABEL}</p>
      ) : (
        <>
          {chapter.blocks.map((block, i) => <Block key={i} block={block} />)}
          {chapter.unanswered.length > 0 && (
            <p className="ps-line ps-muted ps-unanswered">
              {UNANSWERED_LIST_LABEL}: {chapter.unanswered.join(', ')}
            </p>
          )}
        </>
      )}
      {chapter.footnote && <p className="ps-line ps-muted ps-footnote">{chapter.footnote}</p>}
    </section>
  )
}

export default function ProgrammingSummaryDocument({ model }) {
  return (
    <div className="app-scroll-page ps-page">
      <article className="ps-doc" dir="rtl" lang="he">
        <header className="ps-header">
          <p className="ps-eyebrow">{model.title}</p>
          <h1 className="ps-title">{model.projectName}</h1>
          <Pairs items={model.meta} />
        </header>

        <div className="ps-chapters">
          {model.chapters.map(chapter => <Chapter key={chapter.key} chapter={chapter} />)}
        </div>
      </article>
    </div>
  )
}
