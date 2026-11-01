import { useNavigate, Link } from 'react-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { BatteryWarning, Bell, CheckCheck, Clock3, Eye, LogIn, LogOut, MapPin, ShieldAlert, Trash2, UserPlus, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { ago } from '@/lib/format';
import type { AppNotification } from '@/lib/types';
import { Button, Card, cx, EmptyState, IconButton, Skeleton } from '@/components/ui';

const ICONS: Record<string, { icon: typeof Bell; tone: string }> = {
  arrival: { icon: LogIn, tone: 'text-success bg-success/12' },
  departure: { icon: LogOut, tone: 'text-warning bg-warning/12' },
  member_joined: { icon: UserPlus, tone: 'text-info bg-info/12' },
  check_in: { icon: MapPin, tone: 'text-accent bg-accent-soft' },
  invitation: { icon: UserPlus, tone: 'text-info bg-info/12' },
  sharing_changed: { icon: Eye, tone: 'text-ink-2 bg-surface-2' },
  low_battery: { icon: BatteryWarning, tone: 'text-danger bg-danger/12' },
  device_offline: { icon: Clock3, tone: 'text-warning bg-warning/12' },
  security: { icon: ShieldAlert, tone: 'text-danger bg-danger/12' },
  retention: { icon: Trash2, tone: 'text-ink-2 bg-surface-2' },
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ items: AppNotification[]; unread: number }>(`/api/notifications${qs({ limit: 30, before: pageParam })}`),
    getNextPageParam: (last) => (last.items.length === 30 ? last.items[last.items.length - 1]!.createdAt : null),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({ mutationFn: () => api.post('/api/notifications/read', { all: true }), onSuccess: refresh });
  const markOne = useMutation({ mutationFn: (id: string) => api.post('/api/notifications/read', { ids: [id] }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/notifications/${id}`), onSuccess: refresh });
  const clearRead = useMutation({ mutationFn: () => api.del('/api/notifications'), onSuccess: refresh });

  let lastGroup = '';
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Notifications</h1>
          <p className="mt-1 text-[14px] text-muted">
            {unread > 0 ? `${unread} unread` : 'You’re all caught up.'} ·{' '}
            <Link to="/settings/notifications" className="font-semibold text-accent-text">
              Preferences
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => clearRead.mutate()}>
            Clear read
          </Button>
          <Button size="sm" icon={<CheckCheck className="size-4" />} onClick={() => markAll.mutate()} disabled={unread === 0}>
            Mark all read
          </Button>
        </div>
      </div>
      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<Bell className="size-7" />} title="Nothing here yet" body="Arrivals, departures, low battery warnings and circle activity will show up here." />
        </Card>
      ) : (
        <Card className="overflow-hidden p-1.5">
          {items.map((n) => {
            const d = new Date(n.createdAt);
            const group = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE, MMMM d');
            const header = group !== lastGroup ? (lastGroup = group) : null;
            const meta = ICONS[n.type] ?? { icon: Bell, tone: 'text-accent bg-accent-soft' };
            const url = n.data.url as string | undefined;
            return (
              <div key={n.id}>
                {header && <div className="eyebrow px-3.5 pt-3 pb-1.5">{header}</div>}
                <div
                  className={cx('group flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-surface-2', !n.readAt && 'bg-accent-soft/40')}
                  onClick={() => {
                    if (!n.readAt) markOne.mutate(n.id);
                    const target = url ?? (n.data.userId ? `/map?member=${n.data.userId}` : n.data.circleId ? `/circles/${n.data.circleId}` : null);
                    if (target) navigate(target);
                  }}
                >
                  <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', meta.tone)}>
                    <meta.icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold">{n.title}</div>
                    {n.body && <div className="mt-0.5 text-[13px] text-muted">{n.body}</div>}
                    <div className="mt-1 text-[12px] text-muted">
                      {ago(n.createdAt)} · {format(d, 'h:mm a')}
                    </div>
                  </div>
                  {!n.readAt && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-accent" />}
                  <IconButton
                    label="Delete"
                    className="size-8 opacity-0 group-hover:opacity-100 max-sm:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove.mutate(n.id);
                    }}
                  >
                    <X className="size-4" />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </Card>
      )}
      {q.hasNextPage && (
        <Button className="mt-4 w-full" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
