import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  Bell,
  CalendarClock,
  Car,
  ChevronLeft,
  CircleDashed,
  CirclePause,
  Clock,
  Crosshair,
  Expand,
  EyeOff,
  Hourglass,
  Info,
  Layers,
  MapPin,
  MapPinOff,
  Maximize2,
  Minimize2,
  Navigation,
  Navigation2,
  Route,
  Satellite,
  Settings,
  Share,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { compassDirection } from '@nodara/shared';
import { api } from '@/lib/api';
import { ago, clock, coords, firstName, formatDistance, freshness, shortAgo } from '@/lib/format';
import { useCircles, useConfig, useLive, useUser, useInvalidate } from '@/lib/queries';
import { circleSummary, describeMember } from '@/lib/status';
import { driveState, stoppedFor } from '@/lib/driving';
import { CircleSwitcher } from '@/components/AppShell';
import { useActiveCircle } from '@/lib/circle-context';
import type { MemberLocation, PlaceWithMeta, Trip } from '@/lib/types';
import { Avatar, Button, cx, EmptyState, Segmented, Skeleton, StatusPill } from '@/components/ui';
import { MapView, type MapHandle } from '@/features/map/MapView';
import { MembersLayer, PlacesLayer, RouteLayer } from '@/features/map/layers';
import { MemberRow } from '@/features/members/MemberRow';
import { TripRow } from '@/features/trips/TripRow';
import { PLACE_ICONS } from '@/features/map/icons';
import { useAddress } from '@/features/members/hooks';
import { api as apiClient } from '@/lib/api';
import type { Me } from '@nodara/shared';
import { useQueryClient } from '@tanstack/react-query';

