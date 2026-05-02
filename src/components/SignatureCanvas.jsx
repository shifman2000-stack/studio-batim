// src/components/SignatureCanvas.jsx
// Self-contained modal for capturing a freehand digital signature.
// Returns a base64 PNG data-URL via onSave(dataUrl).
// Supports mouse + touch input with DPR scaling for crisp retina output.

import { useEffect, useRef, useState } from 'react'

export default function SignatureCanvas({ onSave, onCancel }) {
  const canvasRef  = useRef(null)
  const ctxRef     = useRef(null)
  const isDrawing  = useRef(false)
  const [hasDrawing, setHasDrawing] = useState(false)

  // Initialise canvas: size the backing store to physical pixels so lines are
  // crisp on high-DPR (retina) screens, then scale the context to match.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr  = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#1a1a18'
    ctx.lineWidth   = 2
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctxRef.current  = ctx
  }, [])

  // Return logical (CSS) coordinates relative to the canvas element.
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = (e) => {
    isDrawing.current = true
    const { x, y } = getPos(e)
    ctxRef.current.beginPath()
    ctxRef.current.moveTo(x, y)
    setHasDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing.current) return
    const { x, y } = getPos(e)
    ctxRef.current.lineTo(x, y)
    ctxRef.current.stroke()
  }

  const stopDraw = () => { isDrawing.current = false }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    ctxRef.current.clearRect(0, 0, rect.width, rect.height)
    setHasDrawing(false)
  }

  const handleSave = () => {
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onSave(dataUrl)
  }

  /* ── Shared button bases ── */
  const btnBase = {
    padding:       '9px 22px',
    fontFamily:    "'Heebo', sans-serif",
    fontWeight:    300,
    fontSize:      12,
    letterSpacing: '0.12em',
    borderRadius:  0,
    cursor:        'pointer',
  }
  const btnSecondary = {
    ...btnBase,
    background: 'transparent',
    color:      '#1a1a18',
    border:     '1px solid rgba(26,26,24,0.22)',
  }
  const btnPrimary = {
    ...btnBase,
    background: '#1a1a18',
    color:      '#f7f5f2',
    border:     '1px solid #1a1a18',
    opacity:    hasDrawing ? 1 : 0.4,
    cursor:     hasDrawing ? 'pointer' : 'not-allowed',
  }

  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      background:     'rgba(0,0,0,0.5)',
      zIndex:         1000,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background:  '#f7f5f2',
        border:      '1px solid rgba(26,26,24,0.13)',
        padding:     '32px 36px',
        maxWidth:    560,
        width:       '90vw',
        fontFamily:  "'Heebo', sans-serif",
        direction:   'rtl',
      }}>
        {/* Title */}
        <p style={{
          fontFamily:   "'Heebo', sans-serif",
          fontWeight:   400,
          fontSize:     18,
          color:        '#1a1a18',
          margin:       '0 0 6px',
        }}>
          חתימה דיגיטלית
        </p>

        {/* Subtitle */}
        <p style={{
          fontFamily: "'Heebo', sans-serif",
          fontWeight: 300,
          fontSize:   12,
          color:      '#8a8680',
          margin:     '0 0 20px',
        }}>
          חתמו במסגרת באמצעות עכבר או אצבע
        </p>

        {/* Drawing surface */}
        <canvas
          ref={canvasRef}
          style={{
            display:      'block',
            width:        '100%',
            height:       200,
            background:   '#ffffff',
            border:       '1px solid rgba(26,26,24,0.18)',
            cursor:       'crosshair',
            marginBottom: 20,
            touchAction:  'none',   // prevent scroll hijack on touch devices
          }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={(e) => { e.preventDefault(); startDraw(e) }}
          onTouchMove={(e)  => { e.preventDefault(); draw(e)      }}
          onTouchEnd={stopDraw}
        />

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
          <button style={btnSecondary} onClick={clearCanvas}>ניקוי</button>
          <button style={btnSecondary} onClick={onCancel}>ביטול</button>
          <button
            style={btnPrimary}
            disabled={!hasDrawing}
            onClick={hasDrawing ? handleSave : undefined}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  )
}
