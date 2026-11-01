import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { ArrowLeft, Flag, Info, Trash2, CircleDot, PauseCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { clock, coords, formatDistance, formatDuration, formatSpeed, speedUnit, speedValue } from '@/lib/format';
import { useLive, useUser } from '@/lib/queries';
import type { TripDetail } from '@/lib/types';
import { Avatar, Badge, Button, Card, ErrorNote, Skeleton, Stat } from '@/components/ui';
import { AreaChart } from '@/components/charts';
import { MapView } from '@/features/map/MapView';
import { HtmlMarker, RouteLayer } from '@/features/map/layers';
import { MODE_META, tripTitle } from '@/features/trips/TripRow';

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

  const series = useMemo(
    () =>
      (trip?.samples ?? []).map((s) => ({
        t: Date.parse(s.t),
        v: s.speed == null ? null : speedValue(s.speed, units),
        dim: s.source === 'derived',
      })),
    [trip?.samples, units],
  );

  if (isLoading) return <div className="mx-auto max-w-5xl space-y-4 p-6"><Skeleton className="h-[360px]" /><Skeleton className="h-40" /></div>;
  if (error || !trip) return <div className="mx-auto max-w-5xl p-6"><ErrorNote error={error ?? new Error('Trip not found')} /></div>;

  const Mode = MODE_META[trip.mode].icon;
  const { from, to } = tripTitle(trip);
  const first = trip.route[0];
  const last = trip.route[trip.route.length - 1];
  const hoverSample = hover != null ? trip.samples[hover] : null;
  const estimatedShare = trip.samples.filter((s) => s.source === 'derived').length / Math.max(1, trip.samples.length);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <Link to="/trips" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Trips
      </Link>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-accent text-white">
          <Mode className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">
              {from} → {to}
            </h1>
            {trip.status === 'in_progress' && <Badge tone="accent">In progress</Badge>}
            {trip.lowConfidence && <Badge tone="warning">Low confidence</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[14px] text-muted">
            {person && <Avatar name={person.displayName} color={person.avatarColor} url={person.avatarUrl} size={20} />}
            {person?.displayName} · {format(new Date(trip.startedAt), 'EEEE, MMMM d · h:mm a')}
            {trip.endedAt && ` – ${clock(trip.endedAt)}`} · {MODE_META[trip.mode].label} (estimated)
          </div>
        </div>
        {trip.userId === me.id && trip.status === 'completed' && (
          <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={() => window.confirm('Delete this trip? The underlying location history is kept.') && del.mutate()}>
            Delete trip
          </Button>
        )}
      </div>

      <Card className="mb-5 overflow-hidden p-0">
        <MapView className="h-[340px] sm:h-[420px]" onReady={setMap}>
          {map && <RouteLayer map={map} id="trip" coords={trip.route} />}
          {map && first && (
            <HtmlMarker map={map} lon={first[0]} lat={first[1]}>
              <div className="flex size-7 items-center justify-center rounded-full border-[3px] border-white bg-[#FFB547] shadow-lg">
                <CircleDot className="size-3.5 text-white" />
              </div>
            </HtmlMarker>
          )}
          {map && last && trip.status === 'completed' && (
            <HtmlMarker map={map} lon={last[0]} lat={last[1]}>
              <div className="flex size-7 items-center justify-center rounded-full border-[3px] border-white bg-[#E5384A] shadow-lg">
                <Flag className="size-3.5 text-white" />
              </div>
            </HtmlMarker>
          )}
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
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3">
            <Stat label="Distance" value={formatDistance(trip.distanceM, units)} />
            <Stat label="Duration" value={formatDuration(trip.durationSec)} sub={`${formatDuration(trip.movingSec)} moving`} />
            <Stat label="Max speed" value={formatSpeed(trip.maxSpeed, units)} sub="spike-filtered" />
            <Stat label="Avg moving" value={formatSpeed(trip.avgMovingSpeed, units)} />
            <Stat label="Avg overall" value={formatSpeed(trip.avgSpeed, units)} sub="incl. stops" />
            <Stat label="Stops" value={trip.stops.length} sub={`${trip.pointCount} GPS points`} />
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">Speed</h2>
              <span className="text-[12px] text-muted">{speedUnit(units)}</span>
            </div>
            <AreaChart points={series} height={200} format={(v) => v.toFixed(0)} timeFormat={(t) => format(t, 'h:mm a')} onHover={setHover} />
            {estimatedShare > 0.3 && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
                <Info className="size-3.5" /> Some speeds are estimated from the distance between points because the device didn’t report GPS speed.
              </p>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-bold">Route</h2>
            <ol className="space-y-3 text-[13.5px]">
              <li className="flex gap-3">
                <span className="mt-1 size-2.5 shrink-0 rounded-full bg-[#FFB547]" />
                <div>
                  <div className="font-bold">{trip.startLabel ?? coords(trip.startLat, trip.startLon)}</div>
                  <div className="text-muted">Departed {clock(trip.startedAt)}</div>
                </div>
              </li>
              {trip.stops.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1 size-2.5 shrink-0 rounded-full bg-ink-2" />
                  <div>
                    <div className="font-semibold">Stop · {formatDuration(s.durationSec)}</div>
                    <div className="text-muted">
                      {clock(s.arrivedAt)} – {clock(s.departedAt)}
                    </div>
                  </div>
                </li>
              ))}
              <li className="flex gap-3">
                <span className="mt-1 size-2.5 shrink-0 rounded-full bg-[#E5384A]" />
                <div>
                  <div className="font-bold">{trip.status === 'in_progress' ? 'Still travelling' : (trip.endLabel ?? coords(trip.endLat, trip.endLon))}</div>
                  {trip.endedAt && <div className="text-muted">Arrived {clock(trip.endedAt)}</div>}
                </div>
              </li>
            </ol>
          </Card>
          {trip.lowConfidence && (
            <div className="flex gap-2.5 rounded-2xl bg-warning/10 p-4 text-[13px] leading-relaxed text-ink-2">
              <Info className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>This trip had sparse or imprecise GPS data (for example, the app was in the background). Distance and speeds may be underestimated.</span>
            </div>
          )}
          <p className="px-1 text-[12px] leading-relaxed text-muted">
            Nodara reports speeds measured by GPS. It does not score driving behaviour — phone GPS alone can't reliably detect harsh braking or phone use.
          </p>
        </div>
      </div>
    </div>
  );
}
