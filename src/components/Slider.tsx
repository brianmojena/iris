import { useCallback, useRef, useState } from 'react'
import { formatValue, type SliderSpec } from '../types/adjustments'

interface SliderProps {
  spec: SliderSpec
  /** Comes from the dictionary, so the control itself stays language-agnostic. */
  label: string
  value: number
  defaultValue: number
  onStart: () => void
  onChange: (value: number) => void
  onEnd: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snap(value: number, step: number): number {
  const snapped = Math.round(value / step) * step
  // Round away float noise so 0.30000000000000004 never reaches the UI.
  return Number(snapped.toFixed(4))
}

/**
 * Pointer-driven slider. Built by hand rather than on `<input type=range>` so the
 * fill can grow outward from the neutral origin and so a drag maps to a single
 * undo step regardless of how many values it passes through.
 */
export function Slider({ spec, label, value, defaultValue, onStart, onChange, onEnd }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  // The ref is what the handlers branch on; the state only drives styling. React
  // batches updates, so a tap fast enough to put pointerdown and pointerup in the
  // same batch would still see `dragging === false` on the way up — the release
  // would bail out early and the slider would stay glued to the pointer.
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const modified = value !== defaultValue
  const toPercent = (v: number) => ((v - spec.min) / (spec.max - spec.min)) * 100
  const position = toPercent(value)
  const originPosition = toPercent(spec.origin)

  const valueAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track) return value
      const rect = track.getBoundingClientRect()
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
      return clamp(snap(spec.min + ratio * (spec.max - spec.min), spec.step), spec.min, spec.max)
    },
    [spec, value],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // Capture keeps the drag alive outside the 18px track, but it is only a
    // nicety — Safari rejects it for pointers it no longer considers active.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* dragging still works, it just stops at the element bounds */
    }
    draggingRef.current = true
    setDragging(true)
    onStart()
    onChange(valueAt(event.clientX))
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    onChange(valueAt(event.clientX))
  }

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    onEnd()
  }

  const reset = () => {
    if (!modified) return
    onStart()
    onChange(defaultValue)
    onEnd()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const coarse = event.shiftKey ? 10 : 1
    const deltas: Record<string, number> = {
      ArrowLeft: -spec.step * coarse,
      ArrowRight: spec.step * coarse,
      ArrowDown: -spec.step * coarse,
      ArrowUp: spec.step * coarse,
    }
    if (event.key in deltas) {
      event.preventDefault()
      onStart()
      onChange(clamp(snap(value + deltas[event.key], spec.step), spec.min, spec.max))
      onEnd()
    } else if (event.key === 'Home') {
      event.preventDefault()
      reset()
    }
  }

  return (
    <div
      className={`slider${modified ? ' slider--modified' : ''}${dragging ? ' slider--dragging' : ''}`}
    >
      <div className="slider__header">
        <span className="slider__label" onDoubleClick={reset}>
          {label}
        </span>
        <span className="slider__value">{formatValue(spec, value)}</span>
      </div>
      <div
        ref={trackRef}
        className="slider__track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        aria-valuetext={formatValue(spec, value)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onLostPointerCapture={stopDragging}
        onDoubleClick={reset}
        onKeyDown={handleKeyDown}
      >
        <div className="slider__rail" />
        <div
          className="slider__fill"
          style={{
            left: `${Math.min(originPosition, position)}%`,
            width: `${Math.abs(position - originPosition)}%`,
          }}
        />
        <div className="slider__thumb" style={{ left: `${position}%` }} />
      </div>
    </div>
  )
}
