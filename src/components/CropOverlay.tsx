import { useRef, useState } from 'react'
import { useEditor } from '../state/editorStore'
import { effectiveCrop, isCropInside, type CropRect } from '../types/geometry'
import { CORNER_HANDLES, EDGE_HANDLES, resizeCrop, type Handle } from '../lib/crop'

interface CropOverlayProps {
  /** CSS size of the canvas the overlay sits on. */
  displayWidth: number
  displayHeight: number
  /** Width of the straightened image, in crop units — the scale reference. */
  boundsWidth: number
  sourceWidth: number
  sourceHeight: number
}

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
  move: 'move',
}

export function CropOverlay({
  displayWidth,
  displayHeight,
  boundsWidth,
  sourceWidth,
  sourceHeight,
}: CropOverlayProps) {
  const geometry = useEditor((s) => s.edit.geometry)
  const startEdit = useEditor((s) => s.startEdit)
  const setGeometry = useEditor((s) => s.setGeometry)
  const endEdit = useEditor((s) => s.endEdit)

  const [active, setActive] = useState<Handle | null>(null)
  const drag = useRef<{ handle: Handle; x: number; y: number; crop: CropRect } | null>(null)

  const pxPerUnit = displayWidth / boundsWidth
  const crop = effectiveCrop(geometry, sourceWidth, sourceHeight)
  const left = displayWidth / 2 + (crop.cx - crop.width / 2) * pxPerUnit
  const top = displayHeight / 2 + (crop.cy - crop.height / 2) * pxPerUnit
  const width = crop.width * pxPerUnit
  const height = crop.height * pxPerUnit

  const isValid = (candidate: CropRect) =>
    isCropInside(candidate, geometry, sourceWidth, sourceHeight)

  /**
   * Moving slides along whatever edge it runs into: each axis is tried on its
   * own so a diagonal drag into a corner still travels as far as it can.
   */
  function nextForMove(base: CropRect, dx: number, dy: number): CropRect {
    let result = base
    const withX = { ...result, cx: base.cx + dx }
    if (isValid(withX)) result = withX
    const withY = { ...result, cy: base.cy + dy }
    if (isValid(withY)) result = withY
    return result
  }

  /**
   * Resizing cannot be split by axis once a ratio is locked, so the drag is
   * scaled back until it fits. Twelve halvings land well inside a pixel.
   */
  function nextForResize(base: CropRect, handle: Handle, dx: number, dy: number): CropRect {
    const full = resizeCrop(base, handle, dx, dy, geometry.aspect)
    if (isValid(full)) return full

    let lo = 0
    let hi = 1
    let best = base
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      const candidate = resizeCrop(base, handle, dx * mid, dy * mid, geometry.aspect)
      if (isValid(candidate)) {
        best = candidate
        lo = mid
      } else {
        hi = mid
      }
    }
    return best
  }

  const onPointerDown = (handle: Handle) => (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* the drag still tracks while the pointer stays over the overlay */
    }
    drag.current = { handle, x: event.clientX, y: event.clientY, crop }
    setActive(handle)
    startEdit()
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current
    if (!current) return
    // A handle sits inside the frame, so without this the frame's own listener
    // would recompute the same drag a second time on every move.
    event.stopPropagation()
    const dx = (event.clientX - current.x) / pxPerUnit
    const dy = (event.clientY - current.y) / pxPerUnit
    setGeometry({
      crop:
        current.handle === 'move'
          ? nextForMove(current.crop, dx, dy)
          : nextForResize(current.crop, current.handle, dx, dy),
    })
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag.current) return
    event.stopPropagation()
    drag.current = null
    setActive(null)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    endEdit()
  }

  const dragHandlers = {
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
  }

  return (
    <div
      className="crop"
      style={{ width: displayWidth, height: displayHeight }}
      // Pointer events land on the handles and the frame, never the backdrop.
    >
      <div
        className={`crop__frame${active ? ' crop__frame--active' : ''}`}
        style={{ left, top, width, height, cursor: CURSORS.move }}
        onPointerDown={onPointerDown('move')}
        {...dragHandlers}
      >
        <div className="crop__grid" aria-hidden="true">
          <span /> <span /> <span /> <span />
        </div>

        {EDGE_HANDLES.map((handle) => (
          <div
            key={handle}
            className={`crop__edge crop__edge--${handle}`}
            style={{ cursor: CURSORS[handle] }}
            onPointerDown={onPointerDown(handle)}
            {...dragHandlers}
          />
        ))}

        {CORNER_HANDLES.map((handle) => (
          <div
            key={handle}
            className={`crop__corner crop__corner--${handle}`}
            style={{ cursor: CURSORS[handle] }}
            onPointerDown={onPointerDown(handle)}
            {...dragHandlers}
          />
        ))}
      </div>
    </div>
  )
}
