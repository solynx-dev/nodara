import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { Activity, Car, ChevronLeft, Footprints, Users, Clock, Flag, FlagTriangleRight, Gauge, Info, Milestone, OctagonAlert, PauseCircle, Smartphone, Trash2, TriangleAlert, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { clock, coords, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { useLive, useUser } from '@/lib/queries';
import type { TripDetail } from '@/lib/types';
import { Avatar, cx, ErrorNote, Segmented, Skeleton, StatCard, StatusPill } from '@/components/ui';
import { MapView } from '@/features/map/MapView';
import { HtmlMarker, RouteLayer } from '@/features/map/layers';
import { tripKind, tripTitle } from '@/features/trips/TripRow';

export default function TripPage() {
  const { id = '' } = useParams();
  const me = useUser();
  const units = me.preferences.units;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: trip, isLoading, error } = useQuery({
    queryKey: ['trips', 'detail', id],
    queryFn: () => api.get<TripDetail>(`/api/trips/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'in_progress' ? 15_000 : false),
  });
  const { data: members = [] } = useLive(null);
  const person = members.find((m) => m.id === trip?.userId);
  const [map, setMap] = useState<MLMap | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const edit = useMutation({
    mutationFn: (k: TripKind) => api.patch<Partial<TripDetail>>(`/api/trips/${id}`, k === 'walk' ? { mode: 'walking' } : { mode: 'driving', role: k }),
    onSuccess: (updated) => {
      qc.setQueryData<TripDetail>(['trips', 'detail', id], (old) => (old ? { ...old, ...updated } : old));
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/trips/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      navigate('/trips');
    },
  });

  useEffect(() => {
    if (!map || !trip?.route.length) return;
    const b = new maplibregl.LngLatBounds();
    trip.route.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 60 }, maxZoom: 16, duration: 0 });
  }, [map, trip?.route]);

  if (isLoading) return <div className="mx-auto max-w-5xl space-y-4 p-6"><Skeleton className="h-[360px]" /><Skeleton className="h-40" /></div>;
  if (error || !trip) return <div className="mx-auto max-w-5xl p-6"><ErrorNote error={error ?? new Error('Trip not found')} /></div>;

  const { from, to } = tripTitle(trip);
  const first = trip.route[0];
  const last = trip.route[trip.route.length - 1];
  const hoverSample = hover != null ? trip.samples[hover] : null;
  const estimatedShare = trip.samples.filter((s) => s.source === 'derived').length / Math.max(1, trip.samples.length);
  const events = trip.events ?? [];
  const kind: TripKind = trip.mode === 'walking' ? 'walk' : trip.role === 'passenger' ? 'passenger' : 'driver';
  const who = person ? (person.id === me.id ? 'You' : person.displayName) : '';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/trips" className="flex size-11 items-center justify-center rounded-full bg-surface shadow-card transition hover:bg-surface-2" aria-label="Back to trips">
          <ChevronLeft className="size-5" />
        </Link>
        <span className="text-[17px] font-semibold">Trip report</span>
        {trip.userId === me.id && trip.status === 'completed' ? (
          <button
            onClick={() => window.confirm('Delete this trip? The underlying location history is kept.') && del.mutate()}
            className="flex size-11 items-center justify-center rounded-full bg-surface text-danger shadow-card transition hover:bg-surface-2"
            aria-label="Delete trip"
            title="Delete trip"
          >
            <Trash2 className="size-[18px]" />
          </button>
        ) : (
          <span className="size-11" />
        )}
      </div>

      <div className="card mb-5 overflow-hidden p-0">
        <MapView className="h-[300px] sm:h-[380px]" onReady={setMap}>
          {map && <RouteLayer map={map} id="trip" coords={trip.route} />}
          {map && first && (
            <HtmlMarker map={map} lon={first[0]} lat={first[1]}>
              <div className="flex size-9 items-center justify-center rounded-full border-[3px] border-white bg-success shadow-lg">
                <Flag className="size-4 text-white" />
              </div>
            </HtmlMarker>
          )}
          {map && last && trip.status === 'completed' && (
            <HtmlMarker map={map} lon={last[0]} lat={last[1]}>
              <div className="flex size-9 items-center justify-center rounded-full border-[3px] border-white bg-danger shadow-lg">
                <FlagTriangleRight className="size-4 text-white" />
              </div>
            </HtmlMarker>
          )}
          {map &&
            events.map((e) => {
              const m = EVENT_META[e.kind];
              return (
                <HtmlMarker key={e.id} map={map} lon={e.lon} lat={e.lat}>
                  <div title={m.label} className="flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow" style={{ background: m.color }}>
                    <m.icon className="size-3.5" />
                  </div>
                </HtmlMarker>
              );
            })}
          {map &&
            trip.stops.map((s, i) => (
              <HtmlMarker key={i} map={map} lon={s.lon} lat={s.lat}>
                <div title={`Stopped ${formatDuration(s.durationSec)}`} className="flex size-6 items-center justify-center rounded-full border-2 border-white bg-ink text-bg shadow">
                  <PauseCircle className="size-3.5" />
                </div>
              </HtmlMarker>
            ))}
          {map && hoverSample && (
            <HtmlMarker map={map} lon={hoverSample.lon} lat={hoverSample.lat}>
              <div className="size-4 rounded-full border-[3px] border-white bg-accent shadow-lg" />
            </HtmlMarker>
          )}
        </MapView>
      </div>

      <div className="mb-5 px-1">
        <div className="flex items-center gap-2 text-[16px] text-muted">
          {person && <Avatar name={person.displayName} color={person.avatarColor} url={person.avatarUrl} size={26} />}
          {who && `${who} · `}
          {format(new Date(trip.startedAt), 'EEEE, MMMM d')}
        </div>
        <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tight sm:text-[34px]">
          {from} <span className="text-muted">→</span> {to}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusPill tone="info" icon={(() => { const M = tripKind(trip).icon; return <M />; })()}>
            {tripKind(trip).label}
            {!trip.modeEdited && !trip.role && ' (detected)'}
          </StatusPill>
          {trip.status === 'in_progress' && <StatusPill tone="accent">In progress</StatusPill>}
          {trip.lowConfidence && <StatusPill tone="warning" icon={<TriangleAlert />}>Low GPS quality</StatusPill>}
        </div>
      </div>

      {trip.userId === me.id && trip.status === 'completed' && (
        <div className="card mb-5 space-y-3 p-5">
          <h2 className="text-[20px] font-bold tracking-tight">What was this trip?</h2>
          <Segmented
            className="w-full"
            value={kind}
            onChange={(k) => edit.mutate(k)}
            options={[
              { value: 'driver', label: 'I drove', icon: <Car className="size-4" /> },
              { value: 'passenger', label: 'Passenger', icon: <Users className="size-4" /> },
              { value: 'walk', label: 'Walk', icon: <Footprints className="size-4" /> },
            ]}
          />
          <p className="text-[14px] text-muted">Only drives where you were driving count in driving reports, so phone use as a passenger doesn’t count against you.</p>
          <ErrorNote error={edit.error} />
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3">
        <StatCard icon={<Milestone />} label="Distance" value={formatDistance(trip.distanceM, units)} />
        <StatCard icon={<Clock />} label="Duration" value={formatDuration(trip.durationSec)} sub={`${formatDuration(trip.movingSec)} moving`} />
        <StatCard icon={<Gauge />} label="Top speed" value={formatSpeed(trip.maxSpeed, units)} sub="Spikes filtered out" />
        <StatCard icon={<Activity />} label="Average" value={formatSpeed(trip.avgMovingSpeed, units)} sub="While moving" />
      </div>

      <div className="card mb-5 p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[20px] font-bold tracking-tight">Speed</h2>
          <span className="tnum text-[15px] text-muted">peak {formatSpeed(Math.max(0, ...trip.samples.map((s) => s.speed ?? 0)), units)}</span>
        </div>
        <SpeedBars samples={trip.samples} units={units} onHover={setHover} />
        <div className="mt-2 flex justify-between text-[13px] text-muted">
          <span>{clock(trip.startedAt)}</span>
          <span>dashed line = average</span>
          <span>{trip.endedAt ? clock(trip.endedAt) : 'now'}</span>
        </div>
        {estimatedShare > 0.3 && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
            <Info className="size-3.5 shrink-0" /> Some speeds are estimated from the distance between points because the device didn’t report GPS speed.
          </p>
        )}
      </div>

      {trip.role === 'passenger' && (
        <div className="card mb-5 flex items-center gap-3 p-5 text-[15px]">
          <Users className="size-5 shrink-0 text-info" /> You were a passenger, so nothing on this trip counts in your driving report.
        </div>
      )}
      {events.length > 0 && trip.role !== 'passenger' && (
        <div className="card mb-5 p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[20px] font-bold tracking-tight">Driving events</h2>
            <span className="text-[15px] text-muted">{events.length} on this trip</span>
          </div>
          <div className="space-y-2.5">
            {events.map((e) => {
              const m = EVENT_META[e.kind];
              return (
                <div key={e.id} className="flex items-center gap-3.5 rounded-[20px] bg-surface-2 px-4 py-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${m.color} 18%, transparent)`, color: m.color }}>
                    <m.icon className="size-5" />
                  </span>
                  <div>
                    <div className="text-[16px] font-semibold">{m.label}</div>
                    <div className="text-[14px] text-muted">
                      {clock(e.startedAt)}
                      {e.speed != null && ` · ${e.kind === 'speeding' ? 'Up to' : 'at'} ${formatSpeed(e.speed, units)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card mb-5 p-5">
        <h2 className="mb-4 text-[20px] font-bold tracking-tight">Route</h2>
        <ol className="space-y-4 text-[15px]">
          <li className="flex gap-3">
            <span className="mt-1.5 size-3 shrink-0 rounded-full bg-success" />
            <div>
              <div className="font-semibold">{trip.startLabel ?? coords(trip.startLat, trip.startLon)}</div>
              <div className="text-muted">Departed {clock(trip.startedAt)}</div>
            </div>
          </li>
          {trip.stops.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1.5 size-3 shrink-0 rounded-full bg-muted" />
              <div>
                <div className="font-semibold">Stop · {formatDuration(s.durationSec)}</div>
                <div className="text-muted">
                  {clock(s.arrivedAt)} – {clock(s.departedAt)}
                </div>
              </div>
            </li>
          ))}
          <li className="flex gap-3">
            <span className="mt-1.5 size-3 shrink-0 rounded-full bg-danger" />
            <div>
              <div className="font-semibold">{trip.status === 'in_progress' ? 'Still travelling' : (trip.endLabel ?? coords(trip.endLat, trip.endLon))}</div>
              {trip.endedAt && <div className="text-muted">Arrived {clock(trip.endedAt)}</div>}
            </div>
          </li>
        </ol>
      </div>

      {trip.lowConfidence && (
        <div className="mb-5 flex gap-2.5 rounded-[22px] bg-warning/12 p-4 text-[14px] leading-relaxed">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>This trip had sparse or imprecise GPS data (for example, the app was in the background). Distance and speeds may be underestimated.</span>
        </div>
      )}
      <p className="px-1 text-[13px] leading-relaxed text-muted">
        {trip.pointCount} GPS points · average {formatSpeed(trip.avgSpeed, units)} including stops. Speeds come from GPS; driving events are estimates, not an insurance-grade score.
      </p>
    </div>
  );
}

type TripKind = 'driver' | 'passenger' | 'walk';

const EVENT_META = {
  speeding: { label: 'Speeding', icon: Gauge, color: 'var(--danger)' },
  hard_brake: { label: 'Hard braking', icon: OctagonAlert, color: 'var(--warning)' },
  rapid_accel: { label: 'Rapid acceleration', icon: Zap, color: 'var(--brand-violet)' },
  phone_use: { label: 'Phone use', icon: Smartphone, color: 'var(--info)' },
} as const;

/** Speed as bars over the trip, like the iOS report, with a dashed average line and hover readout. */
function SpeedBars({ samples, units, onHover }: { samples: TripDetail['samples']; units: 'metric' | 'imperial'; onHover: (i: number | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = samples.map((s) => s.speed ?? 0);
  const peak = Math.max(1, ...values);
  const moving = values.filter((v) => v > 1);
  const avg = moving.length ? moving.reduce((a, b) => a + b, 0) / moving.length : 0;
  // At most ~90 bars, so each stays visible.
  const step = Math.max(1, Math.ceil(samples.length / 90));
  const bars = [];
  for (let i = 0; i < samples.length; i += step) {
    const slice = values.slice(i, i + step);
    bars.push({ i, v: Math.max(...slice), derived: samples[i]!.source === 'derived' });
  }
  const set = (i: number | null) => {
    setHover(i);
    onHover(i);
  };
  return (
    <div className="relative h-[200px]" onMouseLeave={() => set(null)}>
      <div className="absolute inset-0 flex items-end gap-[2px]">
        {bars.map((b) => (
          <div
            key={b.i}
            onMouseEnter={() => set(b.i)}
            className={cx('min-w-0 flex-1 rounded-t-[3px] transition-opacity', b.derived ? 'bg-accent/45' : 'bg-accent', hover != null && hover !== b.i && 'opacity-60')}
            style={{ height: `${Math.max(0.5, (b.v / peak) * 100)}%` }}
          />
        ))}
      </div>
      {avg > 0 && <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted/70" style={{ bottom: `${(avg / peak) * 100}%` }} />}
      {hover != null && samples[hover] && (
        <div className="tnum pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-full bg-elevated px-3 py-1 text-[13px] font-semibold shadow-float">
          {clock(samples[hover]!.t)} · {formatSpeed(samples[hover]!.speed, units)}
        </div>
      )}
    </div>
  );
}
