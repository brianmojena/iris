import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ScopeSample } from '../engine/Renderer'
import {
  histogram,
  SCOPE_KINDS,
  vectorscopeImage,
  VECTOR_TARGETS,
  waveformImage,
  type Histogram,
  type ScopeImage,
  type ScopeKind,
} from '../lib/scopes'
import { fill, formatPlain, useDict, useLocale } from '../i18n'
import { IconClose } from './icons'

/** Matches the backdrop the pixel buffers are painted onto. */
const BACKDROP = '#0f0f11'
const CHANNEL_INK = ['#ff4d4f', '#3ddc84', '#4d7cff']

interface ScopesProps {
  sample: ScopeSample | null
  onClose: () => void
}

/**
 * The instrument panel: histogram, waveform, parade and vectorscope over the
 * photograph.
 *
 * It floats on the stage rather than living in a tab because a scope is only
 * useful while you are moving something — the moment it costs a click to look
 * at, nobody looks. Dark, because a plot of light needs a dark field to be read
 * against, whatever colour the rest of the interface is.
 */
export function Scopes({ sample, onClose }: ScopesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Plots are measured at their own size and scaled onto the canvas; this is
  // where they are put down first. Kept across frames so a redraw does not
  // allocate a canvas sixty times a second.
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const [kind, setKind] = useState<ScopeKind>('histogram')
  const [width, setWidth] = useState(0)
  const t = useDict()
  const locale = useLocale()

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // One pass over the pixels feeds both the plot and the clipping readout.
  const bins = useMemo(() => (sample ? histogram(sample) : null), [sample])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const dpr = window.devicePixelRatio || 1
    const height = kind === 'vectorscope' ? width : Math.round(width * 0.6)
    const pixelWidth = Math.max(1, Math.round(width * dpr))
    const pixelHeight = Math.max(1, Math.round(height * dpr))
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.height = `${height}px`

    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = BACKDROP
    context.fillRect(0, 0, pixelWidth, pixelHeight)
    if (!sample) return

    if (kind === 'histogram') {
      if (bins) drawHistogram(context, bins, pixelWidth, pixelHeight, dpr)
    } else if (kind === 'vectorscope') {
      const side = Math.min(pixelWidth, pixelHeight)
      const plot = vectorscopeImage(sample, side)
      blit(context, scratchRef, plot, (pixelWidth - side) / 2, 0, side, side)
      drawGraticule(context, (pixelWidth - side) / 2, side, dpr)
    } else {
      const plot = waveformImage(
        sample,
        pixelWidth,
        pixelHeight,
        kind === 'parade' ? 'parade' : 'rgb',
      )
      blit(context, scratchRef, plot, 0, 0, pixelWidth, pixelHeight)
      drawLevels(context, pixelWidth, pixelHeight, dpr)
    }
  }, [sample, bins, kind, width])

  return (
    <div className="scopes" role="group" aria-label={t.scopes.title}>
      <div className="scopes__head">
        <div className="segmented segmented--dark">
          {SCOPE_KINDS.map((option) => (
            <button
              key={option}
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
            >
              {t.scopes[option]}
            </button>
          ))}
        </div>
        <button className="scopes__close" onClick={onClose} aria-label={t.scopes.close}>
          <IconClose size={14} />
        </button>
      </div>

      <canvas ref={canvasRef} className="scopes__plot" />

      <p className="scopes__meta">
        {bins
          ? fill(t.scopes.clipped, {
              low: formatPlain(bins.clippedLow * 100, 1, locale),
              high: formatPlain(bins.clippedHigh * 100, 1, locale),
            })
          : t.scopes.note}
      </p>
    </div>
  )
}

/** Puts a plot down at its own size, then stretches it over the canvas. */
function blit(
  context: CanvasRenderingContext2D,
  scratchRef: React.RefObject<HTMLCanvasElement | null>,
  plot: ScopeImage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scratch = (scratchRef.current ??= document.createElement('canvas'))
  scratch.width = plot.width
  scratch.height = plot.height
  const into = scratch.getContext('2d')
  if (!into) return
  into.putImageData(new ImageData(plot.pixels, plot.width, plot.height), 0, 0)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(scratch, x, y, width, height)
}

function drawHistogram(
  context: CanvasRenderingContext2D,
  bins: Histogram,
  width: number,
  height: number,
  dpr: number,
): void {
  const channels = [bins.r, bins.g, bins.b]

  context.save()
  // Channels add the way light does, so where all three overlap reads white and
  // a cast shows up as colour without needing a legend.
  context.globalCompositeOperation = 'lighter'
  for (let c = 0; c < 3; c++) {
    context.beginPath()
    context.moveTo(0, height)
    for (let x = 0; x < width; x++) {
      const value = Math.min(1, channels[c][Math.floor((x / width) * 256)] / bins.peak)
      context.lineTo(x, height - value * (height - 2))
    }
    context.lineTo(width, height)
    context.closePath()
    context.fillStyle = CHANNEL_INK[c]
    context.globalAlpha = 0.55
    context.fill()
  }
  context.restore()
  drawLevels(context, width, height, dpr)
}

/** The quarter-tone lines every scope has, so a reading has something to be read against. */
function drawLevels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
): void {
  context.save()
  context.strokeStyle = 'rgba(255, 255, 255, 0.13)'
  context.lineWidth = dpr
  for (let i = 1; i < 4; i++) {
    const y = Math.round((i / 4) * height) + 0.5
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }
  context.restore()
}

function drawGraticule(
  context: CanvasRenderingContext2D,
  left: number,
  side: number,
  dpr: number,
): void {
  const centre = left + side / 2
  const middle = side / 2
  const radius = side / 2 - dpr

  context.save()
  context.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  context.lineWidth = dpr
  context.beginPath()
  context.arc(centre, middle, radius, 0, Math.PI * 2)
  context.moveTo(centre - radius, middle)
  context.lineTo(centre + radius, middle)
  context.moveTo(centre, middle - radius)
  context.lineTo(centre, middle + radius)
  context.stroke()

  // Where 75 % colour bars land. A skin tone sits on the line running up and to
  // the left of centre, which is the one reading everybody actually uses.
  context.lineWidth = dpr * 1.2
  for (const target of VECTOR_TARGETS) {
    const x = centre + target.x * radius
    const y = middle - target.y * radius
    context.strokeStyle = target.color
    context.strokeRect(x - 3.5 * dpr, y - 3.5 * dpr, 7 * dpr, 7 * dpr)
  }
  context.restore()
}
