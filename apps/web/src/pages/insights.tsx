import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { useLive, useUser } from '@/lib/queries';
import type { Insights, Totals } from '@/lib/types';
import { Avatar, Card, cx, ErrorNote, IconButton, Segmented, Skeleton } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { M_PER_MILE } from '@nodara/shared';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function InsightsPage() {
  const me = useUser();
  const units = me.preferences.units;
  const [params, setParams] = useSearchParams();
  const memberId = params.get('member') ?? me.id;
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<'driving' | 'all'>('driving');
  const { data: members = [] } = useLive(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['trips', 'insights', memberId, period, offset, mode],
    queryFn: () => api.get<Insights>(`/api/insights${qs({ userId: memberId, period, offset, tz, mode })}`),
  });

  const distUnit = units === 'imperial' ? M_PER_MILE : 1000;
  const rangeLabel = data
    ? period === 'year'
      ? format(parseISO(data.start), 'yyyy')
      : period === 'month'
        ? format(parseISO(data.start), 'MMMM yyyy')
        : `${format(parseISO(data.start), 'MMM d')} – ${format(new Date(parseISO(data.end).getTime() - 1), 'MMM d')}`
    : '';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <Link to="/trips" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Trips
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">{mode === 'driving' ? 'Driving insights' : 'Travel insights'}</h1>
          <p className="mt-1 text-[14px] text-muted">Totals and trends from detected trips.</p>
        </div>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'driving', label: 'Driving' }, { value: 'all', label: 'All trips' }]} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => setParams(m.id === me.id ? {} : { member: m.id })}
              className={cx('flex shrink-0 items-center gap-2 rounded-xl border py-1.5 pr-3 pl-1.5 text-[13px] font-semibold', m.id === memberId ? 'border-accent bg-accent-soft' : 'border-line bg-surface text-ink-2')}
            >
              <Avatar name={m.displayName} color={m.avatarColor} size={24} />
              {m.id === me.id ? 'You' : m.displayName.split(' ')[0]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            size="sm"
            value={period}
            onChange={(p) => {
              setPeriod(p);
              setOffset(0);
            }}
            options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]}
          />
          <div className="flex items-center rounded-xl border border-line bg-surface">
            <IconButton label="Previous period" onClick={() => setOffset((o) => o + 1)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="min-w-[120px] text-center text-[13px] font-bold">{rangeLabel}</span>
            <IconButton label="Next period" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
        </div>
      </div>

      <ErrorNote error={error} />
      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Metric label="Total distance" cur={data.current.distanceM} prev={data.previous.distanceM} fmt={(v) => formatDistance(v, units)} />
            <Metric label={mode === 'driving' ? 'Driving time' : 'Travel time'} cur={data.current.durationSec} prev={data.previous.durationSec} fmt={formatDuration} />
            <Metric label="Trips" cur={data.current.trips} prev={data.previous.trips} fmt={(v) => String(v)} />
            <Metric label="Avg trip distance" cur={data.current.avgTripDistanceM} prev={data.previous.avgTripDistanceM} fmt={(v) => formatDistance(v, units)} />
            <Metric label="Avg moving speed" cur={data.current.avgSpeed} prev={data.previous.avgSpeed} fmt={(v) => formatSpeed(v, units)} />
            <Metric label="Max recorded speed" cur={data.current.maxSpeed} prev={data.previous.maxSpeed} fmt={(v) => formatSpeed(v, units)} neutral />
          </div>
          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-5">
              <h2 className="mb-4 text-[15px] font-bold">Distance by {period === 'year' ? 'month' : 'day'}</h2>
              <BarChart
                highlightLast={offset === 0}
                data={data.buckets.map((b) => ({
                  label: format(parseISO(b.date), period === 'year' ? 'MMM' : period === 'month' ? 'd' : 'EEE'),
                  value: b.distanceM / distUnit,
                  tooltip: `${format(parseISO(b.date), period === 'year' ? 'MMMM' : 'EEE, MMM d')} · ${formatDistance(b.distanceM, units)} · ${b.trips} trips`,
                }))}
                format={(v) => (v >= 100 ? v.toFixed(0) : v.toFixed(v < 10 ? 1 : 0))}
              />
            </Card>
            <Card className="p-5">
              <h2 className="mb-4 text-[15px] font-bold">Time by {period === 'year' ? 'month' : 'day'}</h2>
              <BarChart
                data={data.buckets.map((b) => ({
                  label: format(parseISO(b.date), period === 'year' ? 'MMM' : period === 'month' ? 'd' : 'EEE'),
                  value: b.durationSec / 60,
                  tooltip: `${format(parseISO(b.date), period === 'year' ? 'MMMM' : 'EEE, MMM d')} · ${formatDuration(b.durationSec)}`,
                }))}
                format={(v) => `${Math.round(v)}m`}
              />
            </Card>
          </div>
          <p className="mt-5 flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" /> {data.note}
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, cur, prev, fmt, neutral }: { label: string; cur: number | null; prev: number | null; fmt: (v: number) => string; neutral?: boolean }) {
  const delta = cur != null && prev ? (cur - prev) / prev : null;
  return (
    <Card className="p-4">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-1.5 text-[24px] font-extrabold tracking-tight">{cur != null ? fmt(cur) : '—'}</div>
      <div className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-muted">
        {delta != null && Number.isFinite(delta) ? (
          <span className={cx('inline-flex items-center', !neutral && (delta >= 0 ? 'text-ink-2' : 'text-ink-2'))}>
            {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(Math.round(delta * 100))}%
          </span>
        ) : null}
        <span>vs. previous ({prev != null ? fmt(prev) : '—'})</span>
      </div>
    </Card>
  );
}
