import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { circlePolygon } from '@nodara/shared';
import type { MemberLocation, Place } from '@/lib/types';
import { freshness, initials } from '@/lib/format';
import { cx } from '@/components/ui';
import { PlaceIcon } from './icons';
import { emptyFC, setGeoJson } from './MapView';

/** Keeps a map listener-driven "frame" counter so overlays re-layout on move. */
function useMapFrame(map: MLMap) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFrame((f) => f + 1));
    };
    map.on('move', tick);
    map.on('resize', tick);
    return () => {
      cancelAnimationFrame(raf);
      map.off('move', tick);
      map.off('resize', tick);
    };
  }, [map]);
  return frame;
}

/** Re-run `fn` whenever the map style (re)loads, e.g. after a theme switch. */
export function useStyleEffect(map: MLMap, fn: (map: MLMap) => void, deps: unknown[]) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const run = () => {
      if (map.isStyleLoaded()) ref.current(map);
    };
    run();
    map.on('style.load', run);
    return () => {
      map.off('style.load', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ...deps]);
}

// ---------------------------------------------------------------------------
// Members

interface Group {
  key: string;
  lon: number;
  lat: number;
  members: MemberLocation[];
}

const CLUSTER_PX = 46;

export function MembersLayer({
  map,
  members,
  selectedId,
  onSelect,
  meId,
}: {
  map: MLMap;
  members: MemberLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  meId: string;
}) {
  const frame = useMapFrame(map);
  const located = useMemo(() => members.filter((m) => m.location), [members]);

  // Accuracy circles as a GeoJSON layer beneath markers.
  useStyleEffect(
    map,
    (m) => {
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: located
          .filter((x) => (x.location!.accuracy ?? 0) > 15 && freshness(x.location!.recordedAt) !== 'old')
          .map((x) => ({
            type: 'Feature',
            properties: { color: x.avatarColor, selected: x.id === selectedId },
            geometry: { type: 'Polygon', coordinates: [circlePolygon(x.location!.lat, x.location!.lon, Math.min(x.location!.accuracy!, 2000))] },
          })),
      };
      setGeoJson(m, 'nd-accuracy', fc);
      if (!m.getLayer('nd-accuracy-fill')) {
        m.addLayer({ id: 'nd-accuracy-fill', type: 'fill', source: 'nd-accuracy', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.16, 0.08] } });
        m.addLayer({ id: 'nd-accuracy-line', type: 'line', source: 'nd-accuracy', paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.35, 'line-width': 1 } });
      }
    },
    [located, selectedId],
  );

  // Group markers that overlap on screen.
  const groups = useMemo<Group[]>(() => {
    const out: (Group & { x: number; y: number })[] = [];
    const sorted = [...located].sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0));
    for (const m of sorted) {
      const p = map.project([m.location!.lon, m.location!.lat]);
      // The selected person always keeps their own marker.
      const g = m.id === selectedId ? undefined : out.find((o) => o.key !== selectedId && Math.hypot(o.x - p.x, o.y - p.y) < CLUSTER_PX);
      if (g) g.members.push(m);
      else out.push({ key: m.id, lon: m.location!.lon, lat: m.location!.lat, members: [m], x: p.x, y: p.y });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, frame, selectedId, map]);

  return (
    <>
      {groups.map((g) => (
        <MarkerPortal key={g.members.length > 1 ? `cluster-${g.members.map((m) => m.id).join()}` : g.key} map={map} lon={g.lon} lat={g.lat} z={g.members.some((m) => m.id === selectedId) ? 3 : 1}>
          {g.members.length === 1 ? (
            <MemberPin member={g.members[0]!} selected={g.members[0]!.id === selectedId} isMe={g.members[0]!.id === meId} onClick={() => onSelect(g.members[0]!.id)} />
          ) : (
            <ClusterPin
              members={g.members}
              onClick={() => {
                const b = new maplibregl.LngLatBounds();
                g.members.forEach((m) => b.extend([m.location!.lon, m.location!.lat]));
                map.fitBounds(b, { padding: 120, maxZoom: 18, duration: 600 });
              }}
            />
          )}
        </MarkerPortal>
      ))}
    </>
  );
}

