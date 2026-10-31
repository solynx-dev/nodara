import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { cx, IconButton } from '@/components/ui';

export const SPEEDS = [60, 300, 900, 3600] as const;

/** Drives a playback clock with requestAnimationFrame. */
export function usePlaybackClock(playing: boolean, speed: number, t: number, setT: (fn: (t: number) => number) => void, end: number, onEnd: () => void) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current != null) {
        const dt = (now - last.current) * speed;
        setT((x) => {
          const next = x + dt;
          if (next >= end) {
            onEnd();
            return end;
          }
          return next;
        });
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, end, onEnd, setT]);
  return t;
}

export function PlaybackBar({
  start,
  end,
  t,
  onSeek,
  playing,
  onToggle,
  speed,
  onSpeed,
  marks,
}: {
  start: number;
  end: number;
  t: number;
  onSeek: (t: number) => void;
  playing: boolean;
  onToggle: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  marks?: { start: number; end: number; color?: string }[];
}) {
  const span = Math.max(1, end - start);
  const atEnd = t >= end;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-elevated/95 p-2 pr-3 shadow-float backdrop-blur-xl">
      <button
        onClick={atEnd ? () => onSeek(start) : onToggle}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-[0_6px_16px_-6px_var(--accent)] active:scale-95"
        aria-label={atEnd ? 'Restart' : playing ? 'Pause' : 'Play'}
      >
        {atEnd ? <RotateCcw className="size-5" /> : playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="tnum mb-1 flex justify-between text-[11.5px] font-semibold text-muted">
          <span>{format(start, 'h:mm a')}</span>
          <span className="text-[13px] font-bold text-ink">{format(t, 'h:mm:ss a')}</span>
          <span>{format(end, 'h:mm a')}</span>
        </div>
        <div className="relative h-6">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-3" />
          {marks?.map((m, i) => (
            <div
              key={i}
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
              style={{ left: `${((m.start - start) / span) * 100}%`, width: `${Math.max(0.6, ((m.end - m.start) / span) * 100)}%`, background: m.color ?? 'var(--accent)', opacity: 0.55 }}
            />
          ))}
          <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${((t - start) / span) * 100}%` }} />
          <input
            type="range"
            aria-label="Timeline position"
            min={start}
            max={end}
            step={1000}
            value={t}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
          <div className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-accent shadow" style={{ left: `${((t - start) / span) * 100}%` }} />
        </div>
      </div>
      <div className="hidden sm:block">
        <select aria-label="Playback speed" value={speed} onChange={(e) => onSpeed(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-surface px-2 text-[12.5px] font-bold">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <IconButton label={`Speed ${speed}×`} className={cx('sm:hidden')} onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!)}>
        <span className="text-[11px] font-extrabold">{speed}×</span>
      </IconButton>
    </div>
  );
}