export default function MapPage() {
  const me = useUser();
  const { circleId } = useActiveCircle();
  const { data: circles = [] } = useCircles();
  const { data: members = [], isLoading } = useLive(circleId);
  const { data: allPlaces = [] } = useQuery({ queryKey: ['places'], queryFn: () => api.get<PlaceWithMeta[]>('/api/places') });
  const places = circleId ? allPlaces.filter((p) => p.circleId === circleId || p.circleId === null) : allPlaces;
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
  const [segment, setSegment] = useState<'people' | 'places'>('people');
  const container = useRef<HTMLDivElement>(null);
  // The phone sheet's height, so the map buttons ride just above it.
  const sheet = useRef<HTMLDivElement>(null);
  const [sheetH, setSheetH] = useState(300);
  useEffect(() => {
    if (!sheet.current) return;
    const ro = new ResizeObserver(([e]) => setSheetH(e!.target.getBoundingClientRect().height));
    ro.observe(sheet.current);
    return () => ro.disconnect();
  }, []);
  const unread = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ unread: number }>('/api/notifications?limit=1') }).data?.unread ?? 0;
  const circle = circles.find((c) => c.id === circleId);

  const select = (id: string | null) => {
    setParams(id ? { member: id } : {}, { replace: true });
    setFollow(true);
    setSheetOpen(true);
  };
  /** Where someone shows on the map: their location, or the middle of their bubble. */
  const spot = (m: MemberLocation) => (m.location ? { lon: m.location.lon, lat: m.location.lat } : m.bubble ? { lon: m.bubble.lon, lat: m.bubble.lat } : null);

  // Fit everyone on first load.
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || fitted.current || members.length === 0) return;
    const spots = members.map(spot).filter(Boolean) as { lon: number; lat: number }[];
    if (!spots.length) return;
    fitted.current = true;
    const s = selected ? spot(selected) : null;
    if (s) {
      map.jumpTo({ center: [s.lon, s.lat], zoom: 15 });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    spots.forEach((p) => b.extend([p.lon, p.lat]));
    map.fitBounds(b, { padding: { top: 120, bottom: window.innerWidth >= 1024 ? 80 : 360, left: window.innerWidth >= 1024 ? 460 : 60, right: 80 }, maxZoom: 15, duration: 0 });
  }, [map, members, selected]);

  // Follow the selected member as their location updates.
  const selLoc = selected?.location;
  useEffect(() => {
    if (!map || !selLoc || !follow) return;
    map.easeTo({ center: [selLoc.lon, selLoc.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 800, padding: window.innerWidth >= 1024 ? { left: 440, top: 0, right: 0, bottom: 0 } : { bottom: 380, top: 0, left: 0, right: 0 } });
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
    const spots = members.map(spot).filter(Boolean) as { lon: number; lat: number }[];
    if (!map || !spots.length) return;
    setFollow(false);
    const b = new maplibregl.LngLatBounds();
    spots.forEach((p) => b.extend([p.lon, p.lat]));
    map.fitBounds(b, { padding: { top: 120, bottom: window.innerWidth >= 1024 ? 80 : 360, left: window.innerWidth >= 1024 ? 460 : 60, right: 80 }, maxZoom: 15, duration: 700 });
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

      {/* Floating glass top bar (phones), like the iOS app: settings · circle · alerts. */}
      <div className="safe-top absolute inset-x-0 top-0 z-30 flex items-center gap-2.5 px-3 pt-3 lg:hidden">
        <Link to="/settings" className="glass flex size-[52px] shrink-0 items-center justify-center rounded-full" aria-label="Settings">
          <Settings className="size-[22px]" />
        </Link>
        <div className="min-w-0 flex-1">
          <CircleSwitcher glass />
        </div>
        <Link to="/notifications" className="glass relative flex size-[52px] shrink-0 items-center justify-center rounded-full" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell className="size-[22px]" />
          {unread > 0 && <span className="tnum absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-bg bg-accent px-1 text-[12px] font-bold text-on-accent">{unread > 99 ? '99+' : unread}</span>}
        </Link>
      </div>

      {/* Round glass map buttons: above the sheet on phones, top-right on desktop. */}
      <div
        className={cx(
          'absolute right-3 z-20 flex flex-col gap-2.5 transition-[bottom] duration-300',
          'max-lg:bottom-[calc(var(--sheet-h)+12px)] lg:top-4 lg:right-4',
        )}
        style={{ ['--sheet-h' as string]: `${sheetH}px` }}
      >
        <StyleSwitcher />
        <RoundButton label={showPlaces ? 'Hide places' : 'Show places'} active={showPlaces} onClick={() => setShowPlaces((v) => !v)} className="max-lg:hidden">
          <MapPin className="size-5" />
        </RoundButton>
        <RoundButton label="Legend" active={legend} onClick={() => setLegend((l) => !l)} className="max-lg:hidden">
          <Info className="size-5" />
        </RoundButton>
        <RoundButton label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen} className="max-lg:hidden">
          {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
        </RoundButton>
        {selected ? (
          <RoundButton label={follow ? 'Following' : 'Follow'} active={follow} onClick={() => setFollow((f) => !f)}>
            <Crosshair className="size-5" />
          </RoundButton>
        ) : null}
        <RoundButton label="Show everyone" onClick={fitAll}>
          <Users className="size-5" />
        </RoundButton>
        <LocateMe map={map} members={members} meId={me.id} onLocate={() => select(me.id)} />
      </div>
      {legend && <Legend onClose={() => setLegend(false)} />}

      {/* The sheet: bottom sheet on phones, floating card on desktop. */}
      <div
        ref={sheet}
        className={cx(
          'glass absolute z-20 flex flex-col overflow-hidden transition-[max-height] duration-300',
          'inset-x-0 bottom-0 max-h-[62dvh] rounded-t-[32px] border-b-0 pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0',
          'lg:inset-x-auto lg:top-4 lg:bottom-4 lg:left-4 lg:max-h-none lg:w-[420px] lg:rounded-[32px] lg:border-b',
          !sheetOpen && 'max-lg:max-h-[130px]',
        )}
      >
        <button className="flex shrink-0 justify-center pt-2.5 pb-1 lg:hidden" onClick={() => setSheetOpen((o) => !o)} aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'}>
          <span className="h-[5px] w-10 rounded-full bg-muted/40" />
        </button>
        {selected ? (
          <MemberDetail key={selected.id} member={selected} onBack={() => select(null)} onFocus={() => {
            const s = spot(selected);
            if (s) handle.current?.flyTo(s.lon, s.lat, selected.location ? 16 : 12);
          }} />
        ) : (
          <div className="flex min-h-0 flex-col">
            <div className="px-5 pt-2 pb-3 lg:pt-6">
              <h1 className="large-title truncate">{circle?.name ?? 'Everyone'}</h1>
              <p className="mt-1 text-[15px] text-muted">{members.length ? circleSummary(members) : 'Nobody here yet'}</p>
            </div>
            <div className="px-4 pb-3">
              <Segmented
                className="w-full"
                value={segment}
                onChange={setSegment}
                options={[
                  { value: 'people', label: 'People', icon: <Users className="size-4" />, count: members.length },
                  { value: 'places', label: 'Places', icon: <MapPin className="size-4" />, count: places.length },
                ]}
              />
            </div>
            <div className="min-h-0 space-y-3 overflow-y-auto px-4 pb-4">
              {segment === 'people' ? (
                isLoading ? (
                  [0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px]" />)
                ) : members.length ? (
                  members.map((m) => <MemberRow key={m.id} variant="card" member={m} onClick={() => select(m.id)} />)
                ) : (
                  <div className="card">
                    <EmptyState icon={<Users className="size-8" />} title="Nobody here yet" body="Invite people to a circle to see them on the map." action={<Link to="/circles"><Button variant="primary">Invite people</Button></Link>} />
                  </div>
                )
              ) : places.length ? (
                places.map((p) => <PlaceCard key={p.id} place={p} members={members} onClick={() => handle.current?.flyTo(p.lon, p.lat, 16)} />)
              ) : (
                <div className="card">
                  <EmptyState icon={<MapPin className="size-8" />} title="No places yet" body="Add Home, School or Work to get arrival and departure alerts." action={<Link to="/places"><Button variant="primary">Add a place</Button></Link>} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Round glass button floating over the map. */
function RoundButton({ label, active, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx('glass flex size-[52px] items-center justify-center rounded-full transition active:opacity-70', active ? 'text-accent-text' : 'text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A saved place in the sheet: icon, name, who's there now. */
function PlaceCard({ place, members, onClick }: { place: PlaceWithMeta; members: MemberLocation[]; onClick: () => void }) {
  const inside = members.filter((m) => place.membersInside.includes(m.id));
  const Icon = PLACE_ICONS[place.icon]?.icon ?? MapPin;
  return (
    <button onClick={onClick} className="card flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-surface-2/40">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full text-white" style={{ background: place.color }}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-bold">{place.name}</div>
        <div className="truncate text-[14px] text-muted">{inside.length ? `${inside.map((m) => firstName(m.displayName)).join(', ')} ${inside.length === 1 ? 'is' : 'are'} here` : (place.address ?? 'Nobody here right now')}</div>
      </div>
      {inside.length > 0 && (
        <div className="flex -space-x-2">
          {inside.slice(0, 3).map((m) => (
            <Avatar key={m.id} name={m.displayName} color={m.avatarColor} url={m.avatarUrl} size={28} className="ring-2 ring-surface" />
          ))}
        </div>
      )}
    </button>
  );
}

function LocateMe({ map, members, meId, onLocate }: { map: MLMap | null; members: MemberLocation[]; meId: string; onLocate: () => void }) {
  const mine = members.find((m) => m.id === meId)?.location;
  return (
    <RoundButton
      label="My location"
      onClick={() => {
        if (mine) {
          onLocate();
          return;
        }
        navigator.geolocation?.getCurrentPosition((p) => map?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }));
      }}
    >
      <Navigation className="size-5" />
    </RoundButton>
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
      <RoundButton label="Map style" onClick={() => setOpen((o) => !o)} active={open}>
        <Layers className="size-5" />
      </RoundButton>
      {open && (
        <div className="absolute right-full mr-2 w-56 animate-rise rounded-[24px] bg-elevated p-2 shadow-float max-lg:bottom-0 lg:top-0">
          <div className="eyebrow px-3 py-1.5">Map style</div>
          <button onClick={() => set(null)} className={cx('flex w-full items-center rounded-2xl px-3 py-2.5 text-[15px] font-semibold hover:bg-surface-2', !me.preferences.mapStyle && 'text-accent-text')}>
            Automatic (match theme)
          </button>
          {config?.mapStyles.map((s) => (
            <button key={s.id} onClick={() => set(s.id)} className={cx('flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-[15px] font-semibold hover:bg-surface-2', me.preferences.mapStyle === s.id && 'text-accent-text')}>
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
    <div className="absolute top-4 right-[76px] z-30 w-72 animate-rise rounded-[24px] bg-elevated p-5 text-[14px] shadow-float" onClick={onClose}>
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
          <span className="size-3.5 rounded-full bg-success/60" /> Recent — up to 15 min old
        </li>
        <li className="flex items-center gap-2.5">
          <span className="size-3.5 rounded-full bg-muted grayscale" /> Out of date — greyed with “!”
        </li>
        <li className="flex items-center gap-2.5">
          <Navigation2 className="size-4 text-accent-text" /> Arrow shows direction while moving
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

/** A person's profile inside the sheet, like the iOS app: header, "now" card, recent drives. */
function MemberDetail({ member, onBack, onFocus }: { member: MemberLocation; onBack: () => void; onFocus: () => void }) {
  const me = useUser();
  const units = me.preferences.units;
  const isMe = member.id === me.id;
  const loc = member.location;
  const { data: address } = useAddress(loc?.lat, loc?.lon);
  const s = describeMember(member, address, units);
  const f = freshness(loc?.recordedAt);
  const drive = driveState(member);
  const moving = Boolean(drive ? !drive.stopped : loc && (loc.speed ?? 0) > 1.5 && f === 'live');
  const name = isMe ? 'You' : firstName(member.displayName);
  const { data: trips = [] } = useQuery({
    queryKey: ['trips', member.id, 'recent'],
    queryFn: () => api.get<Trip[]>(`/api/trips?userId=${member.id}&limit=5`).catch(() => [] as Trip[]),
  });
  const invalidate = useInvalidate();
  useEffect(() => {
    void invalidate('trips');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.inTrip]);
  const PlaceI = member.currentPlace ? (PLACE_ICONS[member.currentPlace.icon]?.icon ?? MapPin) : null;
  const share = async () => {
    if (!loc) return;
    const url = `https://maps.apple.com/?ll=${loc.lat},${loc.lon}&q=${encodeURIComponent(s.where)}`;
    if (navigator.share) await navigator.share({ title: `${isMe ? "I'm" : `${member.displayName} is`} here`, url }).catch(() => {});
    else await navigator.clipboard.writeText(url).catch(() => {});
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 px-4 pt-2 pb-4 lg:pt-5">
        <button onClick={onBack} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 transition hover:bg-surface-3" aria-label="Back to everyone">
          <ChevronLeft className="size-5" />
        </button>
        <button onClick={onFocus} className="flex min-w-0 flex-1 items-center gap-3.5 text-left" aria-label={`Show ${member.displayName} on the map`}>
          <span className={cx('rounded-full p-[3px]', s.live ? 'bg-accent' : 'bg-transparent')}>
            <Avatar name={member.displayName} color={member.avatarColor} url={member.avatarUrl} size={60} dim={!loc && !member.bubble ? true : s.stale} className="ring-[3px] ring-surface" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <h2 className="truncate text-[24px] font-bold tracking-tight">{isMe ? 'You' : member.displayName}</h2>
              {s.live && <span className="size-2.5 shrink-0 rounded-full bg-success" />}
            </span>
            <StatusPill tone={s.pill.tone} icon={<s.pill.icon />} className="mt-1">
              {s.pill.text}
            </StatusPill>
          </span>
        </button>
        {isMe && (
          <Link to="/settings/account" className="shrink-0 rounded-full bg-accent-soft px-4 py-2 text-[15px] font-semibold text-accent-text">
            Edit
          </Link>
        )}
      </div>

      <div className="min-h-0 space-y-4 overflow-y-auto px-4 pb-5">
        {!loc && member.bubble ? (
          <div className="card space-y-4 p-5">
            <div className="flex items-center gap-3.5">
              <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-bubble text-white">
                <CircleDashed className="size-6" />
              </span>
              <div className="min-w-0">
                <div className="text-[20px] font-semibold">{s.where}</div>
                <div className="text-[14px] text-muted">
                  {name} is sharing only a general area (about {formatDistance(member.bubble.radiusM, units)}) until {clock(member.bubble.endsAt)}.
                </div>
              </div>
            </div>
            <Facts
              items={[
                { icon: BatteryFull, value: member.bubble.battery != null ? `${member.bubble.battery}%` : '—', label: member.bubble.charging ? 'Charging' : 'Battery' },
                { icon: Clock, value: shortAgo(member.bubble.seenAt), label: 'Last check-in' },
                { icon: CircleDashed, value: formatDistance(member.bubble.radiusM, units), label: 'Area' },
              ]}
            />
            <p className="text-[13.5px] text-muted">Places, trips and drives from while the bubble is on stay private. It ends early if {name} leaves the area.</p>
          </div>
        ) : !loc ? (
          <div className="card flex items-center gap-3.5 p-5">
            <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">{member.sharing ? <MapPinOff className="size-6" /> : <EyeOff className="size-6" />}</span>
            <div>
              <div className="text-[18px] font-semibold">{s.where}</div>
              <div className="text-[14px] text-muted">{member.sharing ? `${name} will appear here once ${isMe ? 'your' : 'their'} phone sends a location.` : `${name} turned off sharing with this circle.`}</div>
            </div>
          </div>
        ) : (
          <div className="card space-y-4 p-5">
            <div className="flex items-center gap-3.5">
              <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full text-white" style={{ background: member.currentPlace?.color ?? (moving || drive ? 'var(--info)' : 'var(--accent)') }}>
                {PlaceI ? <PlaceI className="size-6" /> : moving || drive ? <Car className="size-6" /> : <MapPin className="size-6" />}
              </span>
              <div className="min-w-0">
                <div className="text-[20px] leading-tight font-semibold">{s.where}</div>
                {member.currentPlace && address && <div className="truncate text-[14px] text-muted">{address}</div>}
                {!member.currentPlace && !address && <div className="tnum text-[13px] text-muted">{coords(loc.lat, loc.lon)}</div>}
              </div>
            </div>
            {s.stayFor && member.stay ? (
              <InfoRow icon={<Hourglass className="size-4 text-accent-text" />}>
                Here for <b>{s.stayFor}</b>
                <span className="text-muted"> · since {clock(member.stay.since)}</span>
              </InfoRow>
            ) : drive?.stopped ? (
              <InfoRow icon={<CirclePause className="size-4 text-info" />}>Stopped for {stoppedFor(drive.stoppedForMs)}, still on a drive</InfoRow>
            ) : moving ? (
              <InfoRow icon={<Navigation2 className="size-4 text-info" style={{ transform: `rotate(${loc.heading ?? 0}deg)` }} />}>
                On the move{loc.heading != null ? `, heading ${compassDirection(loc.heading)}` : ''}
              </InfoRow>
            ) : null}
            {(f === 'stale' || f === 'old') && (
              <div className="flex gap-2.5 rounded-2xl bg-warning/12 p-3 text-[14px]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  Last known location from {ago(loc.recordedAt)} ({clock(loc.recordedAt)}). {isMe ? 'Your' : `${name}'s`} phone may be off, out of signal, or not sharing in the background.
                </span>
              </div>
            )}
            <Facts
              items={[
                {
                  icon: loc.charging ? BatteryCharging : (loc.battery ?? 100) <= 20 ? BatteryLow : BatteryFull,
                  value: loc.battery != null ? `${loc.battery}%` : '—',
                  label: loc.charging ? 'Charging' : 'Battery',
                  tone: loc.battery != null && loc.battery <= 15 && !loc.charging ? 'text-danger' : undefined,
                },
                { icon: Clock, value: shortAgo(loc.recordedAt), label: f === 'live' ? 'Updated' : 'Since update', tone: s.stale ? 'text-warning' : undefined },
                { icon: Crosshair, value: loc.accuracy != null ? `±${formatDistance(loc.accuracy, units)}` : '—', label: 'Accuracy' },
              ]}
            />
            <div className="flex gap-2.5">
              {!isMe && (
                <a href={`https://maps.apple.com/?daddr=${loc.lat},${loc.lon}`} target="_blank" rel="noreferrer" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 text-[15px] font-semibold transition hover:bg-surface-3">
                  <Navigation className="size-4 text-info" /> Directions
                </a>
              )}
              <button onClick={() => void share()} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 text-[15px] font-semibold transition hover:bg-surface-3">
                <Share className="size-4 text-success" /> {isMe ? 'Share my spot' : 'Share'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2.5">
          <Link to={`/history?member=${member.id}`} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 text-[15px] font-semibold transition hover:bg-surface-3">
            <CalendarClock className="size-4 text-accent-text" /> History
          </Link>
          <Link to={`/trips${isMe ? '' : `?member=${member.id}`}`} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 text-[15px] font-semibold transition hover:bg-surface-3">
            <Route className="size-4 text-accent-text" /> All drives
          </Link>
        </div>

        {trips.length > 0 && (
          <div className="space-y-3">
            <h3 className="px-1 pt-1 text-[20px] font-bold tracking-tight">Recent drives</h3>
            {trips.map((t) => (
              <TripRow key={t.id} trip={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-surface-2 px-4 py-3 text-[15px]">
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** Three quick facts in a row: battery, last update, accuracy. */
function Facts({ items }: { items: { icon: React.ComponentType<{ className?: string }>; value: string; label: string; tone?: string }[] }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-line">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col items-center px-1 text-center">
          <div className={cx('tnum flex items-center gap-1.5 text-[19px] font-semibold', it.tone)}>
            <it.icon className="size-4 text-muted" />
            {it.value}
          </div>
          <div className="text-[13px] text-muted">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
