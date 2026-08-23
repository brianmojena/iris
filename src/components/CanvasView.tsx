import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Renderer, type ScopeSample } from '../engine/Renderer'
import { useEditor } from '../state/editorStore'
import { straightenedBounds, turnedSize } from '../types/geometry'
import { CropOverlay } from './CropOverlay'
import { Scopes } from './Scopes'
import { dict, useDict } from '../i18n'
import { IconFit, IconMinus, IconPlus } from './icons'

/** Zoom is expressed as a multiple of "fits the viewport". */
const MIN_ZOOM = 1
const MAX_ZOOM = 12
/** Keeps the backing store sane on huge photos at high zoom. */
const MAX_CANVAS_PIXELS = 12_000_000
const STAGE_PADDING = 32

interface View {
  zoom: number
  x: number
  y: number
}

const FIT: View = { zoom: 1, x: 0, y: 0 }

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

function distance(a: PointerEvent | React.PointerEvent, b: PointerEvent | React.PointerEvent) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

interface CanvasViewProps {
  showOriginal: boolean
  /** While cropping, the whole straightened image is shown and zoom is locked. */
  cropMode: boolean
  showScopes: boolean
  onCloseScopes: () => void
}

export function CanvasView({
  showOriginal,
  cropMode,
  showScopes,
  onCloseScopes,
}: CanvasViewProps) {
  const image = useEditor((s) => s.image)
  const edit = useEditor((s) => s.edit)
  const geometry = edit.geometry

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const frameRef = useRef(0)

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>(FIT)
  const [panning, setPanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sample, setSample] = useState<ScopeSample | null>(null)
  const t = useDict()

  // Live pointers, so two fingers can be told apart from one.
  const pointers = useRef(new Map<number, React.PointerEvent>())
  const pinchStart = useRef<{
    distance: number
    zoom: number
    x: number
    y: number
    originX: number
    originY: number
  } | null>(null)
  const panStart = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null)

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStageSize({ width, height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // A fresh image, and entering or leaving the crop editor, all start fitted.
  useEffect(() => {
    setView(FIT)
  }, [image, cropMode])

  const sourceWidth = image?.bitmap.width ?? 1
  const sourceHeight = image?.bitmap.height ?? 1
  const turned = turnedSize(geometry, sourceWidth, sourceHeight)

  // What the canvas shows: the crop normally, the whole straightened image —
  // rotated corners included — while the crop editor is open.
  const bounds = cropMode
    ? straightenedBounds(geometry, sourceWidth, sourceHeight)
    : { width: geometry.crop.width, height: geometry.crop.height }
  const contentWidth = bounds.width * turned.width
  const contentHeight = bounds.height * turned.width

  const fitScale =
    image && stageSize.width > 0
      ? Math.min(
          (stageSize.width - STAGE_PADDING) / contentWidth,
          (stageSize.height - STAGE_PADDING) / contentHeight,
          // Never blow small images up past their own pixels just to fill space.
          1,
        )
      : 1

  // Size the content occupies at zoom 1. Everything about panning is derived from
  // this rather than from the rendered size, which lags a frame behind during a
  // fast gesture and would make the clamp below drift.
  const baseWidth = image ? contentWidth * fitScale : 0
  const baseHeight = image ? contentHeight * fitScale : 0
  const displayWidth = baseWidth * view.zoom
  const displayHeight = baseHeight * view.zoom

  /** Applies the zoom limits and stops the photo being dragged out of sight. */
  const clampView = useCallback(
    (next: View): View => {
      const zoom = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM)
      if (zoom === MIN_ZOOM) return FIT
      const overflowX = Math.max(0, (baseWidth * zoom - stageSize.width) / 2)
      const overflowY = Math.max(0, (baseHeight * zoom - stageSize.height) / 2)
      return {
        zoom,
        x: clamp(next.x, -overflowX, overflowX),
        y: clamp(next.y, -overflowY, overflowY),
      }
    },
    [baseWidth, baseHeight, stageSize],
  )

  /** Zooms while keeping the point under the cursor pinned in place. */
  const zoomAt = useCallback(
    (factor: number, originX = 0, originY = 0) => {
      setView((current) => {
        const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
        const ratio = zoom / current.zoom
        return clampView({
          zoom,
          x: originX + (current.x - originX) * ratio,
          y: originY + (current.y - originY) * ratio,
        })
      })
    },
    [clampView],
  )

  // Resizing the window can leave the photo parked outside the new bounds.
  useEffect(() => {
    setView((current) => clampView(current))
  }, [clampView])

  // --- renderer lifecycle --------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      rendererRef.current = new Renderer(canvas)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : dict().notices.noWebgl)
    }
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !image) return
    renderer.setImage(image.bitmap)
  }, [image])

  // Draw on the next frame whenever anything visible changes. Collapsing bursts
  // of slider updates into one frame is what keeps dragging smooth.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !image || displayWidth <= 0) return

    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      let width = Math.round(displayWidth * dpr)
      let height = Math.round(displayHeight * dpr)

      // Rendering more pixels than the source region has buys nothing.
      const sourceCap = Math.min(1, contentWidth / Math.max(width, 1))
      if (sourceCap < 1) {
        width = Math.round(width * sourceCap)
        height = Math.round(height * sourceCap)
      }
      const pixels = width * height
      if (pixels > MAX_CANVAS_PIXELS) {
        const scale = Math.sqrt(MAX_CANVAS_PIXELS / pixels)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }

      const options = {
        bypass: showOriginal,
        cropOverride: cropMode
          ? { cx: 0, cy: 0, width: bounds.width, height: bounds.height }
          : undefined,
      }
      renderer.render(edit, Math.max(width, 1), Math.max(height, 1), options)

      // Measured in the same frame it was drawn, off a thumbnail of its own, so
      // the scopes never make the preview wait on a full-size pixel readback.
      if (showScopes) setSample(renderer.readScope(edit, options))
    })

    return () => cancelAnimationFrame(frameRef.current)
  }, [
    edit,
    image,
    displayWidth,
    displayHeight,
    contentWidth,
    showOriginal,
    cropMode,
    showScopes,
    bounds.width,
    bounds.height,
  ])

  // The browser may drop the GL context under memory pressure; recover instead
  // of leaving the user staring at a blank rectangle.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onLost = (event: Event) => {
      event.preventDefault()
      setError(dict().notices.contextLost)
    }
    const onRestored = () => {
      try {
        rendererRef.current?.dispose()
        rendererRef.current = new Renderer(canvas)
        if (image) rendererRef.current.setImage(image.bitmap)
        setError(null)
      } catch {
        setError(dict().notices.contextUnrecoverable)
      }
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }, [image])

  // --- interaction ---------------------------------------------------------

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || cropMode) return

    // Registered manually because React's onWheel is passive and cannot
    // preventDefault the browser's own pinch-zoom.
    const onWheel = (event: WheelEvent) => {
      if (!image) return
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const originX = event.clientX - rect.left - rect.width / 2
      const originY = event.clientY - rect.top - rect.height / 2
      // Trackpad pinch arrives as a wheel event with ctrlKey set.
      const intensity = event.ctrlKey ? 0.01 : 0.0025
      zoomAt(Math.exp(-event.deltaY * intensity), originX, originY)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [image, zoomAt, cropMode])

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!image || cropMode) return
    pointers.current.set(event.pointerId, event)
    try {
      ;(event.target as Element).setPointerCapture?.(event.pointerId)
    } catch {
      /* the gesture still tracks through the stage's own handlers */
    }

    const list = [...pointers.current.values()]
    if (list.length === 2) {
      const stage = stageRef.current?.getBoundingClientRect()
      const midX = (list[0].clientX + list[1].clientX) / 2
      const midY = (list[0].clientY + list[1].clientY) / 2
      pinchStart.current = {
        distance: distance(list[0], list[1]),
        zoom: view.zoom,
        x: view.x,
        y: view.y,
        originX: stage ? midX - stage.left - stage.width / 2 : 0,
        originY: stage ? midY - stage.top - stage.height / 2 : 0,
      }
      panStart.current = null
      setPanning(false)
    } else if (list.length === 1 && view.zoom > 1) {
      panStart.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }
      setPanning(true)
    }
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, event)
    const list = [...pointers.current.values()]

    if (list.length === 2 && pinchStart.current) {
      const start = pinchStart.current
      const target = clamp(
        (distance(list[0], list[1]) / start.distance) * start.zoom,
        MIN_ZOOM,
        MAX_ZOOM,
      )
      // Anchor on the midpoint between the fingers so the photo grows out of
      // where the gesture is, the way every native photo viewer behaves.
      const ratio = target / start.zoom
      setView(() =>
        clampView({
          zoom: target,
          x: start.originX + (start.x - start.originX) * ratio,
          y: start.originY + (start.y - start.originY) * ratio,
        }),
      )
      return
    }

    if (panStart.current) {
      const start = panStart.current
      setView((current) =>
        clampView({
          zoom: current.zoom,
          x: start.viewX + (event.clientX - start.x),
          y: start.viewY + (event.clientY - start.y),
        }),
      )
    }
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
    if (pointers.current.size === 0) {
      panStart.current = null
      setPanning(false)
    }
  }

  if (error) {
    return (
      <div className="stage" ref={stageRef}>
        <div className="panel__empty">{error}</div>
      </div>
    )
  }

  const zoomPercent = Math.round(fitScale * view.zoom * 100)

  return (
    <div
      className="stage"
      ref={stageRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => {
        if (!cropMode) setView((c) => (c.zoom > 1 ? FIT : { zoom: 2, x: 0, y: 0 }))
      }}
    >
      <canvas
        ref={canvasRef}
        className={`stage__canvas${panning ? ' stage__canvas--grabbing' : ''}`}
        style={{
          width: displayWidth ? `${displayWidth}px` : undefined,
          height: displayHeight ? `${displayHeight}px` : undefined,
          transform: `translate3d(${view.x}px, ${view.y}px, 0)`,
          cursor: !cropMode && view.zoom > 1 ? (panning ? 'grabbing' : 'grab') : 'default',
          // The straightened image is drawn with transparent corners, so the
          // drop shadow would trace the canvas box instead of the picture.
          boxShadow: cropMode ? 'none' : undefined,
        }}
      />

      {image && cropMode && (
        <CropOverlay
          displayWidth={displayWidth}
          displayHeight={displayHeight}
          boundsWidth={bounds.width}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
        />
      )}

      {showOriginal && <div className="stage__badge">{t.stage.original}</div>}

      {image && showScopes && <Scopes sample={sample} onClose={onCloseScopes} />}

      {image && !cropMode && (
        <div className="stage__hud">
          <button
            className="btn btn--icon"
            onClick={() => zoomAt(1 / 1.3)}
            disabled={view.zoom <= MIN_ZOOM}
            aria-label={t.stage.zoomOut}
          >
            <IconMinus />
          </button>
          <span className="stage__zoom">{zoomPercent}%</span>
          <button
            className="btn btn--icon"
            onClick={() => zoomAt(1.3)}
            disabled={view.zoom >= MAX_ZOOM}
            aria-label={t.stage.zoomIn}
          >
            <IconPlus />
          </button>
          <button
            className="btn btn--icon"
            onClick={() => setView(FIT)}
            disabled={view.zoom === 1}
            aria-label={t.stage.fit}
          >
            <IconFit />
          </button>
        </div>
      )}
    </div>
  )
}
