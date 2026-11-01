import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  ChevronDown,
  Compass,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  MapPin,
  MoreHorizontal,
  Route,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useCircles, useMe, useUser } from '@/lib/queries';
import { useRealtime, onServerEvent } from '@/lib/realtime';
import { TrackingProvider } from '@/features/tracking/TrackingProvider';
import { SharingPill } from '@/features/tracking/SharingPill';
import { ActiveCircleProvider, useActiveCircle } from '@/lib/circle-context';
import { useToast } from './toast';
import { Avatar, cx, Dialog, Logo } from './ui';
import { useQueryClient } from '@tanstack/react-query';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/circles', label: 'Circles', icon: Users },
  { to: '/history', label: 'History', icon: CalendarClock },
  { to: '/trips', label: 'Trips', icon: Route },
  { to: '/places', label: 'Places', icon: MapPin },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

const MOBILE_TABS = ['/', '/map', '/history', '/trips'] as const;

function useUnread() {
  const { data } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/api/notifications?limit=1'),
    refetchInterval: 120_000,
  });
  return data?.unread ?? 0;
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useUser();
  return (
    <TrackingProvider me={me}>
      <ActiveCircleProvider>
        <ShellInner>{children}</ShellInner>
      </ActiveCircleProvider>
    </TrackingProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const me = useUser();
  const socket = useRealtime(true);
  const unread = useUnread();
  const toast = useToast();
  const navigate = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const fullBleed = loc.pathname === '/map';

  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === 'notification' && document.visibilityState === 'visible') {
          const url = (e.notification.data?.url as string | undefined) ?? '/notifications';
          toast({ tone: 'info', title: e.notification.title, body: e.notification.body || undefined, action: { label: 'View', onClick: () => navigate(url) } });
        }
      }),
    [toast, navigate],
  );
  useEffect(() => setMore(false), [loc.pathname]);

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-elevated lg:flex">
        <div className="flex h-16 items-center px-5">
          <Logo />
        </div>
        <CircleSwitcher />
        <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n}
              className={({ isActive }) =>
                cx(
                  'group flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition',
                  isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2/60 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon className={cx('size-[18px]', isActive ? 'text-accent' : 'text-muted group-hover:text-ink-2')} />
                  <span className="flex-1">{n.label}</span>
                  {n.to === '/notifications' && unread > 0 && (
                    <span className="tnum rounded-md bg-accent px-1.5 text-[11px] font-bold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
          {me.isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cx('mt-2 flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition', isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2/60')
              }
            >
              <Shield className="size-[18px] text-muted" /> Administration
            </NavLink>
          )}
        </nav>
        <div className="space-y-3 p-3">
          <SharingPill />
          <UserMenu socket={socket} />
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!fullBleed && (
          <header className="safe-top sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-xl lg:hidden">
            <div className="flex h-14 flex-1 items-center gap-2">
              <Logo />
            </div>
            <SharingPill compact />
            <NavLink to="/notifications" className="relative flex size-10 items-center justify-center rounded-xl text-ink-2" aria-label="Notifications">
              <Bell className="size-5" />
              {unread > 0 && <span className="absolute top-2 right-2 size-2.5 rounded-full border-2 border-bg bg-accent" />}
            </NavLink>
          </header>
        )}
        <main className={cx('min-h-0 flex-1', fullBleed ? 'relative' : 'overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0')}>{children}</main>
      </div>

      {/* Mobile tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-elevated/92 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex h-[64px] max-w-lg items-stretch">
          {MOBILE_TABS.map((to) => {
            const n = NAV.find((x) => x.to === to)!;
            return (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold', isActive ? 'text-accent' : 'text-muted')}>
                <n.icon className="size-[22px]" />
                {n.label}
              </NavLink>
            );
          })}
          <button onClick={() => setMore(true)} className={cx('relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold', more ? 'text-accent' : 'text-muted')}>
            <MoreHorizontal className="size-[22px]" />
            More
            {unread > 0 && <span className="absolute top-2.5 right-[calc(50%-16px)] size-2 rounded-full bg-accent" />}
          </button>
        </div>
      </nav>
      <Dialog open={more} onClose={() => setMore(false)} title="More">
        <div className="mb-4">
          <CircleSwitcher inline />
        </div>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {[...NAV.filter((n) => !(MOBILE_TABS as readonly string[]).includes(n.to)), ...(me.isAdmin ? [{ to: '/admin', label: 'Admin', icon: Shield }] : [])].map((n) => (
            <NavLink key={n.to} to={n.to} className="relative flex flex-col items-center gap-2 rounded-2xl bg-surface-2 py-4 text-[13px] font-semibold">
              <n.icon className="size-5 text-accent" />
              {n.label}
              {n.to === '/notifications' && unread > 0 && <span className="tnum absolute top-2 right-2 rounded-md bg-accent px-1.5 text-[10.5px] font-bold leading-[18px] text-white">{unread}</span>}
            </NavLink>
          ))}
        </div>
        <div className="mt-3 pb-2">
          <UserMenu socket={socket} />
        </div>
      </Dialog>
    </div>
  );
}

function CircleSwitcher({ inline }: { inline?: boolean }) {
  const { data: circles } = useCircles();
  const { circleId, setCircleId } = useActiveCircle();
  const [open, setOpen] = useState(false);
  const active = circles?.find((c) => c.id === circleId);
  const navigate = useNavigate();
  return (
    <div className={cx('relative', !inline && 'px-3')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition hover:border-line-strong">
        <div className="flex size-8 items-center justify-center rounded-lg text-white" style={{ background: active?.color ?? 'var(--surface-3)' }}>
          {active ? <Users className="size-4" /> : <Compass className="size-4 text-ink-2" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Circle</div>
          <div className="truncate text-[14px] font-bold">{active?.name ?? 'All circles'}</div>
        </div>
        <ChevronDown className={cx('size-4 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={cx('absolute z-50 mt-1.5 animate-rise rounded-xl border border-line bg-elevated p-1.5 shadow-float', inline ? 'inset-x-0' : 'inset-x-3')}>
            {[{ id: null, name: 'All circles', color: null as string | null, memberCount: undefined as number | undefined }, ...(circles ?? [])].map((c) => (
              <button
                key={c.id ?? 'all'}
                onClick={() => {
                  setCircleId(c.id);
                  setOpen(false);
                }}
                className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] font-semibold hover:bg-surface-2', c.id === circleId && 'bg-surface-2')}
              >
                <span className="size-2.5 rounded-full" style={{ background: c.color ?? 'var(--muted)' }} />
                <span className="flex-1 truncate">{c.name}</span>
                {c.memberCount != null && <span className="text-[12px] text-muted">{c.memberCount}</span>}
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            <button
              onClick={() => {
                setOpen(false);
                navigate('/circles?new=1');
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] font-semibold text-accent-text hover:bg-surface-2"
            >
              + New circle
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu({ socket }: { socket: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (!me) return null;
  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    qc.clear();
    navigate('/login');
  };
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
      <div className="relative">
        <Avatar name={me.displayName} color={me.avatarColor} url={me.avatarUrl} size={34} />
        <span
          title={socket === 'open' ? 'Live updates connected' : 'Reconnecting…'}
          className={cx('absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-elevated', socket === 'open' ? 'bg-success' : 'bg-warning')}
        />
      </div>
      <NavLink to="/settings/account" className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold">{me.displayName}</div>
        <div className="truncate text-[12px] text-muted">{me.email}</div>
      </NavLink>
      <button onClick={logout} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Sign out" title="Sign out">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
