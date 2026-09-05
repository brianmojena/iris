/** Minimal 20px stroke icons, sized to match the 13px UI text. */

interface IconProps {
  size?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IconUndo = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 6H12.5a4 4 0 0 1 0 8H8" />
    <path d="M9.5 3.5 6.5 6l3 2.5" />
  </svg>
)

export const IconRedo = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M13 6H7.5a4 4 0 0 0 0 8H12" />
    <path d="M10.5 3.5 13.5 6l-3 2.5" />
  </svg>
)

export const IconCompare = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2.75" y="4.25" width="14.5" height="11.5" rx="1.5" />
    <path d="M10 4.25v11.5" />
    <path d="M5.5 8h2M5.5 11h2" />
  </svg>
)

export const IconReset = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 10a6 6 0 1 0 1.9-4.4" />
    <path d="M4 3.5V7h3.5" />
  </svg>
)

export const IconDownload = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10 3.5v9" />
    <path d="M6.5 9.5 10 13l3.5-3.5" />
    <path d="M3.75 15.5h12.5" />
  </svg>
)

export const IconImage = ({ size = 34 }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.1}>
    <rect x="2.5" y="3.75" width="15" height="12.5" rx="2" />
    <circle cx="7" cy="8" r="1.25" />
    <path d="m3 14 3.75-3.5a1.5 1.5 0 0 1 2 0L13 14.5" />
    <path d="m11.5 12 1.75-1.6a1.5 1.5 0 0 1 2 0L17.5 12.5" />
  </svg>
)

export const IconClose = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </svg>
)

export const IconMinus = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 10h10" />
  </svg>
)

export const IconPlus = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10 5v10M5 10h10" />
  </svg>
)

export const IconFit = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7.5 3.5h-4v4M12.5 3.5h4v4M16.5 12.5v4h-4M3.5 12.5v4h4" />
  </svg>
)

export const IconCrop = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5.5 2v12.5H18" />
    <path d="M2 5.5h12.5V18" />
  </svg>
)

export const IconSliders = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 6.5h9M15 6.5h2M3 13.5h2M8 13.5h9" />
    <circle cx="13.5" cy="6.5" r="1.75" />
    <circle cx="6.5" cy="13.5" r="1.75" />
  </svg>
)

export const IconRotateLeft = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7.5A6.5 6.5 0 1 1 3.5 11" />
    <path d="M2.5 4v3.5H6" />
  </svg>
)

export const IconRotateRight = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M16 7.5A6.5 6.5 0 1 0 16.5 11" />
    <path d="M17.5 4v3.5H14" />
  </svg>
)

export const IconFlipH = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10 2.5v15" strokeDasharray="2 2" />
    <path d="M7.5 5.5 3 10l4.5 4.5z" />
    <path d="M12.5 5.5 17 10l-4.5 4.5z" />
  </svg>
)

export const IconFlipV = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2.5 10h15" strokeDasharray="2 2" />
    <path d="M5.5 7.5 10 3l4.5 4.5z" />
    <path d="M5.5 12.5 10 17l4.5-4.5z" />
  </svg>
)

export const IconCheck = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </svg>
)

export const IconClock = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4.25l2.75 1.75" />
  </svg>
)

/** The grading tab: a curve rising across its plot. */
export const IconCurve = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3.5 16.5v-13" />
    <path d="M3.5 16.5h13" />
    <path d="M3.5 14C8 14 8 6 16.5 6" />
  </svg>
)

/** The scopes: three traces of different heights. */
export const IconScope = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3.5 16.5v-13" />
    <path d="M3.5 16.5h13" />
    <path d="M6.5 14v-3.5M10 14V6M13.5 14v-5.5" />
  </svg>
)

/** The eyedropper: take the key colour from the photograph itself. */
export const IconPipette = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M16.5 3.5a2 2 0 0 0-2.8 0l-1.5 1.5-.8-.8-1.4 1.4 4.4 4.4 1.4-1.4-.8-.8 1.5-1.5a2 2 0 0 0 0-2.8Z" />
    <path d="M11.2 7.9 4.5 14.6V17h2.4l6.7-6.7" />
  </svg>
)
