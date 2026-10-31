import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Vertical bar chart with hover readout. Values are pre-formatted by the caller. */
export function BarChart({
  data,
  height = 200,
  format,
  className,
  highlightLast,
}: {
  data: { label: string; value: number; tooltip?: ReactNode }[];
  height?: number;
  format: (v: number) => string;
  className?: string;
  highlightLast?: boolean;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const bw = iw / Math.max(1, data.length);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const labelEvery = Math.ceil(data.length / Math.floor(iw / 44));
  return (
    <div ref={ref} className={cx('relative', className)}>
      <svg width={width} height={height} className="block">
        {ticks.map((v) => {
          const y = pad.t + ih - (v / max) * ih;
          return (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="var(--border)" />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" className="fill-[var(--muted)] text-[10.5px] font-semibold">
                {format(v)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * ih;
          const x = pad.l + i * bw + bw * 0.18;
          const w = bw * 0.64;
          const active = hover === i || (highlightLast && hover == null && i === data.length - 1);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
              <rect x={x} y={pad.t + ih - Math.max(h, d.value > 0 ? 2 : 0)} width={w} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={Math.min(6, w / 2)} fill="var(--accent)" opacity={active ? 1 : 0.55} />
              {i % labelEvery === 0 && (
                <text x={pad.l + i * bw + bw / 2} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[10.5px] font-semibold">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && data[hover] && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[12px] font-semibold whitespace-nowrap shadow-float"
          style={{ left: Math.min(width - 60, Math.max(60, pad.l + hover * bw + bw / 2)) }}
        >
          {data[hover].tooltip ?? `${data[hover].label}: ${format(data[hover].value)}`}
        </div>
      )}
    </div>
  );
}

/** Area chart over time, with a crosshair. Points with null values break the line. */
export function AreaChart({
  points,
  height = 180,
  format,
  timeFormat,
  className,
  onHover,
  color = 'var(--accent)',
}: {
  points: { t: number; v: number | null; dim?: boolean }[];
  height?: number;
  format: (v: number) => string;
  timeFormat: (t: number) => string;
  className?: string;
  onHover?: (index: number | null) => void;
  color?: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 10, t: 12, b: 24 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const valid = points.filter((p) => p.v != null);
  if (valid.length < 2) return <div className={cx('flex items-center justify-center text-[13px] text-muted', className)} style={{ height }}>Not enough speed data</div>;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const max = niceMax(Math.max(...valid.map((p) => p.v!)));
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  let line = '';
  let area = '';
  let segStart: number | null = null;
  points.forEach((p, i) => {
    if (p.v == null) {
      if (segStart != null) area += `L${x(points[i - 1]!.t)},${pad.t + ih}Z`;
      segStart = null;
      return;
    }
    const cmd = segStart == null ? 'M' : 'L';
    if (segStart == null) {
      segStart = i;
      area += `M${x(p.t)},${pad.t + ih}L${x(p.t)},${y(p.v)}`;
    } else area += `L${x(p.t)},${y(p.v)}`;
    line += `${cmd}${x(p.t)},${y(p.v)}`;
  });
  if (segStart != null) area += `L${x(t1)},${pad.t + ih}Z`;

  const move = (clientX: number, rect: DOMRect) => {
    const t = t0 + ((clientX - rect.left - pad.l) / iw) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.t - t) < Math.abs(points[best]!.t - t)) best = i;
    setHover(best);
    onHover?.(best);
  };
  const hp = hover != null ? points[hover] : null;
  return (
    <div ref={ref} className={cx('relative select-none', className)}>
      <svg
        width={width}
        height={height}
        className="block touch-none"
        onMouseMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
        onTouchMove={(e) => move(e.touches[0]!.clientX, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => {
          setHover(null);
          onHover?.(null);
        }}
      >
        <defs>
          <linearGradient id="area-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={width - pad.r} y1={y(f * max)} y2={y(f * max)} stroke="var(--border)" />
            <text x={pad.l - 8} y={y(f * max) + 4} textAnchor="end" className="fill-[var(--muted)] text-[10.5px] font-semibold">
              {format(f * max)}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={pad.l + f * iw} y={height - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="fill-[var(--muted)] text-[10.5px] font-semibold">
            {timeFormat(t0 + f * (t1 - t0))}
          </text>
        ))}
        <path d={area} fill="url(#area-grad)" />
        <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {hp && hp.v != null && (
          <>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-2)" strokeDasharray="3 3" />
            <circle cx={x(hp.t)} cy={y(hp.v)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-elevated px-2.5 py-1 text-[12px] font-bold whitespace-nowrap shadow-float" style={{ left: Math.min(width - 50, Math.max(50, x(hp.t))) }}>
          {hp.v != null ? format(hp.v) : '—'} <span className="font-semibold text-muted">· {timeFormat(hp.t)}</span>
          {hp.dim && <span className="ml-1 text-warning">est.</span>}
        </div>
      )}
    </div>
  );
}
