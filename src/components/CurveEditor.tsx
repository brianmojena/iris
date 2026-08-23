import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { sampleCurve } from '../lib/curve'
import { CURVE_CHANNELS, type Curve, type CurveChannel } from '../types/grade'

/** Closest two control points may sit, so a curve can never become vertical. */
const MIN_GAP = 0.02
/** How near the pointer has to be, in pixels, to grab a point instead of adding one. */
const GRAB = 11
const MAX_POINTS = 16
const PAD = 10

interface CurveEditorProps {
  channel: CurveChannel
  curve: Curve
  labels: Record<CurveChannel, string>
  onStart: () => void
  onChange: (curve: Curve) => void
  onEnd: () => void
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

/**
 * The curve plot.
 *
 * Input runs left to right and output bottom to top, so the untouched curve is
 * the diagonal and every photographer already knows how to read it: above the
 * line is brighter, below is darker, and the steepness at any point is the
 * contrast the picture gets there.
 *
 * The two endpoints keep their x — they are the black and white *points*, and
 * letting them slide sideways is a different tool that this one does not need to
 * be. Everything between them moves freely, short of overtaking a neighbour.
 */
export function CurveEditor({
  channel,
  curve,
  labels,
  onStart,
  onChange,
  onEnd,
}: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef<number | null>(null)
  const [size, setSize] = useState(0)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) => setSize(entry.contentRect.width))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const toCanvas = useCallback(
    (point: { x: number; y: number }, span: number) => ({
      x: PAD + point.x * (span - PAD * 2),
      y: PAD + (1 - point.y) * (span - PAD * 2),
    }),
    [],
  )

  /** Only the coordinates are ever read, so a mouse event is as good as a pointer one. */
  const fromEvent = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const span = rect.width
    return {
      x: clamp01((event.clientX - rect.left - PAD) / (span - PAD * 2)),
      y: clamp01(1 - (event.clientY - rect.top - PAD) / (span - PAD * 2)),
    }
  }, [])

  /** Index of the point under the pointer, or null. */
  const hit = useCallback(
    (event: { clientX: number; clientY: number }): number | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      for (let i = 0; i < curve.length; i++) {
        const point = toCanvas(curve[i], rect.width)
        if (Math.hypot(point.x - px, point.y - py) <= GRAB) return i
      }
      return null
    },
    [curve, toCanvas],
  )

  const moveTo = useCallback(
    (index: number, position: { x: number; y: number }) => {
      const next = curve.map((p) => ({ ...p }))
      const last = next.length - 1
      if (index === 0) next[0] = { x: 0, y: round(position.y) }
      else if (index === last) next[last] = { x: 1, y: round(position.y) }
      else {
        next[index] = {
          x: round(
            Math.min(
              Math.max(position.x, next[index - 1].x + MIN_GAP),
              next[index + 1].x - MIN_GAP,
            ),
          ),
          y: round(position.y),
        }
      }
      onChange(next)
    },
    [curve, onChange],
  )

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* dragging still works inside the plot */
    }
    const existing = hit(event)
    const position = fromEvent(event)

    if (existing !== null) {
      onStart()
      draggingRef.current = existing
      moveTo(existing, position)
      return
    }
    if (curve.length >= MAX_POINTS) return

    // Refuse a new point that would sit on top of one already there; the two
    // would then be impossible to separate. Nothing above this line has touched
    // the edit, so bailing out here leaves no half-open history step behind.
    const index = curve.findIndex((p) => p.x > position.x)
    const at = index === -1 ? curve.length - 1 : index
    if (Math.abs(curve[at].x - position.x) < MIN_GAP) return
    if (at > 0 && Math.abs(curve[at - 1].x - position.x) < MIN_GAP) return

    const next = curve.map((p) => ({ ...p }))
    next.splice(at, 0, { x: round(position.x), y: round(position.y) })
    onStart()
    draggingRef.current = at
    onChange(next)
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (draggingRef.current === null) return
    moveTo(draggingRef.current, fromEvent(event))
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    if (draggingRef.current === null) return
    draggingRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    onEnd()
  }

  const handleDoubleClick = (event: React.MouseEvent) => {
    const index = hit(event)
    // The endpoints are the curve; removing one would leave nothing to draw.
    if (index === null || index === 0 || index === curve.length - 1) return
    onStart()
    onChange(curve.filter((_, i) => i !== index))
    onEnd()
  }

  // --- drawing -------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)

    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, size, size)

    // Read the palette off the element rather than repeating it here, so the
    // plot cannot drift away from the interface around it.
    const styles = getComputedStyle(canvas)
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback
    const grid = token('--border', '#e6e4e0')
    const faint = token('--border-strong', '#d4d1cb')
    const ink =
      channel === 'r' ? '#e5484d' : channel === 'g' ? '#2e9c68' : channel === 'b' ? '#3e63dd' : token('--text', '#1c1b19')

    const inner = size - PAD * 2

    context.strokeStyle = grid
    context.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const at = PAD + (i / 4) * inner
      context.beginPath()
      context.moveTo(Math.round(at) + 0.5, PAD)
      context.lineTo(Math.round(at) + 0.5, PAD + inner)
      context.moveTo(PAD, Math.round(at) + 0.5)
      context.lineTo(PAD + inner, Math.round(at) + 0.5)
      context.stroke()
    }

    // The identity, so how far the curve has been bent is always visible.
    context.strokeStyle = faint
    context.setLineDash([3, 3])
    context.beginPath()
    context.moveTo(PAD, PAD + inner)
    context.lineTo(PAD + inner, PAD)
    context.stroke()
    context.setLineDash([])

    const lut = sampleCurve(curve, Math.max(2, Math.round(inner)))
    context.strokeStyle = ink
    context.lineWidth = 1.75
    context.lineJoin = 'round'
    context.beginPath()
    for (let i = 0; i < lut.length; i++) {
      const x = PAD + (i / (lut.length - 1)) * inner
      const y = PAD + (1 - lut[i]) * inner
      i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
    }
    context.stroke()

    for (const point of curve) {
      const at = toCanvas(point, size)
      context.beginPath()
      context.arc(at.x, at.y, 4, 0, Math.PI * 2)
      context.fillStyle = '#fff'
      context.fill()
      context.lineWidth = 1.75
      context.strokeStyle = ink
      context.stroke()
    }
  }, [curve, channel, size, toCanvas])

  return (
    <canvas
      ref={canvasRef}
      className="curve__plot"
      role="application"
      aria-label={labels[channel]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    />
  )
}

export { CURVE_CHANNELS }
