import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowRight, BatteryWarning, Clock3, LogIn, LogOut, Map as MapIcon, Route, UserPlus, Users } from 'lucide-react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { api } from '@/lib/api';
import { ago, firstName, freshness } from '@/lib/format';
import { useCircles, useLive, useUser } from '@/lib/queries';
import { useActiveCircle } from '@/lib/circle-context';
import type { PlaceEvent, PlaceWithMeta, Trip } from '@/lib/types';
import { Avatar, Button, Card, EmptyState, SectionHeader, Skeleton } from '@/components/ui';
import { MapView } from '@/features/map/MapView';
import { MembersLayer, PlacesLayer } from '@/features/map/layers';
import { MemberRow } from '@/features/members/MemberRow';
import { StartSharingCard } from '@/features/tracking/StartSharingCard';
import { TripRow } from '@/features/trips/TripRow';
import { PlaceIcon } from '@/features/map/icons';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function OverviewPage() {
  const me = useUser();
  const navigate = useNavigate();
  const { circleId } = useActiveCircle();
  const { data: circles, isLoading: circlesLoading } = useCircles();
  const { data: members = [], isLoading } = useLive(circleId);
  const { data: places = [] } = useQuery({ queryKey: ['places'], queryFn: () => api.get<PlaceWithMeta[]>('/api/places') });
  const { data: events = [] } = useQuery({ queryKey: ['place-events', 'recent'], queryFn: () => api.get<PlaceEvent[]>('/api/place-events?limit=8') });
  const [map, setMap] = useState<MLMap | null>(null);

  const sharingMembers = members.filter((m) => m.location);
  const tripQueries = useQueries({
    queries: members.slice(0, 8).map((m) => ({
      queryKey: ['trips', m.id, 'recent'],
      queryFn: () => api.get<Trip[]>(`/api/trips?userId=${m.id}&limit=4`).catch(() => [] as Trip[]),
    })),
  });
  const recentTrips = useMemo(
    () =>
      tripQueries
        .flatMap((q) => q.data ?? [])
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tripQueries.map((q) => q.dataUpdatedAt).join()],
  );
  const byId = new Map(members.map((m) => [m.id, m]));

  const alerts = [
    ...members
      .filter((m) => m.location?.battery != null && m.location.battery <= 15 && !m.location.charging && freshness(m.location.recordedAt) !== 'old')
      .map((m) => ({ key: `bat-${m.id}`, icon: BatteryWarning, tone: 'text-danger', text: `${firstName(m.displayName)}'s battery is at ${m.location!.battery}%` })),
    ...members
      .filter((m) => m.id !== me.id && m.sharing && m.location && freshness(m.location.recordedAt) === 'stale')
      .map((m) => ({ key: `stale-${m.id}`, icon: Clock3, tone: 'text-warning', text: `${firstName(m.displayName)}'s location is ${ago(m.location!.recordedAt)} old` })),
  ];

  // Fit the preview to everyone once data arrives.
  const fitKey = sharingMembers.map((m) => m.id).join();
  useEffect(() => {
    if (!map || sharingMembers.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    sharingMembers.forEach((m) => b.extend([m.location!.lon, m.location!.lat]));
    map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);

  const noCircles = !circlesLoading && circles?.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{format(new Date(), 'EEEE, MMMM d')}</div>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.03em]">
            {greeting()}, {firstName(me.displayName)}
          </h1>
        </div>
        <Link to="/map" className="hidden sm:block">
          <Button icon={<MapIcon className="size-4" />}>Open map</Button>
        </Link>
      </div>

      <div className="space-y-5">
        <StartSharingCard />

        {noCircles && (
          <Card>
            <EmptyState
              icon={<Users className="size-7" />}
              title="Create your first circle"
              body="Circles are the people you share with — your family, your partner, a travel group. Create one and send an invite link."
              action={
                <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => navigate('/circles?new=1')}>
                  Create a circle
                </Button>
              }
            />
          </Card>
        )}

        {alerts.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {alerts.map((a) => (
              <div key={a.key} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] font-semibold">
                <a.icon className={`size-5 ${a.tone}`} />
                {a.text}
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <Card className="overflow-hidden p-0">
            <Link to="/map" className="group relative block">
              <MapView className="h-[300px] sm:h-[380px]" zoom={11} controls={false} onReady={setMap}>
                {map && <PlacesLayer map={map} places={places} showLabels={false} />}
                {map && <MembersLayer map={map} members={members} selectedId={null} onSelect={(id) => navigate(`/map?member=${id}`)} meId={me.id} />}
              </MapView>
              <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-xl bg-surface/90 px-3 py-1.5 text-[13px] font-bold shadow-card backdrop-blur">
                <span className="size-2 rounded-full bg-success" /> {sharingMembers.length} on the map
              </div>
              <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1.5 rounded-xl bg-surface/90 px-3 py-1.5 text-[13px] font-bold opacity-0 shadow-card backdrop-blur transition group-hover:opacity-100">
                Open map <ArrowRight className="size-4" />
              </div>
            </Link>
          </Card>

          <Card className="p-2">
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
              <h2 className="text-[15px] font-bold">People</h2>
              <Link to="/circles" className="text-[13px] font-semibold text-accent-text">
                Manage
              </Link>
            </div>
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : (
              <div className="max-h-[330px] overflow-y-auto">
                {members.map((m) => (
                  <MemberRow key={m.id} member={m} onClick={() => navigate(`/map?member=${m.id}`)} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <SectionHeader title="Arrivals & departures" action={<Link to="/places" className="text-[13px] font-semibold text-accent-text">Places</Link>} />
            {events.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-muted">
                No arrivals yet. <Link to="/places" className="font-semibold text-accent-text">Add places</Link> like Home or School to see them here.
              </p>
            ) : (
              <ol className="relative space-y-0.5">
                {events.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 rounded-xl px-1 py-2">
                    <Avatar name={e.user.displayName} color={e.user.avatarColor} size={32} />
                    <div className="min-w-0 flex-1 text-[14px]">
                      <span className="font-bold">{firstName(e.user.displayName)}</span> <span className="text-muted">{e.kind === 'arrive' ? 'arrived at' : 'left'}</span>{' '}
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <span style={{ color: e.place.color }}><PlaceIcon name={e.place.icon} className="size-3.5" /></span>
                        {e.place.name}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-[12px] whitespace-nowrap text-muted">
                      {e.kind === 'arrive' ? <LogIn className="size-3.5 text-success" /> : <LogOut className="size-3.5 text-warning" />}
                      {ago(e.occurredAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-5">
            <SectionHeader title="Recent trips" action={<Link to="/trips" className="text-[13px] font-semibold text-accent-text">All trips</Link>} />
            {recentTrips.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center text-[14px] text-muted">
                <Route className="mb-2 size-6" />
                Trips appear automatically after someone travels more than a few hundred metres.
              </div>
            ) : (
              <div className="-mx-3">
                {recentTrips.map((t) => (
                  <TripRow key={t.id} trip={t} person={byId.get(t.userId)} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