function MarkerPortal({ map, lon, lat, z, children, anchor = 'bottom' }: { map: MLMap; lon: number; lat: number; z?: number; children: React.ReactNode; anchor?: maplibregl.PositionAnchor }) {
  const el = useMemo(() => document.createElement('div'), []);
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    marker.current = new maplibregl.Marker({ element: el, anchor }).setLngLat([lon, lat]).addTo(map);
    return () => {
      marker.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, el]);
  useEffect(() => {
    marker.current?.setLngLat([lon, lat]);
  }, [lon, lat]);
  useEffect(() => {
    el.style.zIndex = String(z ?? 1);
  }, [el, z]);
  return createPortal(children, el);
}

export function MemberPin({ member, selected, isMe, onClick }: { member: MemberLocation; selected?: boolean; isMe?: boolean; onClick?: () => void }) {
  const loc = member.location!;
  const fresh = freshness(loc.recordedAt);
  const live = fresh === 'live';
  const stale = fresh === 'stale' || fresh === 'old';
  const moving = (loc.speed ?? 0) > 1.2 && loc.heading != null && !stale;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cx('group relative flex flex-col items-center transition-transform duration-200', selected ? 'scale-110' : 'hover:scale-105')}
      aria-label={`${member.displayName}${stale ? ' (location out of date)' : ''}`}
    >
      <div className="relative">
        {live && <span className="absolute inset-0 animate-pulse-ring rounded-full" style={{ background: member.avatarColor }} />}
        <div
          className={cx('relative flex size-11 items-center justify-center rounded-full border-[3px] text-[15px] font-bold text-white shadow-[0_6px_16px_-4px_rgb(0_0_0/0.45)]', stale && 'grayscale-[0.85]')}
          style={{ background: member.avatarColor, borderColor: selected ? 'var(--accent)' : 'var(--surface)' }}
        >
          {initials(member.displayName)}
        </div>
        {moving && (
          <div className="absolute -inset-2.5" style={{ transform: `rotate(${loc.heading}deg)` }}>
            <div className="absolute top-0 left-1/2 -ml-[6px] h-0 w-0 border-x-[6px] border-b-[8px] border-x-transparent" style={{ borderBottomColor: member.avatarColor }} />
          </div>
        )}
        {stale && <div className="absolute -right-1 -bottom-1 rounded-full border-2 border-surface bg-surface-3 px-1 text-[9px] font-bold text-ink-2">!</div>}
      </div>
      <div className="mt-0.5 h-2 w-2 rotate-45 rounded-[2px]" style={{ background: selected ? 'var(--accent)' : 'var(--surface)' }} />
      {(selected || isMe) && (
        <div className="absolute top-full mt-1 rounded-md bg-surface/95 px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-ink shadow-card">
          {isMe ? 'You' : member.displayName.split(' ')[0]}
        </div>
      )}
    </button>
  );
}

