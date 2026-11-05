export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--text)" />
      <path
        d="M7 21c3 0 3-2.5 6-2.5S16 21 19 21s3-2.5 6-2.5"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M7 26c3 0 3-2.5 6-2.5S16 26 19 26s3-2.5 6-2.5"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity=".5"
      />
      <rect x="14.6" y="6" width="2.8" height="9" rx="1.2" fill="var(--bg)" />
      <circle cx="16" cy="5.6" r="2.6" fill="var(--brand)" />
    </svg>
  );
}
