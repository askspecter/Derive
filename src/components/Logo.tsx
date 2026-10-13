export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M16 5 L25 21 H19 L16 27 L13 21 H7 Z" fill="#0b0f0c" />
    </svg>
  )
}