function ClusterPin({ members, onClick }: { members: MemberLocation[]; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative flex items-center rounded-full border-[3px] border-surface bg-surface p-0.5 shadow-[0_6px_16px_-4px_rgb(0_0_0/0.45)] transition hover:scale-105" aria-label={`${members.length} people`}>
      {members.slice(0, 3).map((m, i) => (
        <div key={m.id} className="flex size-8 items-center justify-center rounded-full border-2 border-surface text-[11px] font-bold text-white" style={{ background: m.avatarColor, marginLeft: i ? -8 : 0, zIndex: 3 - i }}>
          {initials(m.displayName)}
        </div>
      ))}
      {members.length > 3 && <div className="ml-1 pr-2 text-[12px] font-bold">+{members.length - 3}</div>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Places / geofences

export function PlacesLayer({ map, places, onSelect, showLabels = true }: { map: MLMap; places: Place[]; onSelect?: (id: string) => void; showLabels?: boolean }) {
  useStyleEffect(
    map,
    (m) => {
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: places.map((p) => ({
          type: 'Feature',
          properties: { id: p.id, color: p.color },
          geometry: { type: 'Polygon', coordinates: [circlePolygon(p.lat, p.lon, p.radiusM)] },
        })),
      };
      setGeoJson(m, 'nd-places', fc);
      if (!m.getLayer('nd-places-fill')) {
        const before = m.getLayer('nd-accuracy-fill') ? 'nd-accuracy-fill' : undefined;
        m.addLayer({ id: 'nd-places-fill', type: 'fill', source: 'nd-places', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } }, before);
        m.addLayer({ id: 'nd-places-line', type: 'line', source: 'nd-places', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 1.5] } }, before);
      }
    },
    [places],
  );
  useEffect(
    () => () => {
      if (!map.getStyle()) return;
      for (const l of ['nd-places-fill', 'nd-places-line']) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource('nd-places')) map.removeSource('nd-places');
    },
    [map],
  );
  return (
    <>
      {places.map((p) => (
        <MarkerPortal key={p.id} map={map} lon={p.lon} lat={p.lat} anchor="center" z={0}>
          <button onClick={() => onSelect?.(p.id)} className="flex items-center gap-1.5 rounded-full border border-line bg-surface/95 py-1 pr-2.5 pl-1 shadow-card backdrop-blur transition hover:scale-105">
            <span className="flex size-6 items-center justify-center rounded-full text-white" style={{ background: p.color }}>
              <PlaceIcon name={p.icon} className="size-3.5" />
            </span>
            {showLabels && <span className="max-w-[120px] truncate text-[11.5px] font-bold">{p.name}</span>}
          </button>
        </MarkerPortal>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Routes (history / trips)

export function RouteLayer({
  map,
  id = 'route',
  coords,
  color = '#FF6B3D',
  gradient = true,
  width = 4.5,
}: {
  map: MLMap;
  id?: string;
  coords: [number, number][];
  color?: string;
  gradient?: boolean;
  width?: number;
}) {
  const src = `nd-${id}`;
  useStyleEffect(
    map,
    (m) => {
      const data: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.length > 1 ? coords : [] } };
      if (m.getSource(src)) (m.getSource(src) as maplibregl.GeoJSONSource).setData(data);
      else m.addSource(src, { type: 'geojson', data, lineMetrics: true });
      if (!m.getLayer(`${src}-casing`)) {
        m.addLayer({ id: `${src}-casing`, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-opacity': 0.18, 'line-width': width + 4, 'line-blur': 2 } });
        m.addLayer({
          id: `${src}-line`,
          type: 'line',
          source: src,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: gradient
            ? { 'line-width': width, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#FFB547', 0.5, color, 1, '#E5384A'] }
            : { 'line-width': width, 'line-color': color },
        });
      }
    },
    [coords, color],
  );
  useEffect(
    () => () => {
      if (!map.getStyle()) return;
      for (const l of [`${src}-line`, `${src}-casing`]) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource(src)) map.removeSource(src);
    },
    [map, src],
  );
  return null;
}

/** Small clickable dots for inspecting individual fixes. */
export function PointsLayer({ map, points, onClick }: { map: MLMap; points: { id: string; lon: number; lat: number }[]; onClick?: (id: string) => void }) {
  const cb = useRef(onClick);
  cb.current = onClick;
  useStyleEffect(
    map,
    (m) => {
      setGeoJson(m, 'nd-points', {
        type: 'FeatureCollection',
        features: points.map((p) => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
      });
      if (!m.getLayer('nd-points')) {
        m.addLayer({
          id: 'nd-points',
          type: 'circle',
          source: 'nd-points',
          minzoom: 12,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 5], 'circle-color': '#fff', 'circle-stroke-color': '#FF6B3D', 'circle-stroke-width': 1.5 },
        });
      }
    },
    [points],
  );
  useEffect(() => {
    const click = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) cb.current?.(String(id));
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('click', 'nd-points', click);
    map.on('mouseenter', 'nd-points', enter);
    map.on('mouseleave', 'nd-points', leave);
    return () => {
      map.off('click', 'nd-points', click);
      map.off('mouseenter', 'nd-points', enter);
      map.off('mouseleave', 'nd-points', leave);
      if (!map.getStyle()) return;
      if (map.getLayer('nd-points')) map.removeLayer('nd-points');
      if (map.getSource('nd-points')) map.removeSource('nd-points');
    };
  }, [map]);
  return null;
}

/** A single positioned overlay element (playback head, dropped pin, …). */
export function HtmlMarker({ map, lon, lat, children, anchor = 'center' }: { map: MLMap; lon: number; lat: number; children: React.ReactNode; anchor?: maplibregl.PositionAnchor }) {
  return (
    <MarkerPortal map={map} lon={lon} lat={lat} anchor={anchor} z={5}>
      {children}
    </MarkerPortal>
  );
}

export { emptyFC };
