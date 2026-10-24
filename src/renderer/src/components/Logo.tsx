import { useId } from 'react'

// Chamfered frame with a prompt glyph, stroked with the brand gradient.
export function Logo({ size = 16, stroke = 1.5 }: { size?: number; stroke?: number }): React.JSX.Element {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="sldev">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4d8dff" />
          <stop offset="0.5" stopColor="#2ee6a8" />
          <stop offset="1" stopColor="#a970ff" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="square" strokeLinejoin="miter">
        <path d="M2 2H17L22 7V22H2Z" />
        <path d="M7 8.5L10.5 12L7 15.5" />
        <path d="M13 16H17.5" />
      </g>
    </svg>
  )
}
