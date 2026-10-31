import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { BarChart3, RefreshCw, Route } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { formatDistance, formatDuration } from '@/lib/format';
import { useLive, useUser } from '@/lib/queries';
import type { Trip } from '@/lib/types';
import { Avatar, Button, Card, cx, EmptyState, ErrorNote, Skeleton, Stat } from '@/components/ui';
import { TripRow } from '@/features/trips/TripRow';
import { useToast } from '@/components/toast';
import { useQueryClient } from '@tanstack/react-query';

export default function TripsPage() {
  const me = useUser();
  const units = me.preferences.units;
  const [params, setParams] = useSearchParams();
  const memberId = params.get('member') ?? me.id;
  const { data: members = [] } = useLive(null);
  const member = members.find((m) => m.id === memberId);
  const toast = useToast();
  const qc = useQueryClient();

  const q = useInfiniteQuery({
    queryKey: ['trips', memberId, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Trip[]>(`/api/trips${qs({ userId: memberId, limit: 30, before: pageParam })}`),
    getNextPageParam: (last) => (last.length === 30 ? last[last.length - 1]!.startedAt : null),
  });
  const trips = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  const groups = useMemo(() => {
    const g = new Map<string, Trip[]>();
    for (const t of trips) {
      const k = format(new Date(t.startedAt), 'yyyy-MM-dd');
      g.set(k, [...(g.get(k) ?? []), t]);
    }
    return [...g.entries()];
  }, [trips]);
  const week = trips.filter((t) => Date.parse(t.startedAt) > Date.now() - 7 * 86400_000 && t.status === 'completed');

  const rebuild = async () => {
    try {
      const r = await api.post<{ trips: number }>('/api/trips/rebuild');
      toast({ tone: 'success', title: `Recomputed ${r.trips} trips from your history` });
      qc.invalidateQueries({ queryKey: ['trips'] });
    } catch (e) {
      toast({ tone: 'error', title: (e as Error).message });
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Trips</h1>
          <p className="mt-1 text-[14px] text-muted">Detected automatically from movement — no need to start or stop anything.</p>
        </div>
        <Link to={`/trips/insights${memberId !== me.id ? `?member=${memberId}` : ''}`}>
          <Button icon={<BarChart3 className="size-4" />}>Insights</Button>
        </Link>
      </div>

      <div className="scrollbar-none -mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => setParams(m.id === me.id ? {} : { member: m.id })}
            className={cx('flex shrink-0 items-center gap-2 rounded-xl border py-1.5 pr-3 pl-1.5 text-[13px] font-semibold transition', m.id === memberId ? 'border-accent bg-accent-soft' : 'border-line bg-surface text-ink-2 hover:border-line-strong')}
          >
            <Avatar name={m.displayName} color={m.avatarColor} size={24} />
            {m.id === me.id ? 'You' : m.displayName.split(' ')[0]}
          </button>
        ))}
      </div>

      <Card className="mb-5 grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Trips · 7 days" value={week.length} />
        <Stat label="Distance" value={formatDistance(week.reduce((s, t) => s + t.distanceM, 0), units)} />
        <Stat label="Time travelling" value={formatDuration(week.reduce((s, t) => s + t.durationSec, 0))} />
        <Stat label="Longest" value={formatDistance(Math.max(0, ...week.map((t) => t.distanceM)), units)} />
      </Card>

      <ErrorNote error={q.error} />
      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : trips.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Route className="size-7" />}
            title="No trips yet"
            body={`Trips are created when ${memberId === me.id ? 'you move' : `${member?.displayName.split(' ')[0] ?? 'they move'}`} more than a few hundred metres and then stay put for a few minutes.`}
            action={memberId === me.id ? <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={rebuild}>Recompute from history</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, list]) => (
            <Card key={day} className="p-2">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <div className="text-[13px] font-bold">{format(new Date(`${day}T12:00:00`), 'EEEE, MMMM d')}</div>
                <div className="tnum text-[12px] text-muted">{formatDistance(list.reduce((s, t) => s + t.distanceM, 0), units)}</div>
              </div>
              {list.map((t) => (
                <TripRow key={t.id} trip={t} compact />
              ))}
            </Card>
          ))}
          {q.hasNextPage && (
            <Button className="w-full" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              Load older trips
            </Button>
          )}
          {memberId === me.id && (
            <p className="text-center text-[12.5px] text-muted">
              Something look off?{' '}
              <button className="font-semibold text-accent-text" onClick={rebuild}>
                Recompute trips
              </button>{' '}
              from your full history.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
