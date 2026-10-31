import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { addDays, endOfDay, endOfMonth, endOfWeek, format, isSameDay, parseISO, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { ChevronLeft, ChevronRight, Download, EyeOff, Home, MapPin, Navigation, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { clock, coords, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { useLive, useUser } from '@/lib/queries';
import type { HistoryDay, HistoryPoints, LocationFix, TimelineItem } from '@/lib/types';
import { Avatar, Button, Card, cx, EmptyState, ErrorNote, IconButton, Segmented, Skeleton, Spinner } from '@/components/ui';
import { MapView } from '@/features/map/MapView';
import { HtmlMarker, PointsLayer, RouteLayer } from '@/features/map/layers';
import { HistoryCalendar } from '@/features/history/Calendar';
import { PlaybackBar, usePlaybackClock } from '@/features/history/Playback';
import { MODE_META, tripTitle } from '@/features/trips/TripRow';
import { BatteryIndicator } from '@/features/members/MemberRow';

type Range = 'day' | 'week' | 'month';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function HistoryPage() {
  const me = useUser();
  const units = me.preferences.units;
  const [params, setParams] = useSearchParams();
  const memberId = params.get('member') ?? me.id;
  const date = params.get('date') ? parseISO(params.get('date')!) : startOfDay(new Date());
  const range = (params.get('range') as Range) ?? 'day';
  const [month, setMonth] = useState(startOfMonth(date));
  const { data: members = [] } = useLive(null);
  const member = members.find((m) => m.id === memberId);

  const set = (p: Record<string, string>) => setParams((prev) => ({ ...Object.fromEntries(prev), ...p }), { replace: true });

  const [from, to] = useMemo(() => {
    if (range === 'week') return [startOfWeek(date), endOfWeek(date)];
    if (range === 'month') return [startOfMonth(date), endOfMonth(date)];
    return [startOfDay(date), endOfDay(date)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, date.getTime()]);

  const days = useQuery({
    queryKey: ['history-days', memberId, month.toISOString()],
    queryFn: () => api.get<HistoryDay[]>(`/api/history/${memberId}/days${qs({ from: startOfWeek(startOfMonth(month)).toISOString(), to: endOfWeek(endOfMonth(month)).toISOString(), tz })}`),
  });
  const points = useQuery({
    queryKey: ['history-points', memberId, from.toISOString(), to.toISOString()],
    queryFn: () => api.get<HistoryPoints>(`/api/history/${memberId}/points${qs({ from: from.toISOString(), to: to.toISOString(), maxPoints: range === 'day' ? 4000 : 5000 })}`),
  });
  const timeline = useQuery({
    queryKey: ['history-timeline', memberId, from.toISOString(), to.toISOString()],
    enabled: range !== 'month',
    queryFn: () => api.get<{ items: TimelineItem[] }>(`/api/history/${memberId}/timeline${qs({ from: from.toISOString(), to: to.toISOString() })}`),
  });

  const pts = points.data?.points ?? [];
  const [map, setMap] = useState<MLMap | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);

  // Playback state
  const startT = pts.length ? Date.parse(pts[0]!.recordedAt) : from.getTime();
  const endT = pts.length ? Date.parse(pts[pts.length - 1]!.recordedAt) : from.getTime();
  const [t, setT] = useState(endT);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(range === 'day' ? 300 : 3600);
  useEffect(() => {
    setT(endT);
    setPlaying(false);
    setSelectedTrip(null);
    setInspect(null);
  }, [endT, memberId]);
  const stop = useCallback(() => setPlaying(false), []);
  usePlaybackClock(playing, speed, t, setT, endT, stop);

  const allCoords = useMemo(() => pts.map((p) => [p.lon, p.lat] as [number, number]), [pts]);
  const headIdx = useMemo(() => {
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (Date.parse(pts[mid]!.recordedAt) <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [pts, t]);
  const head = useMemo(() => {
    const a = pts[headIdx];
    const b = pts[headIdx + 1];
    if (!a) return null;
    if (!b) return { lat: a.lat, lon: a.lon, fix: a };
    const ta = Date.parse(a.recordedAt);
    const tb = Date.parse(b.recordedAt);
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, fix: a };
  }, [pts, headIdx, t]);
  const progressCoords = useMemo(() => (head ? [...allCoords.slice(0, headIdx + 1), [head.lon, head.lat] as [number, number]] : []), [allCoords, headIdx, head]);
  const scrubbing = t < endT;

  // Fit to data
  useEffect(() => {
    if (!map || pts.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach((p) => b.extend([p.lon, p.lat]));
    map.fitBounds(b, { padding: 70, maxZoom: 15, duration: 500 });
  }, [map, pts]);

  const focusTrip = (item: Extract<TimelineItem, { type: 'trip' }>) => {
    setSelectedTrip(item.trip.id);
    const s = Date.parse(item.trip.startedAt);
    const e = item.trip.endedAt ? Date.parse(item.trip.endedAt) : Date.now();
    const inTrip = pts.filter((p) => {
      const pt = Date.parse(p.recordedAt);
      return pt >= s && pt <= e;
    });
    if (map && inTrip.length) {
      const b = new maplibregl.LngLatBounds();
      inTrip.forEach((p) => b.extend([p.lon, p.lat]));
      map.fitBounds(b, { padding: 80, maxZoom: 16, duration: 600 });
    }
    setT(s);
    setSpeed(60);
    setPlaying(true);
  };
  const focusStay = (item: Extract<TimelineItem, { type: 'stay' }>) => {
    map?.flyTo({ center: [item.lon, item.lat], zoom: 16 });
    setT(Date.parse(item.startAt));
    setPlaying(false);
  };

  const shift = (dir: 1 | -1) => {
    const step = range === 'day' ? 1 : range === 'week' ? 7 : 30;
    const next = addDays(date, dir * step);
    set({ date: format(next, 'yyyy-MM-dd') });
    setMonth(startOfMonth(next));
  };

  const trips = timeline.data?.items.filter((i): i is Extract<TimelineItem, { type: 'trip' }> => i.type === 'trip') ?? [];
  const marks = trips.map((i) => ({ start: Date.parse(i.trip.startedAt), end: i.trip.endedAt ? Date.parse(i.trip.endedAt) : endT }));
  const isToday = isSameDay(date, new Date()) && range === 'day';
  const denied = points.error && (points.error as { status?: number }).status === 404;

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      {/* Left column */}
      <aside className="order-2 w-full shrink-0 border-line lg:order-1 lg:w-[380px] lg:overflow-y-auto lg:border-r">
        <div className="space-y-5 p-4 sm:p-5">
          <div className="hidden lg:block">
            <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">History</h1>
            <p className="text-[13px] text-muted">Every place, every trip — kept on your server for as long as you want.</p>
          </div>
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => set({ member: m.id })}
                className={cx('flex shrink-0 items-center gap-2 rounded-xl border py-1.5 pr-3 pl-1.5 text-[13px] font-semibold transition', m.id === memberId ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}
              >
                <Avatar name={m.displayName} color={m.avatarColor} size={24} />
                {m.id === me.id ? 'You' : m.displayName.split(' ')[0]}
              </button>
            ))}
          </div>
          <Card className="p-4">
            <HistoryCalendar
              month={month}
              onMonth={setMonth}
              selected={date}
              onSelect={(d) => set({ date: format(d, 'yyyy-MM-dd') })}
              days={days.data ?? []}
            />
          </Card>
          {points.data?.visibleSince && (
            <div className="flex gap-2 rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted">
              <EyeOff className="mt-0.5 size-4 shrink-0" />
              You can see {member?.displayName.split(' ')[0] ?? 'their'}’s history from {format(new Date(points.data.visibleSince), 'MMM d, yyyy h:mm a')} — when they began sharing with your circle.
            </div>
          )}
          <Timeline items={timeline.data?.items} loading={timeline.isLoading} range={range} selectedTrip={selectedTrip} onTrip={focusTrip} onStay={focusStay} units={units} />
        </div>
      </aside>

      {/* Map */}
      <section className="relative order-1 h-[52vh] shrink-0 lg:order-2 lg:h-auto lg:flex-1">
        <MapView className="absolute inset-0" onReady={setMap}>
          {map && allCoords.length > 1 && <RouteLayer map={map} id="hist-all" coords={allCoords} color="#8A93A3" gradient={false} width={3} />}
          {map && scrubbing && progressCoords.length > 1 && <RouteLayer map={map} id="hist-progress" coords={progressCoords} />}
          {map && !scrubbing && allCoords.length > 1 && <RouteLayer map={map} id="hist-progress" coords={allCoords} />}
          {map && range === 'day' && <PointsLayer map={map} points={pts.map((p) => ({ id: p.id, lon: p.lon, lat: p.lat }))} onClick={setInspect} />}
          {map && head && member && (
            <HtmlMarker map={map} lon={head.lon} lat={head.lat}>
              <div className="relative">
                {playing && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-accent" />}
                <Avatar name={member.displayName} color={member.avatarColor} size={36} className="border-[3px] border-white shadow-lg" />
              </div>
            </HtmlMarker>
          )}
        </MapView>

        {/* Range header */}
        <div className="safe-top absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-2xl border border-line bg-elevated/95 p-1 shadow-card backdrop-blur">
            <IconButton label="Previous" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <div className="min-w-[140px] px-1 text-center text-[14px] font-bold">
              {range === 'day' ? (isToday ? 'Today' : format(date, 'EEE, MMM d')) : range === 'week' ? `${format(from, 'MMM d')} – ${format(to, 'MMM d')}` : format(date, 'MMMM yyyy')}
            </div>
            <IconButton label="Next" onClick={() => shift(1)} disabled={to.getTime() >= Date.now()}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
          <Segmented
            size="sm"
            className="border border-line shadow-card"
            value={range}
            onChange={(r) => set({ range: r })}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
          />
          {memberId === me.id && (
            <a href={`/api/me/export${qs({ format: 'gpx', from: from.toISOString(), to: to.toISOString() })}`} className="ml-auto" download>
              <Button size="sm" icon={<Download className="size-4" />} className="shadow-card">
                GPX
              </Button>
            </a>
          )}
        </div>

        {/* Day stats */}
        {points.data && pts.length > 0 && (
          <div className="absolute top-[68px] left-3 z-10 hidden gap-2 sm:flex">
            <StatChip label="Distance" value={formatDistance(points.data.distanceM, units)} />
            <StatChip label="Trips" value={String(trips.length)} />
            <StatChip label="Points" value={points.data.total.toLocaleString()} sub={points.data.decimated ? 'simplified' : undefined} />
          </div>
        )}

        {points.isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <Spinner className="size-7" />
          </div>
        )}
        {!points.isLoading && pts.length === 0 && (
          <div className="absolute inset-x-4 top-1/2 z-10 mx-auto max-w-sm -translate-y-1/2 rounded-3xl border border-line bg-elevated/95 shadow-float backdrop-blur">
            {denied ? (
              <EmptyState icon={<EyeOff className="size-7" />} title="History not shared" body="This person isn't sharing history with any of your circles." />
            ) : (
              <EmptyState icon={<MapPin className="size-7" />} title="No locations recorded" body={isToday && memberId === me.id ? 'Share your location and your day will build up here.' : 'Nothing was recorded for this period.'} />
            )}
          </div>
        )}

        {inspect && <PointInspector userId={memberId} id={inspect} onClose={() => setInspect(null)} units={units} />}

        {pts.length > 1 && (
          <div className="absolute inset-x-3 bottom-3 z-10 lg:right-6 lg:left-6">
            <PlaybackBar start={startT} end={endT} t={t} onSeek={(x) => setT(x)} playing={playing} onToggle={() => setPlaying((p) => !p)} speed={speed} onSpeed={setSpeed} marks={marks} />
          </div>
        )}
      </section>
    </div>
  );
}

function StatChip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-elevated/95 px-3 py-1.5 shadow-card backdrop-blur">
      <div className="eyebrow text-[9.5px]">{label}</div>
      <div className="tnum text-[14px] font-bold">
        {value} {sub && <span className="text-[10.5px] font-semibold text-muted">{sub}</span>}
      </div>
    </div>
  );
}

