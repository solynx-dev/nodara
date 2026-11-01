import type { ReactNode } from 'react';
import { Logo } from './ui';

/** Split layout for sign-in flows: form on the left, brand canvas on the right. */
export function AuthLayout({ title, subtitle, children, footer }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <div className="flex w-full flex-col px-6 py-8 sm:px-10 lg:w-[520px] lg:shrink-0 lg:px-14">
        <Logo />
        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="mx-auto w-full max-w-[380px] animate-rise">
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">{title}</h1>
            {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-center text-[14px] text-muted">{footer}</div>}
          </div>
        </div>
        <p className="text-[12px] text-muted">
          Your people. Your places. Your data. ·{' '}
          {/* A real link (not the router): the policy is a server-rendered page. */}
          <a href="/privacy-policy" className="underline underline-offset-2 hover:text-ink">
            Privacy policy
          </a>
        </p>
      </div>
      <BrandCanvas />
    </div>
  );
}

/** Abstract "constellation map" — nodes and routes on a soft grid. Pure SVG, no external assets. */
function BrandCanvas() {
  const nodes = [
    { x: 180, y: 210, c: '#FF6B3D', r: 9, live: true },
    { x: 420, y: 150, c: '#4C9AFF', r: 7 },
    { x: 520, y: 380, c: '#2FBF71', r: 8, live: true },
    { x: 300, y: 470, c: '#F5A524', r: 7 },
    { x: 640, y: 230, c: '#B37FEB', r: 6 },
  ];
  return (
    <div className="relative hidden flex-1 overflow-hidden bg-[#0c0e12] lg:block">
      <svg className="absolute inset-0 size-full" viewBox="0 0 800 640" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="rgb(255 255 255 / 0.04)" />
          </pattern>
          <radialGradient id="glow" cx="0.35" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#FF6B3D" stopOpacity="0.22" />
            <stop offset="1" stopColor="#FF6B3D" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="route" x1="0" x2="1">
            <stop offset="0" stopColor="#FFB547" />
            <stop offset="1" stopColor="#FF5A2B" />
          </linearGradient>
        </defs>
        <rect width="800" height="640" fill="url(#grid)" />
        <rect width="800" height="640" fill="url(#glow)" />
        {/* streets */}
        <g stroke="rgb(255 255 255 / 0.07)" strokeWidth="10" fill="none" strokeLinecap="round">
          <path d="M-20 300 C 200 260, 380 330, 820 280" />
          <path d="M260 -20 C 240 200, 340 420, 300 660" />
          <path d="M560 -20 L 600 660" />
        </g>
        {/* geofence */}
        <circle cx="520" cy="380" r="70" fill="#2FBF71" fillOpacity="0.07" stroke="#2FBF71" strokeOpacity="0.5" strokeDasharray="6 5" />
        {/* trip route */}
        <path d="M180 210 C 230 260, 260 300, 300 320 S 440 330, 520 380" fill="none" stroke="url(#route)" strokeWidth="4" strokeLinecap="round" />
        {nodes.map((n, i) => (
          <g key={i}>
            {n.live && (
              <circle cx={n.x} cy={n.y} r={n.r} fill={n.c} opacity="0.4">
                <animate attributeName="r" from={n.r} to={n.r * 3.2} dur="2.6s" repeatCount="indefinite" begin={`${i * 0.4}s`} />
                <animate attributeName="opacity" from="0.45" to="0" dur="2.6s" repeatCount="indefinite" begin={`${i * 0.4}s`} />
              </circle>
            )}
            <circle cx={n.x} cy={n.y} r={n.r + 4} fill="#0c0e12" />
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.c} />
          </g>
        ))}
      </svg>
      <div className="absolute inset-x-0 bottom-0 p-14 text-white">
        <div className="max-w-md">
          <div className="text-[13px] font-bold tracking-[0.12em] text-[#FFB547] uppercase">Self-hosted · Open source</div>
          <p className="mt-3 text-[30px] leading-[1.15] font-extrabold tracking-[-0.03em]">Know your people got home safe — on a server you own.</p>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">Live sharing, full location history, trips and places. No subscriptions, no ads, no one else reading your map.</p>
        </div>
      </div>
    </div>
  );
}
