export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4d8dff" />
          <stop offset="0.5" stopColor="#2ee6a8" />
          <stop offset="1" stopColor="#a970ff" />
        </linearGradient>
      </defs>
      <g stroke="url(#logo-g)" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M4 4H16.5L20 7.5V20H4Z" />
        <path d="M8 9L11 12L8 15" />
        <path d="M13 15.5H16.5" />
      </g>
    </svg>
  )
}
