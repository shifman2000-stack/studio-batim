// src/components/documents/filePreview.jsx
//
// The file-preview vocabulary shared by every screen that shows a
// "table on the right, fixed preview pane on the left" layout:
//   · DocumentsTab.jsx        (מעקב מסמכים)
//   · ParentModelsPanel.jsx   (דגמים — תוכנית / הדמיה columns)
//
// Extracted FROM DocumentsTab (it was all inline there) so the models
// table reuses the exact same pane, icons and helpers instead of
// cloning them. Behaviour is unchanged for DocumentsTab — the only
// difference is that the bucket, which used to be a module constant,
// is now a parameter, since the two screens store their files in
// different buckets (project-files vs project-model-images).
//
// Styling still comes from DocumentsTab.css (.dt-preview-*) — importers
// bring that stylesheet in themselves.

import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import * as mammoth from 'mammoth'

/* ── Icons (shared with the file cells that trigger the preview) ── */
export const IconEye = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

export const IconDownload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

/* ── Pure helpers ────────────────────────────────────────────────── */

/* Lowercase extension from a URL (or bare filename). */
export function fileExt(url) {
  if (!url) return ''
  const name = url.split('/').pop()
  const dot  = name.lastIndexOf('.')
  return dot !== -1 ? name.slice(dot + 1).toLowerCase() : name
}

/* Public Storage URL → object path inside `bucket`, or null when the
   URL doesn't belong to that bucket (e.g. an external Google Drive
   link) — callers use null as "nothing to remove from Storage". */
export function storagePathIn(bucket, url) {
  if (!url) return null
  const marker = `/object/public/${bucket}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
}

/* True for URLs not hosted in `bucket` on Supabase Storage. */
export function isExternalUrlFor(bucket, url) {
  if (!url) return false
  return !url.includes(`/object/public/${bucket}/`)
}

export async function downloadBlob(url, fileName) {
  const res  = await fetch(url)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = href; a.download = fileName; a.click()
  URL.revokeObjectURL(href)
}

export function previewType(url) {
  if (!url) return null
  /* Google Drive URLs are embedded via /preview iframe (handles PDF/images/docs). */
  if (url.startsWith('https://drive.google.com/')) return 'pdf'
  const ext = fileExt(url.split('?')[0])
  if (['jpg','jpeg','png','gif','webp','bmp','svg','tiff','tif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc','docx'].includes(ext)) return 'word'
  return 'unsupported'
}

/* Extension derived from a {file_name, file_url}-ish object — prefers
   the stored name (which keeps its real extension even when the
   storage path was ASCII-mangled), falling back to the URL. */
export function getFileExtension(doc) {
  if (doc?.file_name) {
    const dot = doc.file_name.lastIndexOf('.')
    if (dot !== -1) return doc.file_name.slice(dot + 1).toLowerCase()
  }
  return fileExt(doc?.file_url)
}

/* Convert a Google Drive `/view` URL to its embeddable `/preview` form. */
export function getPreviewUrl(url) {
  if (!url) return url
  const m = url.match(/^(https:\/\/drive\.google\.com\/file\/d\/[^/]+)\/view/)
  return m ? `${m[1]}/preview` : url
}

/**
 * The preview pane itself — image / PDF / Word / unsupported, with the
 * Word branch downloading from Storage and converting via mammoth.
 * Renders nothing when `file` is null, so callers can mount it
 * unconditionally inside their left panel.
 *
 * @param {{url: string, name: string}|null} file
 * @param {string} bucket  Storage bucket the file lives in (for the
 *                         Word download path).
 */
export default function FilePreviewPane({ file, bucket }) {
  const [wordHtml,    setWordHtml]    = useState('')
  const [wordLoading, setWordLoading] = useState(false)
  const [wordError,   setWordError]   = useState(false)

  useEffect(() => {
    if (!file || previewType(file.url) !== 'word') return
    setWordHtml('')
    setWordError(false)
    setWordLoading(true)
    ;(async () => {
      try {
        const filePath = storagePathIn(bucket, file.url)
        if (!filePath) throw new Error('bad path')
        const { data, error } = await supabase.storage.from(bucket).download(filePath)
        if (error || !data) throw error
        const arrayBuffer = await data.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        setWordHtml(result.value)
      } catch {
        setWordError(true)
      } finally {
        setWordLoading(false)
      }
    })()
  }, [file, bucket])

  if (!file) return null
  const pType = previewType(file.url)

  return (
    <>
      <div className="dt-preview-label" title={file.name}>{file.name}</div>
      {pType === 'image' && (
        <img src={file.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt={file.name} />
      )}
      {pType === 'pdf' && (
        <iframe src={getPreviewUrl(file.url)} width="100%" height="100%" style={{ border: 'none', flex: 1 }} title={file.name} />
      )}
      {pType === 'word' && (
        wordLoading
          ? <div className="dt-preview-unsupported">טוען...</div>
          : wordError
            ? <div className="dt-preview-unsupported">שגיאה בטעינת הקובץ</div>
            : <div
                dangerouslySetInnerHTML={{ __html: wordHtml }}
                style={{ background: '#fff', padding: '16px', overflowY: 'auto', fontFamily: 'inherit', flex: 1, minHeight: 0 }}
              />
      )}
      {pType === 'unsupported' && (
        <p className="dt-preview-unsupported">תצוגה מקדימה אינה זמינה לסוג קובץ זה</p>
      )}
    </>
  )
}
