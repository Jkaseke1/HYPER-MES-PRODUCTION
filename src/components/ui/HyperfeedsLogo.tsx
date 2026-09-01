import React from 'react';

interface HyperfeedsLogoProps {
  className?: string;
  variant?: 'full' | 'compact' | 'light';
  height?: number | string;
}

export default function HyperfeedsLogo({ className = '', variant = 'full', height = 48 }: HyperfeedsLogoProps) {
  return (
    <div className={`inline-flex items-center select-none ${className}`}>
      <svg
        viewBox="0 0 400 145"
        style={{ height, width: 'auto' }}
        className="drop-shadow-md"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="navyGradComp" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0b0b34" />
            <stop offset="50%" stopColor="#080829" />
            <stop offset="100%" stopColor="#04041a" />
          </linearGradient>
          <linearGradient id="orangeGradComp" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff9100" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>

        {/* Outer Accent Arc */}
        <ellipse cx="200" cy="72" rx="192" ry="56" fill="none" stroke="#ff8a00" strokeWidth="4.5" opacity="0.95" transform="rotate(-1 200 72)"/>

        {/* Deep Navy Oval Body */}
        <ellipse cx="200" cy="72" rx="188" ry="52" fill="url(#navyGradComp)" stroke="#040418" strokeWidth="2.5"/>

        {/* Wheat Ears Icon */}
        <g transform="translate(192, 16) scale(0.75)">
          <path d="M-8,30 C-4,15 -10,5 -18,-5 C-12,0 -4,10 0,25" fill="none" stroke="#ff9100" strokeWidth="2.8" strokeLinecap="round"/>
          <path d="M-18,-5 C-22,-3 -20,3 -14,5 C-10,6 -12,0 -18,-5 Z" fill="#ff9100"/>
          <path d="M-14,5 C-18,7 -16,13 -10,15 C-6,16 -8,10 -14,5 Z" fill="#ff9100"/>
          <path d="M-10,15 C-14,17 -12,23 -6,25 C-2,26 -4,20 -10,15 Z" fill="#ff9100"/>

          <path d="M8,30 C4,15 10,5 18,-5 C12,0 4,10 0,25" fill="none" stroke="#ff9100" strokeWidth="2.8" strokeLinecap="round"/>
          <path d="M18,-5 C22,-3 20,3 14,5 C10,6 12,0 18,-5 Z" fill="#ff9100"/>
          <path d="M14,5 C18,7 16,13 10,15 C6,16 8,10 14,5 Z" fill="#ff9100"/>
          <path d="M10,15 C14,17 12,23 6,25 C2,26 4,20 10,15 Z" fill="#ff9100"/>
        </g>

        {/* "Plant" Text */}
        <text x="49" y="83" fontFamily="'Georgia', 'Times New Roman', serif" fontStyle="italic" fontWeight="900" fontSize="53" fill="#ffffff" letterSpacing="-1">Plant</text>

        {/* "Control" Text */}
        <text x="185" y="83" fontFamily="'Georgia', 'Times New Roman', serif" fontStyle="italic" fontWeight="900" fontSize="46" fill="url(#orangeGradComp)" letterSpacing="-1">Control</text>

        {/* Subtitle */}
        {variant !== 'compact' && (
          <text x="200" y="110" fontFamily="'Arial Black', 'Helvetica', sans-serif" fontWeight="900" fontSize="13" fill="#ffffff" letterSpacing="4.5" textAnchor="middle">
            MANUFACTURING SYSTEM
          </text>
        )}
      </svg>
    </div>
  );
}
