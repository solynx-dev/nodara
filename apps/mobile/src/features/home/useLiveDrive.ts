import { useEffect, useRef, useState } from 'react';
import { addLivePoints, advance, fromFix, getTrack, type Playback, type Shown } from '@/lib/livePath';
import { liveSpeed } from '@/lib/driving';
import type { MemberLocation } from '@/lib/types';

const FRAME_MS = 66; // ~15 fps: smooth for map pins, light on the JS thread
const FOLLOW_MS = 1000;

/**
 * Smooth positions for people who are driving: their pin glides along the
 * real path a few seconds behind, instead of jumping each time their phone
 * uploads. Runs only while someone is moving (plus a moment to finish playing
 * the path after they stop). Everyone else keeps their exact latest location.
 */
export function useLiveDrive(members: MemberLocation[], followId: string | null, onFollow?: (lat: number, lon: number) => void): Map<string, Shown> {
  const [shown, setShown] = useState<Map<string, Shown>>(() => new Map());
  const anim = useRef(new Map<string, Playback>());
  const membersRef = useRef(members);
  const followRef = useRef({ followId, onFollow });
  useEffect(() => {
    membersRef.current = members;
    followRef.current = { followId, onFollow };
  });

  // Polling and realtime both update `members`; keep their fixes in the path.
  useEffect(() => {
    for (const m of members) if (m.location) addLivePoints(m.id, [fromFix(m.location)]);
  }, [members]);

  const moving = members.some((m) => liveSpeed(m) != null);

  useEffect(() => {
    if (!moving && anim.current.size === 0) return;
    let lastFollow = 0;
    const timer = setInterval(() => {
      const now = Date.now();
      const next = new Map<string, Shown>();
      const list = membersRef.current;
      for (const m of list) {
        if (!m.location) continue;
        const tr = getTrack(m.id);
        const isMoving = liveSpeed(m) != null;
        const a = anim.current.get(m.id);
        if (!tr || (!isMoving && !a)) continue;
        if (!isMoving && a && a.t >= tr.newest) {
          anim.current.delete(m.id); // stopped, and the replay has caught up
          continue;
        }
        const step = advance(a, tr, now);
        if (!step) continue;
        anim.current.set(m.id, step.pb);
        next.set(m.id, step.shown);
      }
      for (const id of [...anim.current.keys()]) if (!list.some((m) => m.id === id)) anim.current.delete(id);
      setShown(next);

      const { followId: fid, onFollow: follow } = followRef.current;
      const f = fid ? next.get(fid) : undefined;
      if (f && follow && now - lastFollow >= FOLLOW_MS) {
        lastFollow = now;
        follow(f.lat, f.lon);
      }
      if (next.size === 0 && !list.some((m) => liveSpeed(m) != null)) clearInterval(timer);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [moving]);

  return moving || shown.size ? shown : EMPTY;
}

const EMPTY = new Map<string, Shown>();
