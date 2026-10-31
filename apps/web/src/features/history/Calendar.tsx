import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isAfter, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HistoryDay } from '@/lib/types';
import { cx, IconButton } from '@/components/ui';

/** Month calendar with a heat tint for days that have location history. */
export function HistoryCalendar({
  month,
  onMonth,
  selected,
  onSelect,
  days,
}: {
  month: Date;
  onMonth: (d: Date) => void;
  selected: Date;
  onSelect: (d: Date) => void;
  days: HistoryDay[];
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const max = Math.max(1, ...days.map((d) => d.distanceM));
  const grid = eachDayOfInterval({ start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) });
  const today = new Date();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[15px] font-bold">{format(month, 'MMMM yyyy')}</div>
        <div className="flex">
          <IconButton label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Next month" onClick={() => onMonth(addMonths(month, 1))} disabled={isSameMonth(month, today)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="pb-1 text-[11px] font-bold text-muted">
            {d}
          </div>
        ))}
        {grid.map((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const info = byDate.get(key);
          const inMonth = isSameMonth(d, month);
          const future = isAfter(d, today);
          const sel = isSameDay(d, selected);
          const heat = info ? 0.12 + 0.55 * Math.min(1, info.distanceM / max) : 0;
          return (
            <button
              key={key}
              disabled={future || !inMonth}
              onClick={() => onSelect(d)}
              title={info ? `${info.points} points · ${info.trips} trips` : 'No data'}
              className={cx(
                'relative flex aspect-square items-center justify-center rounded-xl text-[13px] font-semibold transition',
                !inMonth && 'invisible',
                future && 'text-muted/40',
                sel ? 'bg-accent text-white shadow-[0_6px_16px_-6px_var(--accent)]' : 'hover:bg-surface-2',
                isSameDay(d, today) && !sel && 'ring-1 ring-accent ring-inset',
              )}
              style={!sel && info ? { background: `color-mix(in srgb, var(--accent) ${Math.round(heat * 100)}%, transparent)` } : undefined}
            >
              {format(d, 'd')}
              {info && info.trips > 0 && !sel && <span className="absolute bottom-1 size-1 rounded-full bg-ink/60" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
