// src/pages/ProgrammingSummaryDocument.jsx
//
// Draws the read-only "סיכום פרוגרמה" document from the plain description
// built by lib/programmingSummary.js. It decides nothing — every label,
// value and "unanswered" call is already made by the model.
//
// ── IT IS A DOCUMENT ──────────────────────────────────────────────────────
// No buttons, inputs, selects, textareas, contenteditable, canvas or house
// drawing. The only interactive elements are the inspiration thumbnails,
// which open the image in a new tab. Safe to hand to someone who will only
// read it.
//
// ── RTL ───────────────────────────────────────────────────────────────────
// The page is right-to-left. Spacing uses logical properties throughout
// (see ProgrammingSummary.css). Free-text answers use unicode-bidi:
// plaintext so a line typed in Latin script — a link, an English word —
// keeps its own direction instead of being reordered by the Hebrew around
// it. File names follow the documents table: the extension is shown once as
// a chip and stripped from the name, which stops "plan.pdf" rendering as
// "pdf.plan".

import { getFileExtension } from '../components/documents/filePreview'
import { UNANSWERED_LABEL, CLIENTS_LABEL, UPDATED_LABEL } from '../lib/programmingSummary'
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

function Unanswered() {
  return <span className="ps-unanswered">{UNANSWERED_LABEL}</span>
}

/* A labelled answer: the label on its own line, then the answer. */
function Field({ label, value }) {
  return (
    <div className="ps-field">
      <div className="ps-field-label">{label}</div>
      <div className="ps-field-value">
        {value === null ? <Unanswered /> : <span className="ps-text">{value}</span>}
      </div>
    </div>
  )
}

function Person({ person }) {
  return (
    <div className="ps-person">
      <h3 className="ps-person-name">
        {person.name !== null
          ? <span className="ps-text">{person.name}</span>
          : <>{person.nameLabel}: <Unanswered /></>}
      </h3>
      {person.fields.map((f, i) => <Field key={i} label={f.label} value={f.value} />)}
    </div>
  )
}

function Orphans({ item }) {
  return (
    <div className="ps-orphans">
      <h3 className="ps-subheading">{item.heading}</h3>
      {item.entries.map((entry, i) => (
        <div key={i} className="ps-person">
          <h4 className="ps-person-name">
            {entry.name !== null ? <span className="ps-text">{entry.name}</span> : <Unanswered />}
          </h4>
          {entry.fields.map((f, j) => <Field key={j} label={f.label} value={f.value} />)}
        </div>
      ))}
    </div>
  )
}

function ChapterItem({ item }) {
  if (item.kind === 'person')  return <Person person={item} />
  if (item.kind === 'orphans') return <Orphans item={item} />
  return <Field label={item.label} value={item.value} />
}

/* One inline line in the house section: "label: value". */
function Line({ label, value }) {
  return (
    <p className="ps-line">
      <span className="ps-line-label">{label}:</span>{' '}
      {value === null ? <Unanswered /> : <span className="ps-text">{value}</span>}
    </p>
  )
}

/* A room and, recursively, the rooms nested inside it. */
function Room({ room }) {
  return (
    <li className="ps-room">
      <div className="ps-room-name">
        {room.label !== null ? <span className="ps-text">{room.label}</span> : <Unanswered />}
      </div>
      {room.details.length > 0 && (
        <ul className="ps-room-details">
          {room.details.map((d, i) => (
            <li key={i}>
              {d.label && <span className="ps-detail-label">{d.label}:</span>}
              {d.label && ' '}
              <span className={d.multiline ? 'ps-text ps-text--multiline' : 'ps-text'}>{d.value}</span>
            </li>
          ))}
        </ul>
      )}
      {room.children.length > 0 && (
        <ul className="ps-rooms ps-rooms--nested">
          {room.children.map((child, i) => <Room key={i} room={child} />)}
        </ul>
      )}
    </li>
  )
}

function HouseSection({ house }) {
  return (
    <section className="ps-chapter">
      <h2 className="ps-chapter-title">{house.title}</h2>
      {house.empty ? (
        /* Nothing from the builder at all: the one line, and nothing else. */
        <p className="ps-empty ps-unanswered">{house.emptyText}</p>
      ) : (
        <>
          {house.lines.map((l, i) => <Line key={i} label={l.label} value={l.value} />)}
          {house.areas.map(area => (
            <div key={area.key} className="ps-area">
              <h3 className="ps-area-title">{area.label}</h3>
              <ul className="ps-rooms">
                {area.rooms.map((room, i) => <Room key={i} room={room} />)}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function InspirationSection({ inspiration }) {
  return (
    <section className="ps-chapter">
      <h2 className="ps-chapter-title">{inspiration.title}</h2>
      {inspiration.items.map((item, i) => <ChapterItem key={i} item={item} />)}
      {inspiration.images.length === 0 ? (
        <div className="ps-field-value"><Unanswered /></div>
      ) : (
        <ul className="ps-images">
          {inspiration.images.map((img, i) => (
            <li key={i} className="ps-image">
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
                <div className="ps-file">
                  <span className="ps-file-ext">{getFileExtension({ file_name: img.fileName, file_url: img.url })}</span>
                  <span className="ps-file-name" title={img.fileName}>{stripExtension(img.fileName)}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function ProgrammingSummaryDocument({ model }) {
  return (
    <div className="ps-page">
      <article className="ps-doc" dir="rtl" lang="he">
        <header className="ps-header">
          <p className="ps-eyebrow">{model.title}</p>
          <h1 className="ps-project">{model.projectName}</h1>
          {model.clientNames.length > 0 && (
            <p className="ps-meta">
              <span className="ps-meta-label">{CLIENTS_LABEL}:</span>{' '}
              <span className="ps-text">{model.clientNames.join(', ')}</span>
            </p>
          )}
          {model.updatedAt && (
            <p className="ps-meta">
              <span className="ps-meta-label">{UPDATED_LABEL}:</span> {model.updatedAt}
            </p>
          )}
          <p className="ps-completion">
            {model.completion.map((c, i) => (
              <span key={i} className="ps-completion-item">
                <span className="ps-meta-label">{c.label}:</span> {c.value}
              </span>
            ))}
          </p>
        </header>

        {model.chapters.map(chapter => (
          <section key={chapter.key} className="ps-chapter">
            <h2 className="ps-chapter-title">{chapter.title}</h2>
            {chapter.items.map((item, i) => <ChapterItem key={i} item={item} />)}
            {chapter.footnote && <p className="ps-footnote">{chapter.footnote}</p>}
          </section>
        ))}

        <HouseSection house={model.house} />

        {model.inspiration && <InspirationSection inspiration={model.inspiration} />}
      </article>
    </div>
  )
}
