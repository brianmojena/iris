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