function Timeline({
  items,
  loading,
  range,
  selectedTrip,
  onTrip,
  onStay,
  units,
}: {
  items: TimelineItem[] | undefined;
  loading: boolean;
  range: Range;
  selectedTrip: string | null;
  onTrip: (i: Extract<TimelineItem, { type: 'trip' }>) => void;
  onStay: (i: Extract<TimelineItem, { type: 'stay' }>) => void;
  units: 'metric' | 'imperial';
}) {
  if (range === 'month') return <p className="text-[13px] text-muted">Pick a day or week to see a detailed timeline.</p>;
  if (loading) return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (!items?.length) return null;
  let lastDay = '';
  return (
    <div>
      <div className="eyebrow mb-3">Timeline</div>
      <ol className="relative">
        <div className="absolute top-3 bottom-3 left-[19px] w-px bg-line-strong" />
        {items.map((item, idx) => {
          const at = item.type === 'stay' ? item.startAt : item.trip.startedAt;
          const day = format(new Date(at), 'EEEE, MMM d');
          const header = range === 'week' && day !== lastDay ? (lastDay = day) : null;
          return (
            <li key={idx}>
              {header && <div className="relative z-10 my-2 ml-11 text-[12px] font-bold text-muted">{header}</div>}
              {item.type === 'stay' ? (
                <button onClick={() => onStay(item)} className="relative flex w-full items-start gap-3 rounded-xl py-2 pr-2 text-left hover:bg-surface-2">
                  <span className="relative z-10 mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
                    {item.placeId ? <Home className="size-4 text-accent" /> : <MapPin className="size-4 text-ink-2" />}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="truncate text-[14.5px] font-bold">{item.label ?? coords(item.lat, item.lon)}</div>
                    <div className="tnum text-[12.5px] text-muted">
                      {clock(item.startAt)} – {clock(item.endAt)} · {formatDuration((Date.parse(item.endAt) - Date.parse(item.startAt)) / 1000)}
                    </div>
                  </div>
                </button>
              ) : (
                <TimelineTrip item={item} selected={selectedTrip === item.trip.id} onClick={() => onTrip(item)} units={units} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TimelineTrip({ item, selected, onClick, units }: { item: Extract<TimelineItem, { type: 'trip' }>; selected: boolean; onClick: () => void; units: 'metric' | 'imperial' }) {
  const t = item.trip;
  const Mode = MODE_META[t.mode].icon;
  const { to } = tripTitle(t);
  return (
    <div className={cx('relative my-1 flex items-start gap-3 rounded-2xl py-2.5 pr-2 transition', selected && 'bg-accent-soft')}>
      <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-white">
        <Mode className="size-4" />
      </span>
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="text-[14px] font-bold">
          {MODE_META[t.mode].label} to <span className="text-ink">{to}</span>
        </div>
        <div className="tnum text-[12.5px] text-muted">
          {clock(t.startedAt)} · {formatDistance(t.distanceM, units)} · {formatDuration(t.durationSec)}
          {t.maxSpeed != null && ` · max ${formatSpeed(t.maxSpeed, units)}`}
        </div>
      </button>
      <Link to={`/trips/${t.id}`} className="self-center rounded-lg px-2 py-1 text-[12px] font-bold text-accent-text hover:bg-surface-2">
        Report
      </Link>
    </div>
  );
}

function PointInspector({ userId, id, onClose, units }: { userId: string; id: string; onClose: () => void; units: 'metric' | 'imperial' }) {
  const { data, error } = useQuery({ queryKey: ['point', userId, id], queryFn: () => api.get<LocationFix & { address: string | null }>(`/api/history/${userId}/points/${id}`) });
  return (
    <div className="absolute top-[68px] right-3 z-20 w-72 animate-rise rounded-2xl border border-line bg-elevated p-4 shadow-float sm:top-[120px]">
      <div className="mb-2 flex items-center justify-between">
        <div className="eyebrow">Location point</div>
        <IconButton label="Close" onClick={onClose} className="-mr-2 size-7">
          <X className="size-4" />
        </IconButton>
      </div>
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="space-y-2 text-[13px]">
          <div className="text-[15px] font-bold">{format(new Date(data.recordedAt), 'h:mm:ss a')}</div>
          <div className="text-ink-2">{data.address ?? coords(data.lat, data.lon)}</div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Mini label="Speed" value={data.speed != null ? formatSpeed(data.speed, units) : '—'} sub={data.speedSource === 'derived' ? 'estimated' : data.speedSource === 'gps' ? 'GPS' : undefined} />
            <Mini label="Accuracy" value={data.accuracy != null ? `±${Math.round(data.accuracy)} m` : '—'} />
            <Mini label="Battery" value={data.battery != null ? <BatteryIndicator level={data.battery} charging={data.charging} /> : '—'} />
            <Mini label="Heading" value={data.heading != null ? <span className="inline-flex items-center gap-1"><Navigation className="size-3.5" style={{ transform: `rotate(${data.heading}deg)` }} />{Math.round(data.heading)}°</span> : '—'} />
          </div>
          <div className="tnum pt-1 text-[11.5px] text-muted">{coords(data.lat, data.lon)}</div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2.5 py-2">
      <div className="eyebrow text-[9.5px]">{label}</div>
      <div className="font-bold">{value}</div>
      {sub && <div className="text-[10.5px] text-muted">{sub}</div>}
    </div>
  );
}
