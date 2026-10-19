import React from 'react';

interface HyperfeedsLogoProps {
  className?: string;
  variant?: 'full' | 'compact' | 'light';
  height?: number | string;
}

export default function HyperfeedsLogo({ className = '', variant = 'full', height = 48 }: HyperfeedsLogoProps) {
  const h = typeof height === 'number' ? height : Number.parseFloat(String(height)) || 48;
  const showSubtitle = variant === 'full';
  const onLight = variant === 'light' || variant === 'compact';
  const plantColor = onLight ? '#0b0c36' : '#ffffff';
  const subtitleColor = onLight ? '#64748b' : 'rgba(255,255,255,0.85)';
  const uid = React.useId().replace(/:/g, '');

  return (
    <div
      className={`inline-flex items-center gap-3 select-none ${className}`}
      style={{ height: h }}
    >
      {/* Mark — circle wraps the icon only, never the wordmark */}
      <svg
        viewBox="0 0 64 64"
        style={{ height: h * 0.92, width: h * 0.92 }}
        className="shrink-0 drop-shadow-sm"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <linearGradient id={`pcMarkNavy-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#12123a" />
            <stop offset="100%" stopColor="#06061c" />
          </linearGradient>
          <linearGradient id={`pcMarkOrange-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff9a1f" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="30" fill={`url(#pcMarkNavy-${uid})`} />
        <circle cx="32" cy="32" r="30" fill="none" stroke={`url(#pcMarkOrange-${uid})`} strokeWidth="3.5" />
        <path
          d="M32 14c0 10-6 16-12 20 6 0 10-4 12-10 2 6 6 10 12 10-6-4-12-10-12-20z"
          fill={`url(#pcMarkOrange-${uid})`}
        />
        <path
          d="M32 24v22"
          fill="none"
          stroke="#ffb35c"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>

      <div className="flex min-w-0 flex-col justify-center leading-none">
        <div className="flex items-baseline gap-0.5 whitespace-nowrap">
          <span
            className="font-black tracking-tight"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: 'italic',
              fontSize: Math.round(h * 0.42),
              color: plantColor,
            }}
          >
            Plant
          </span>
          <span
            className="font-black tracking-tight"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: 'italic',
              fontSize: Math.round(h * 0.42),
              color: '#ff9100',
            }}
          >
            Control
          </span>
        </div>
        {showSubtitle && (
          <span
            className="mt-1 font-bold uppercase tracking-[0.18em]"
            style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: Math.max(9, Math.round(h * 0.16)),
              color: subtitleColor,
            }}
          >
            Manufacturing System
          </span>
        )}
      </div>
    </div>
  );
}
