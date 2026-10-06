import { useCallback, useEffect, useRef, useState } from 'react'

/* ═══════════════════════════════════════════════════════════════════════
   useSignaturePad — פד חתימה inline, instance לכל חותם

   ⚠️ זה **לא** החלפה ל-SignatureCanvas.jsx. הקובץ ההוא הוא מודאל
   שמשרת את v1, והוא לא נגע. כאן הלוגיקה הנקייה בלבד, כדי שהחוויה
   תוכל לצייר פד בתוך הכרטיס האפל, ושני פדים באותו מסך.

   שלושה פרטים שנלמדו בדרך הקשה בדפדפן מוטמע (G.2, G.8 במסמך):
   · touch-action:none על הקנבס — אחרת הגלילה של iOS "גונבת" את המגע
     באמצע קו.
   · devicePixelRatio — בלעדיו החתימה מטושטשת במסך רטינה.
   · setPointerCapture — ממשיך לקבל אירועים גם כשהאצבע יוצאת מהקנבס.
   ═══════════════════════════════════════════════════════════════════════ */
export default function useSignaturePad({ onChange } = {}) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const drawingRef = useRef(false)
  const inkedRef = useRef(false)
  const [inked, setInked] = useState(false)

  /* מכייל את הקנבס לגודל התצוגה בפועל. לא מריצים את זה אחרי שכבר
     ציירו — שינוי width/height מנקה את הקנבס ומוחק את החתימה. */
  const resize = useCallback(() => {
    const cv = canvasRef.current
    if (!cv || inkedRef.current) return
    const rect = cv.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(rect.width * dpr)
    cv.height = Math.round(rect.height * dpr)
    const ctx = cv.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#16201d'
    ctxRef.current = ctx
  }, [])

  useEffect(() => {
    resize()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [resize])

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const onPointerDown = (e) => {
    const cv = canvasRef.current
    if (!cv) return
    if (!ctxRef.current) resize()
    if (!ctxRef.current) return
    e.preventDefault()
    drawingRef.current = true
    try { cv.setPointerCapture(e.pointerId) } catch { /* לא קריטי */ }
    ctxRef.current.beginPath()
    ctxRef.current.moveTo(...pos(e))
  }

  const onPointerMove = (e) => {
    if (!drawingRef.current || !ctxRef.current) return
    e.preventDefault()
    ctxRef.current.lineTo(...pos(e))
    ctxRef.current.stroke()
    if (!inkedRef.current) {
      inkedRef.current = true
      setInked(true)
    }
  }

  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (inkedRef.current) onChange?.(canvasRef.current.toDataURL('image/png'))
  }

  const clear = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.restore()
    inkedRef.current = false
    setInked(false)
    onChange?.('')
  }, [onChange])

  return {
    canvasRef,
    inked,
    clear,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerLeave: onPointerUp,
    },
  }
}
