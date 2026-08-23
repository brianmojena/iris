import { useCallback, useRef, useState } from 'react'
import type { Wheel } from '../types/grade'

interface ColorWheelProps {
  label: string
  hint: string
  balanceLabel: string
  masterLabel: string
  resetLabel: string
  value: Wheel
  onStart: () => void
  onChange: (patch: Partial<Wheel>) => void
  onEnd: () => void
}

const NUDGE = 0.04

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Number(value.toFixed(3))
}

/**
 * One grading wheel: a disc for which way the colour goes and a track for how
 * bright that part of the picture sits.
 *
 * The two are separate controls on purpose. Every wheel here is mean-removed, so
 * dragging the handle changes only the balance between the channels and never
 * the exposure — which means you can chase a colour cast without watching the
 * brightness wander, and set the brightness without the colour following it.
 */
export function ColorWheel({
  label,
  hint,
  balanceLabel,
  masterLabel,
  resetLabel,
  value,
  onStart,
  onChange,
  onEnd,
}: ColorWheelProps) {
  const discRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  // See Slider: React can batch a fast tap so that the release still reads the
  // old state and never lets go.
  const draggingRef = useRef<'disc' | 'master' | null>(null)
  const [dragging, setDragging] = useState(false)

  const moved = value.x !== 0 || value.y !== 0 || value.master !== 0

  const positionAt = useCallback((clientX: number, clientY: number): Partial<Wheel> => {
    const disc = discRef.current
    if (!disc) return {}
    const rect = disc.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 2 - 1
    // Screen y grows downwards and the maths does not, so this is the one place
    // the two conventions meet.
    const y = 1 - ((clientY - rect.top) / rect.height) * 2
    const radius = Math.hypot(x, y)
    if (radius <= 1) return { x: round(x), y: round(y) }
    return { x: round(x / radius), y: round(y / radius) }
  }, [])

  const masterAt = useCallback((clientX: number): number => {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    return round(clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1))
  }, [])

  const begin = (event: React.PointerEvent, kind: 'disc' | 'master') => {
    if (event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* the drag just stops at the element bounds */
    }
    draggingRef.current = kind
    setDragging(true)
    onStart()
    onChange(
      kind === 'disc'
        ? positionAt(event.clientX, event.clientY)
        : { master: masterAt(event.clientX) },
    )
  }

  const move = (event: React.PointerEvent) => {
    if (!draggingRef.current) return
    onChange(
      draggingRef.current === 'disc'
        ? positionAt(event.clientX, event.clientY)
        : { master: masterAt(event.clientX) },
    )
  }

  const release = (event: React.PointerEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = null
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    onEnd()
  }

  const reset = () => {
    if (!moved) return
    onStart()
    onChange({ x: 0, y: 0, master: 0 })
    onEnd()
  }

  const nudge = (dx: number, dy: number) => {
    onStart()
    const x = clamp(value.x + dx, -1, 1)
    const y = clamp(value.y + dy, -1, 1)
    const radius = Math.hypot(x, y)
    onChange(radius > 1 ? { x: round(x / radius), y: round(y / radius) } : { x: round(x), y: round(y) })
    onEnd()
  }

  const onDiscKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? NUDGE * 3 : NUDGE
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    if (event.key in moves) {
      event.preventDefault()
      nudge(...moves[event.key])
    } else if (event.key === 'Home') {
      event.preventDefault()
      reset()
    }
  }

  const onMasterKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.01
    const deltas: Record<string, number> = {
      ArrowLeft: -step,
      ArrowDown: -step,
      ArrowRight: step,
      ArrowUp: step,
    }
    if (event.key in deltas) {
      event.preventDefault()
      onStart()
      onChange({ master: round(clamp(value.master + deltas[event.key], -1, 1)) })
      onEnd()
    } else if (event.key === 'Home') {
      event.preventDefault()
      reset()
    }
  }

  return (
    <div className={`wheel${moved ? ' wheel--modified' : ''}${dragging ? ' wheel--dragging' : ''}`}>
      <button className="wheel__label" onClick={reset} disabled={!moved} title={hint}>
        {label}
      </button>

      <div
        ref={discRef}
        className="wheel__disc"
        role="application"
        tabIndex={0}
        aria-label={balanceLabel}
        title={hint}
        onPointerDown={(e) => begin(e, 'disc')}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onDoubleClick={reset}
        onKeyDown={onDiscKey}
      >
        <span
          className="wheel__handle"
          style={{ left: `${(value.x + 1) * 50}%`, top: `${(1 - value.y) * 50}%` }}
        />
      </div>

      <div
        ref={trackRef}
        className="wheel__master"
        role="slider"
        tabIndex={0}
        aria-label={masterLabel}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value.master}
        title={resetLabel}
        onPointerDown={(e) => begin(e, 'master')}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onDoubleClick={reset}
        onKeyDown={onMasterKey}
      >
        <span className="wheel__rail" />
        <span
          className="wheel__fill"
          style={{
            left: `${(Math.min(0, value.master) + 1) * 50}%`,
            width: `${Math.abs(value.master) * 50}%`,
          }}
        />
        <span className="wheel__knob" style={{ left: `${(value.master + 1) * 50}%` }} />
      </div>
    </div>
  )
}
