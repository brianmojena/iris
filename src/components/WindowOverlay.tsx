import { useRef, useState } from 'react'
import { useEditor } from '../state/editorStore'
import type { PowerWindow } from '../types/secondary'

interface WindowOverlayProps {
  /** CSS size of the canvas the overlay sits on. */
  displayWidth: number
  displayHeight: number
  /** The pan applied to the canvas, so the overlay travels with the picture. */
  offsetX: number
  offsetY: number
  secondaryId: string
  window: PowerWindow
}

type Grip = 'move' | 'corner' | 'rotate'

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

/**
 * The power window, drawn over the photograph and draggable there.
 *
 * Its numbers are in the panel too, but nobody positions a mask by typing
 * coordinates. This is the control; the sliders are the fine adjustment.
 *
 * Both half-sizes are fractions of the image's **height**, x included — the same
 * convention the shader uses, and for the same reason: it is what keeps a
 * rotated circle a circle instead of shearing it into an egg on a 3:2 frame.
 */
export function WindowOverlay({
  displayWidth,
  displayHeight,
  offsetX,
  offsetY,
  secondaryId,
  window: shape,
}: WindowOverlayProps) {
  const startEdit = useEditor((s) => s.startEdit)
  const setWindow = useEditor((s) => s.setWindow)
  const endEdit = useEditor((s) => s.endEdit)

  const frameRef = useRef<HTMLDivElement>(null)
  const gripRef = useRef<Grip | null>(null)
  // Where inside the window the drag started, so grabbing it by the edge moves
  // it by how far the pointer travels instead of teleporting its centre to the
  // cursor. Sounds pedantic; it is the difference between placing a mask and
  // fighting one.
  const grabRef = useRef({ x: 0, y: 0 })
  const [active, setActive] = useState<Grip | null>(null)

  const centreX = shape.cx * displayWidth
  const centreY = shape.cy * displayHeight
  const halfW = shape.halfWidth * displayHeight
  const halfH = shape.halfHeight * displayHeight
  const radians = (shape.angle * Math.PI) / 180

  /** Pointer position relative to the window's centre, in the window's own frame. */
  const local = (event: React.PointerEvent): { x: number; y: number } => {
    const host = frameRef.current?.parentElement
    if (!host) return { x: 0, y: 0 }
    const rect = host.getBoundingClientRect()
    const dx = event.clientX - rect.left - centreX
    const dy = event.clientY - rect.top - centreY
    const c = Math.cos(radians)
    const s = Math.sin(radians)
    return { x: dx * c + dy * s, y: -dx * s + dy * c }
  }

  const screenDelta = (event: React.PointerEvent) => {
    const host = frameRef.current?.parentElement
    if (!host) return { x: 0, y: 0 }
    const rect = host.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const begin = (event: React.PointerEvent, grip: Grip) => {
    if (event.button !== 0) return
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* the drag still tracks inside the element */
    }
    const at = screenDelta(event)
    grabRef.current = { x: at.x - centreX, y: at.y - centreY }
    gripRef.current = grip
    setActive(grip)
    startEdit()
  }

  const move = (event: React.PointerEvent) => {
    const grip = gripRef.current
    if (!grip) return
    event.stopPropagation()

    if (grip === 'move') {
      const at = screenDelta(event)
      setWindow(secondaryId, {
        cx: round(clamp((at.x - grabRef.current.x) / Math.max(displayWidth, 1), -0.5, 1.5)),
        cy: round(clamp((at.y - grabRef.current.y) / Math.max(displayHeight, 1), -0.5, 1.5)),
      })
      return
    }

    if (grip === 'corner') {
      // Corners resize about the centre rather than about the opposite corner:
      // a mask is a thing you place and then grow, and keeping it put while it
      // grows is far easier to aim than watching it walk across the picture.
      const point = local(event)
      setWindow(secondaryId, {
        halfWidth: round(clamp(Math.abs(point.x) / Math.max(displayHeight, 1), 0.01, 3)),
        halfHeight: round(clamp(Math.abs(point.y) / Math.max(displayHeight, 1), 0.01, 3)),
      })
      return
    }

    const at = screenDelta(event)
    const dx = at.x - centreX
    const dy = at.y - centreY
    // The handle sits above the window at rest, so straight up has to read as 0.
    let degrees = (Math.atan2(dx, -dy) * 180) / Math.PI
    // Half a turn leaves an ellipse or a rectangle exactly where it was, so the
    // second half of the circle is the first one over again.
    degrees = ((((degrees + 90) % 180) + 180) % 180) - 90
    setWindow(secondaryId, { angle: round(degrees) })
  }

  const release = (event: React.PointerEvent) => {
    if (!gripRef.current) return
    event.stopPropagation()
    gripRef.current = null
    setActive(null)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    endEdit()
  }

  const handlers = (grip: Grip) => ({
    onPointerDown: (event: React.PointerEvent) => begin(event, grip),
    onPointerMove: move,
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
  })

  // Where the matte starts falling away, so feather is something you can see
  // rather than a number you have to imagine.
  const inner = 1 - clamp(shape.feather, 0, 1)

  return (
    <div
      className="window"
      style={{
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
        transform: `translate(-50%, -50%) translate3d(${offsetX}px, ${offsetY}px, 0)`,
      }}
    >
      <div
        ref={frameRef}
        className={`window__frame${active ? ' window__frame--active' : ''}`}
        style={{
          left: `${centreX}px`,
          top: `${centreY}px`,
          width: `${halfW * 2}px`,
          height: `${halfH * 2}px`,
          borderRadius: shape.shape === 'ellipse' ? '50%' : '2px',
          transform: `translate(-50%, -50%) rotate(${shape.angle}deg)`,
        }}
        {...handlers('move')}
      >
        {inner > 0.01 && (
          <span
            className="window__feather"
            style={{
              borderRadius: shape.shape === 'ellipse' ? '50%' : '2px',
              transform: `translate(-50%, -50%) scale(${inner})`,
            }}
          />
        )}

        {CORNERS.map(([sx, sy]) => (
          <span
            key={`${sx}:${sy}`}
            className="window__corner"
            style={{
              left: `${50 + sx * 50}%`,
              top: `${50 + sy * 50}%`,
              cursor: sx * sy > 0 ? 'nwse-resize' : 'nesw-resize',
            }}
            {...handlers('corner')}
          />
        ))}

        <span className="window__stem" />
        <span className="window__rotate" {...handlers('rotate')} />
      </div>
    </div>
  )
}
