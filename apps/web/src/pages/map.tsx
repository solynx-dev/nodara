import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import {
  BatteryFull,
  CalendarClock,
  ChevronLeft,
  Crosshair,
  Expand,
  Gauge,
  Info,
  Layers,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation2,
  Route,
  Satellite,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { compassDirection } from '@nodara/shared';
import { api } from '@/lib/api';
import { ago, clock, coords, firstName, formatDistance, formatSpeed, freshness } from '@/lib/format';
import { useConfig, useLive, useUser, useInvalidate } from '@/lib/queries';
import { useActiveCircle } from '@/lib/circle-context';
import type { MemberLocation, PlaceWithMeta, Trip } from '@/lib/types';
import { Avatar, Badge, Button, cx, IconButton, Skeleton } from '@/components/ui';
import { MapView, type MapHandle } from '@/features/map/MapView';
import { MembersLayer, PlacesLayer, RouteLayer } from '@/features/map/layers';
import { BatteryIndicator, MemberRow, useWhereLabel } from '@/features/members/MemberRow';
import { TripRow } from '@/features/trips/TripRow';
import { PLACE_ICONS } from '@/features/map/icons';
import { useAddress } from '@/features/members/hooks';
import { api as apiClient } from '@/lib/api';
import type { Me } from '@nodara/shared';
import { useQueryClient } from '@tanstack/react-query';

export default function MapPage() {
  const me = useUser();
  const { circleId } = useActiveCircle();
  const { data: members = [], isLoading } = useLive(circleId);
  const { data: places = [] } = useQuery({ queryKey: ['places'], queryFn: () => api.get<PlaceWithMeta[]>('/api/places') });
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('member');
  const selected = members.find((m) => m.id === selectedId) ?? null;
  const handle = useRef<MapHandle>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const [follow, setFollow] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);
  const [legend, setLegend] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const container = useRef<HTMLDivElement>(null);

  const select = (id: string | null) => {
    setParams(id ? { member: id } : {}, { replace: true });
    setFollow(true);
    setSheetOpen(true);
  };

  // Fit everyone on first load.
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || fitted.current || members.length === 0) return;
    const located = members.filter((m) => m.location);
    if (!located.length) return;
    fitted.current = true;
    if (selected?.location) {
      map.jumpTo({ center: [selected.location.lon, selected.location.lat], zoom: 15 });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    located.forEach((m) => b.extend([m.location!.lon, m.location!.lat]));
    map.fitBounds(b, { padding: { top: 80, bottom: 80, left: window.innerWidth > 1024 ? 420 : 60, right: 80 }, maxZoom: 15, duration: 0 });
  }, [map, members, selected]);

  // Follow the selected member as their location updates.
  const selLoc = selected?.location;
  useEffect(() => {
    if (!map || !selLoc || !follow) return;
    map.easeTo({ center: [selLoc.lon, selLoc.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 800, padding: window.innerWidth >= 1024 ? { left: 400, top: 0, right: 0, bottom: 0 } : { bottom: 260, top: 0, left: 0, right: 0 } });
  }, [map, selLoc?.lat, selLoc?.lon, follow, selLoc]);
  useEffect(() => {
    if (!map) return;
    const stop = (e: { originalEvent?: unknown }) => e.originalEvent && setFollow(false);
    map.on('dragstart', stop);
    return () => {
      map.off('dragstart', stop);
    };
  }, [map]);

  const fitAll = () => {
    const located = members.filter((m) => m.location);
    if (!map || !located.length) return;
    setFollow(false);
    const b = new maplibregl.LngLatBounds();
    located.forEach((m) => b.extend([m.location!.lon, m.location!.lat]));
    map.fitBounds(b, { padding: 100, maxZoom: 15, duration: 700 });
  };
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) container.current?.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => setFullscreen((f) => !f));
    else document.exitFullscreen().then(() => setFullscreen(false));
  };
  useEffect(() => {
    const f = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  return (
    <div ref={container} className={cx('absolute inset-0 bg-bg', fullscreen && 'fixed z-[60]')}>
      <MapView ref={handle} className="absolute inset-0" onReady={setMap}>
        {map && showPlaces && <PlacesLayer map={map} places={places} />}
        {map && <MembersLayer map={map} members={members} selectedId={selectedId} onSelect={(id) => select(id)} meId={me.id} />}
        {map && selected && <LiveTripTrail map={map} member={selected} />}
      </MapView>

      {/* Map tools */}
      <div className="absolute top-[calc(env(safe-area-inset-top)+72px)] right-2.5 z-10 flex flex-col gap-2 lg:top-[132px]">
        <ToolGroup>
          <IconButton label="Fit everyone" onClick={fitAll}>
            <Users className="size-[18px]" />
          </IconButton>
          <IconButton label={follow ? 'Following selected person' : 'Follow selected person'} active={follow && Boolean(selected)} onClick={() => setFollow((f) => !f)} disabled={!selected}>
            <Crosshair className="size-[18px]" />
          </IconButton>
          <LocateMe map={map} members={members} meId={me.id} onLocate={() => select(me.id)} />
        </ToolGroup>
        <ToolGroup>
          <StyleSwitcher />
          <IconButton label={showPlaces ? 'Hide places' : 'Show places'} active={showPlaces} onClick={() => setShowPlaces((s) => !s)}>
            <MapPin className="size-[18px]" />
          </IconButton>
          <IconButton label="Legend" active={legend} onClick={() => setLegend((l) => !l)}>
            <Info className="size-[18px]" />
          </IconButton>
          <IconButton label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen} className="hidden sm:inline-flex">
            {fullscreen ? <Minimize2 className="size-[18px]" /> : <Maximize2 className="size-[18px]" />}
          </IconButton>
        </ToolGroup>
      </div>
      {legend && <Legend onClose={() => setLegend(false)} />}

      {/* Mobile top bar */}
      <div className="safe-top absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3 lg:hidden">
        <Link to="/" className="flex size-11 items-center justify-center rounded-2xl border border-line bg-surface/95 shadow-card backdrop-blur" aria-label="Back">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3.5 text-[14px] font-bold shadow-card backdrop-blur">
          <span className="size-2 rounded-full bg-success" />
          {members.filter((m) => m.location).length} people on the map
        </div>
      </div>

      {/* Panel: desktop side card / mobile bottom sheet */}
      <div
        className={cx(
          'absolute z-20 flex flex-col overflow-hidden border border-line bg-elevated/97 shadow-float backdrop-blur-xl transition-[transform,max-height] duration-300',
          'inset-x-0 bottom-0 max-h-[62dvh] rounded-t-[26px] pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0',
          'lg:inset-x-auto lg:top-4 lg:bottom-auto lg:left-4 lg:max-h-[calc(100%-32px)] lg:w-[370px] lg:rounded-3xl',
          !sheetOpen && 'max-lg:max-h-[118px]',
        )}
      >
        <button className="flex shrink-0 justify-center pt-2.5 pb-1 lg:hidden" onClick={() => setSheetOpen((o) => !o)} aria-label="Toggle panel">
          <span className="h-1.5 w-10 rounded-full bg-surface-3" />
        </button>
        {selected ? (
          <MemberDetail member={selected} onBack={() => select(null)} onFocus={() => selected.location && handle.current?.flyTo(selected.location.lon, selected.location.lat, 16)} />
        ) : (
          <div className="flex min-h-0 flex-col">
            <div className="px-5 pt-3 pb-2 lg:pt-5">
              <h1 className="text-[19px] font-extrabold tracking-tight">Everyone</h1>
              <p className="text-[13px] text-muted">Tap a person to follow them on the map.</p>
            </div>
            <div className="min-h-0 overflow-y-auto px-2 pb-3">
              {isLoading
                ? [0, 1, 2].map((i) => <Skeleton key={i} className="mx-2 mb-2 h-14" />)
                : members.map((m) => <MemberRow key={m.id} member={m} onClick={() => select(m.id)} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col rounded-2xl border border-line bg-surface/95 p-1 shadow-card backdrop-blur">{children}</div>;
}

function LocateMe({ map, members, meId, onLocate }: { map: MLMap | null; members: MemberLocation[]; meId: string; onLocate: () => void }) {
  const mine = members.find((m) => m.id === meId)?.location;
  return (
    <IconButton
      label="My location"
      onClick={() => {
        if (mine) {
          onLocate();
          return;
        }
        navigator.geolocation?.getCurrentPosition((p) => map?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }));
      }}
    >
      <LocateFixed className="size-[18px]" />
    </IconButton>
  );
}

function StyleSwitcher() {
  const { data: config } = useConfig();
  const me = useUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const set = async (id: string | null) => {
    const m = await apiClient.patch<Me>('/api/me', { preferences: { mapStyle: id } });
    qc.setQueryData(['me'], m);
    setOpen(false);
  };
  return (
    <div className="relative">
      <IconButton label="Map style" onClick={() => setOpen((o) => !o)} active={open}>
        <Layers className="size-[18px]" />
      </IconButton>
      {open && (
        <div className="absolute top-0 right-full mr-2 w-48 animate-rise rounded-2xl border border-line bg-elevated p-1.5 shadow-float">
          <div className="eyebrow px-2.5 py-1.5">Map style</div>
          <button onClick={() => set(null)} className={cx('flex w-full items-center rounded-lg px-2.5 py-2 text-[13.5px] font-semibold hover:bg-surface-2', !me.preferences.mapStyle && 'text-accent-text')}>
            Automatic (match theme)
          </button>
          {config?.mapStyles.map((s) => (
            <button key={s.id} onClick={() => set(s.id)} className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] font-semibold hover:bg-surface-2', me.preferences.mapStyle === s.id && 'text-accent-text')}>
              {s.dark ? <Satellite className="size-4" /> : <Expand className="size-4" />} {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute top-[calc(env(safe-area-inset-top)+72px)] right-16 z-10 lg:top-[132px] w-64 animate-rise rounded-2xl border border-line bg-elevated p-4 text-[13px] shadow-float" onClick={onClose}>
      <div className="eyebrow mb-3">Legend</div>
      <ul className="space-y-2.5">
        <li className="flex items-center gap-2.5">
          <span className="relative flex size-5 items-center justify-center">
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-success" />
            <span className="size-3.5 rounded-full bg-success" />
          </span>
          Live — updated in the last 2 min
        </li>
        <li className="flex items-center gap-2.5">
          <span className="size-3.5 rounded-full bg-[#4C9AFF]" /> Recent — up to 15 min old
        </li>
        <li className="flex items-center gap-2.5">
          <span className="size-3.5 rounded-full bg-muted grayscale" /> Out of date — greyed with “!”
        </li>
        <li className="flex items-center gap-2.5">
          <Navigation2 className="size-4 text-accent" /> Arrow shows direction while moving
        </li>
        <li className="flex items-center gap-2.5">
          <span className="size-3.5 rounded-full border border-accent bg-accent/15" /> Shaded circle: GPS accuracy
        </li>
        <li className="flex items-center gap-2.5">
          <span className="size-3.5 rounded-full border border-dashed border-info" /> Dashed ring: saved place
        </li>
      </ul>
    </div>
  );
}

/** Today's route of an in-progress trip, drawn behind the selected member. */
function LiveTripTrail({ map, member }: { map: MLMap; member: MemberLocation }) {
  const { data } = useQuery({
    queryKey: ['trips', member.id, 'live-trail'],
    enabled: member.inTrip,
    queryFn: async () => {
      const trips = await api.get<Trip[]>(`/api/trips?userId=${member.id}&limit=1`);
      const t = trips[0];
      if (!t || t.status !== 'in_progress') return null;
      return api.get<{ route: [number, number][] }>(`/api/trips/${t.id}`);
    },
    refetchInterval: 30_000,
  });
  const coordsList = useMemo(() => {
    const base = data?.route ?? [];
    const l = member.location;
    return l ? [...base, [l.lon, l.lat] as [number, number]] : base;
  }, [data, member.location]);
  if (!member.inTrip || coordsList.length < 2) return null;
  return <RouteLayer map={map} id="live-trail" coords={coordsList} color={member.avatarColor} gradient={false} width={4} />;
}

function MemberDetail({ member, onBack, onFocus }: { member: MemberLocation; onBack: () => void; onFocus: () => void }) {
  const me = useUser();
  const units = me.preferences.units;
  const loc = member.location;
  const where = useWhereLabel(member);
  const { data: address } = useAddress(loc?.lat, loc?.lon);
  const f = freshness(loc?.recordedAt);
  const { data: trips = [] } = useQuery({
    queryKey: ['trips', member.id, 'recent'],
    queryFn: () => api.get<Trip[]>(`/api/trips?userId=${member.id}&limit=4`).catch(() => [] as Trip[]),
  });
  const invalidate = useInvalidate();
  const moving = loc && (loc.speed ?? 0) > 1 && f === 'live';
  useEffect(() => {
    void invalidate('trips');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.inTrip]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2 lg:pt-3">
        <IconButton label="Back to everyone" onClick={onBack}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <span className="text-[13px] font-semibold text-muted">Everyone</span>
      </div>
      <div className="min-h-0 overflow-y-auto px-5 pb-5">
        <button className="flex w-full items-center gap-3.5 pt-1 text-left" onClick={onFocus}>
          <Avatar name={member.displayName} color={member.avatarColor} url={member.avatarUrl} size={54} ring={f === 'live'} dim={f === 'old'} />
          <div className="min-w-0">
            <h2 className="truncate text-[20px] font-extrabold tracking-tight">{member.displayName}</h2>
            <div className="truncate text-[14px] text-ink-2">{where}</div>
          </div>
        </button>

        {!loc ? (
          <div className="mt-4 rounded-2xl bg-surface-2 p-4 text-[14px] text-muted">
            {member.sharing ? `${firstName(member.displayName)} hasn't shared a location yet.` : `${firstName(member.displayName)} isn't sharing their location with you right now.`}
          </div>
        ) : (
          <>
            {(f === 'stale' || f === 'old') && (
              <div className="mt-4 flex gap-2.5 rounded-2xl bg-warning/10 p-3 text-[13px] text-ink-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  This is a <b>last known location</b> from {ago(loc.recordedAt)} ({clock(loc.recordedAt)}). Their device may be offline or not sharing in the background.
                </span>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Tile label="Updated" value={f === 'live' ? 'Live' : ago(loc.recordedAt)} sub={clock(loc.recordedAt)} tone={f === 'live' ? 'success' : f === 'recent' ? undefined : 'warning'} />
              <Tile
                label="Speed"
                icon={<Gauge className="size-3.5" />}
                value={loc.speed == null ? '—' : moving ? formatSpeed(loc.speed, units) : 'Stationary'}
                sub={moving && loc.heading != null ? `Heading ${compassDirection(loc.heading)}` : loc.speedSource === 'derived' ? 'Estimated' : undefined}
              />
              <Tile label="Battery" icon={<BatteryFull className="size-3.5" />} value={loc.battery != null ? <BatteryIndicator level={loc.battery} charging={loc.charging} className="text-[17px]! text-ink!" /> : '—'} sub={loc.charging ? 'Charging' : loc.battery == null ? 'Not reported' : undefined} />
              <Tile label="Accuracy" value={loc.accuracy != null ? `±${formatDistance(loc.accuracy, units)}` : '—'} sub={member.deviceName ?? undefined} />
            </div>
            <div className="mt-3 rounded-2xl border border-line p-3 text-[13px]">
              <div className="eyebrow mb-1">Location</div>
              <div className="font-semibold">{address ?? 'Address lookup unavailable'}</div>
              <div className="tnum mt-0.5 text-muted">
                {coords(loc.lat, loc.lon)}
                {loc.altitude != null && ` · ${Math.round(loc.altitude)} m alt.`}
              </div>
              {loc.activity && <Badge className="mt-2">{loc.activity}</Badge>}
            </div>
          </>
        )}

        <div className="mt-4 flex gap-2">
          <Link to={`/history?member=${member.id}`} className="flex-1">
            <Button className="w-full" icon={<CalendarClock className="size-4" />}>
              History
            </Button>
          </Link>
          <Link to={`/trips?member=${member.id}`} className="flex-1">
            <Button className="w-full" icon={<Route className="size-4" />}>
              Trips
            </Button>
          </Link>
        </div>

        {trips.length > 0 && (
          <div className="mt-5">
            <div className="eyebrow mb-1 px-1">Recent trips</div>
            <div className="-mx-3">
              {trips.map((t) => (
                <TripRow key={t.id} trip={t} compact />
              ))}
            </div>
          </div>
        )}
        {member.currentPlace && (
          <div className="mt-3 flex items-center gap-2 text-[13px] text-muted">
            {(() => {
              const I = PLACE_ICONS[member.currentPlace.icon]?.icon ?? MapPin;
              return <I className="size-4" style={{ color: member.currentPlace.color }} />;
            })()}
            Inside {member.currentPlace.name}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, icon, tone }: { label: string; value: React.ReactNode; sub?: string; icon?: React.ReactNode; tone?: 'success' | 'warning' }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <div className="eyebrow flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={cx('tnum mt-1 text-[17px] font-bold', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</div>
      {sub && <div className="truncate text-[12px] text-muted">{sub}</div>}
    </div>
  );
}
