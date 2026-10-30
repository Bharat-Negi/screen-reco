export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="scp-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a3f4b" />
          <stop offset="1" stopColor="#14161b" />
        </linearGradient>
        <radialGradient id="scp-logo-dot" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ff6b6b" />
          <stop offset="1" stopColor="#d61f2c" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#scp-logo-bg)" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" strokeWidth="4" />
      <circle cx="32" cy="32" r="10.5" fill="url(#scp-logo-dot)" />
    </svg>
  );
}
