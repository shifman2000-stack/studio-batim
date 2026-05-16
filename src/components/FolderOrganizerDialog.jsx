// src/components/FolderOrganizerDialog.jsx
// Project Folder Organizer modal — step 2: list files inside the selected folder.
// Props:
//   isOpen  — boolean — controls visibility
//   onClose — function — called when user dismisses

import { useState } from 'react'
import { useGooglePicker } from '../hooks/useGooglePicker'
import './FolderOrganizerDialog.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mimeLabel(mimeType) {
  if (!mimeType) return ''
  if (mimeType === 'application/vnd.google-apps.folder')                                        return 'תיקייה'
  if (mimeType === 'application/pdf')                                                           return 'PDF'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')        return 'Excel'
  if (mimeType === 'application/vnd.google-apps.spreadsheet')                                  return 'Excel'
  if (mimeType === 'application/vnd.google-apps.document')                                     return 'מסמך'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')  return 'Word'
  if (mimeType.startsWith('image/'))                                                            return 'תמונה'
  const seg = mimeType.split('/').pop()
  return seg.length > 10 ? seg.slice(0, 10) : seg
}

function formatSize(size) {
  if (size == null) return '—'
  const n = Number(size)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' MB'
  if (n >= 1_000)     return Math.round(n / 1_000) + ' KB'
  return n + ' B'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('he-IL')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FolderOrganizerDialog({ isOpen, onClose }) {
  // step: 'idle' | 'loading' | 'listed' | 'error'
  const [step,           setStep]           = useState('idle')
  const [selectedFolder, setSelectedFolder] = useState(null)   // { folderId, folderName }
  const [files,          setFiles]          = useState([])
  const [errorMsg,       setErrorMsg]       = useState(null)

  const { openPicker, listFolderContents, isReady, error: pickerError } = useGooglePicker()

  if (!isOpen) return null

  // ── Reset + close ──────────────────────────────────────────────────────────
  const handleClose = () => {
    setStep('idle')
    setSelectedFolder(null)
    setFiles([])
    setErrorMsg(null)
    onClose()
  }

  // ── Fetch files for a given folder ────────────────────────────────────────
  const fetchFiles = async (folder) => {
    setStep('loading')
    try {
      const result = await listFolderContents(folder.folderId)
      setFiles(result)
      setStep('listed')
    } catch (err) {
      setErrorMsg(err.message)
      setStep('error')
    }
  }

  // ── Pick a folder then immediately fetch its contents ─────────────────────
  const handlePickFolder = async () => {
    const result = await openPicker()
    if (!result) return   // user cancelled the Picker
    setSelectedFolder(result)
    await fetchFiles(result)
  }

  // ── "החלף תיקייה" — go back to idle ─────────────────────────────────────
  const handleReplace = () => {
    setStep('idle')
    setSelectedFolder(null)
    setFiles([])
    setErrorMsg(null)
  }

  // ── Retry after error ─────────────────────────────────────────────────────
  const handleRetry = async () => {
    if (!selectedFolder) return
    await fetchFiles(selectedFolder)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fod-overlay" onClick={handleClose}>
      <div className="fod-card" onClick={e => e.stopPropagation()} dir="rtl">

        {/* Header */}
        <div className="fod-header">
          <span className="fod-title">סידור תיקיות פרויקט</span>
          <button className="fod-close" onClick={handleClose}>✕</button>
        </div>

        {/* Body */}
        <div className="fod-body">

          {/* ── Idle: pick button ── */}
          {step === 'idle' && (
            <div className="fod-idle">
              <button
                className="fod-btn-pick"
                onClick={handlePickFolder}
                disabled={!isReady}
              >
                בחר תיקייה מ-Google Drive
              </button>
              {pickerError && <p className="fod-error">{pickerError}</p>}
            </div>
          )}

          {/* ── Loading ── */}
          {step === 'loading' && (
            <div className="fod-loading">
              <span className="fod-spinner" />
              <p className="fod-loading-text">טוען רשימת קבצים...</p>
            </div>
          )}

          {/* ── Error ── */}
          {step === 'error' && (
            <div className="fod-error-state">
              <p className="fod-error">{errorMsg}</p>
              <button className="fod-btn-pick" onClick={handleRetry}>נסה שוב</button>
            </div>
          )}

          {/* ── Listed: folder header + file table ── */}
          {step === 'listed' && selectedFolder && (
            <div className="fod-listed">

              {/* Folder name + replace link */}
              <div className="fod-listed-header">
                <div className="fod-listed-folder">
                  <span className="fod-folder-label-inline">תיקייה:</span>
                  <span className="fod-folder-name-inline">{selectedFolder.folderName}</span>
                </div>
                <button className="fod-btn-replace" onClick={handleReplace}>החלף תיקייה</button>
              </div>

              {/* File list */}
              <div className="fod-file-list-wrap">
                {files.length === 0 ? (
                  <p className="fod-empty">התיקייה ריקה</p>
                ) : (
                  <table className="fod-file-table">
                    <thead>
                      <tr>
                        <th>שם קובץ</th>
                        <th>סוג</th>
                        <th>גודל</th>
                        <th>עודכן</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map(f => (
                        <tr key={f.id}>
                          <td className="fod-td-name">{f.name}</td>
                          <td className="fod-td-type">{mimeLabel(f.mimeType)}</td>
                          <td className="fod-td-size">{formatSize(f.size)}</td>
                          <td className="fod-td-date">{formatDate(f.modifiedTime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Debug: folder ID */}
              <p className="fod-debug-id">Folder ID: {selectedFolder.folderId}</p>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="fod-footer">
          <button className="fod-btn-close" onClick={handleClose}>סגור</button>
        </div>

      </div>
    </div>
  )
}
