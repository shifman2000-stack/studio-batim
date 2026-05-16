// src/hooks/useGooglePicker.js
// Thin wrapper around the Google Picker JS library (loaded via script tags).
// Returns { openPicker, listFolderContents, isReady, accessToken, error }

import { useState, useEffect, useRef } from 'react'

const PICKER_API_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY
const CLIENT_ID      = import.meta.env.VITE_GOOGLE_CLIENT_ID

// Append a <script> tag only once; resolve immediately if it already exists.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src   = src
    s.async = true
    s.onload  = resolve
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(s)
  })
}

export function useGooglePicker() {
  const [isReady,     setIsReady]     = useState(false)
  const [accessToken, setAccessToken] = useState(null)
  const [error,       setError]       = useState(null)

  // Ref mirrors state so closures in openPicker / listFolderContents
  // always read the latest token without depending on re-renders.
  const tokenRef = useRef(null)

  // Lazy-load both Google scripts on mount
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        await Promise.all([
          loadScript('https://apis.google.com/js/api.js'),
          loadScript('https://accounts.google.com/gsi/client'),
        ])
        if (!cancelled) setIsReady(true)
      } catch (err) {
        if (!cancelled) setError('שגיאה בטעינת Google: ' + err.message)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // ── Internal helper: request (or silently re-request) an OAuth token ──────
  function getToken(forceConsent = false) {
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope:     'https://www.googleapis.com/auth/drive.file',
        callback:  (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error))
          } else {
            tokenRef.current = response.access_token
            setAccessToken(response.access_token)
            resolve(response.access_token)
          }
        },
      })
      // prompt='' = silent re-auth when user already consented.
      // forceConsent=true shows the full consent screen (used for first call).
      client.requestAccessToken(forceConsent ? undefined : { prompt: '' })
    })
  }

  // ── openPicker ────────────────────────────────────────────────────────────
  // Resolves to { folderId, folderName } or null (cancelled).
  const openPicker = async () => {
    setError(null)
    try {
      // Get token, showing consent screen on first use
      let token = tokenRef.current
      if (!token) {
        token = await getToken(true)
      }

      // Load the gapi Picker module
      await new Promise(resolve => window.gapi.load('picker', resolve))

      // Build and display the Picker
      return new Promise((resolve) => {
        const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
          .setSelectFolderEnabled(true)
          .setIncludeFolders(true)
          .setMimeTypes('application/vnd.google-apps.folder')

        const picker = new window.google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(PICKER_API_KEY)
          .setCallback(data => {
            if (data.action === 'picked') {
              const doc = data.docs[0]
              resolve({ folderId: doc.id, folderName: doc.name })
            } else if (data.action === 'cancel') {
              resolve(null)
            }
          })
          .build()

        picker.setVisible(true)
      })
    } catch (err) {
      setError(err.message)
      return null
    }
  }

  // ── listFolderContents ───────────────────────────────────────────────────
  // Returns [{ id, name, mimeType, modifiedTime, size }]
  const listFolderContents = async (folderId) => {
    let token = tokenRef.current
    if (!token) throw new Error('אין אסימון גישה — פתח את ה-Picker תחילה')

    const doFetch = (tok) => {
      const q      = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
      const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size)')
      const url    = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`
      console.log('[picker-diag] requesting folder contents', { folderId, hasToken: !!tok, tokenPrefix: tok ? tok.slice(0, 8) : null })
      return fetch(url, { headers: { Authorization: `Bearer ${tok}` } })
    }

    let resp = await doFetch(token)
    console.log('[picker-diag] response status', resp.status, resp.statusText)

    // 401 = token expired; attempt silent refresh and retry once
    if (resp.status === 401) {
      try {
        token = await getToken(false)
      } catch {
        throw new Error('פג תוקף הגישה ל-Google Drive — אנא נסה שוב')
      }
      resp = await doFetch(token)
      console.log('[picker-diag] response status (after token refresh)', resp.status, resp.statusText)
    }

    if (!resp.ok) {
      throw new Error(`שגיאת Drive API (${resp.status})`)
    }

    const json = await resp.json()
    console.log('[picker-diag] response body', json)
    const files = json.files
    console.log('[picker-diag] files array length', files?.length, 'first item', files?.[0])

    return (files || []).map(f => ({
      id:           f.id,
      name:         f.name,
      mimeType:     f.mimeType,
      modifiedTime: f.modifiedTime,
      size:         f.size ?? null,   // Google Docs have no size (stored internally)
    }))
  }

  return { openPicker, listFolderContents, isReady, accessToken, error }
}
