import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  Check,
  Plus,
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
      <aside className="hidden w-[264px] shrink-0 flex-col bg-bg lg:flex">
        <div className="flex h-[72px] items-center px-6">
          <Logo />
        </div>
        <CircleSwitcher />
        <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n}
              className={({ isActive }) =>
                cx(
                  'group flex h-11 items-center gap-3 rounded-[14px] px-3.5 text-[15px] font-semibold transition',
                  isActive ? 'bg-accent text-on-accent' : 'text-ink hover:bg-surface',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon className={cx('size-[19px]', isActive ? 'text-on-accent' : 'text-accent-text')} />
                  <span className="flex-1">{n.label}</span>
                  {n.to === '/notifications' && unread > 0 && (
                    <span className={cx('tnum rounded-full px-2 text-[12px] font-bold leading-5', isActive ? 'bg-white/25 text-white' : 'bg-accent text-on-accent')}>{unread > 99 ? '99+' : unread}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
          {me.isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cx('group mt-3 flex h-11 items-center gap-3 rounded-[14px] px-3.5 text-[15px] font-semibold transition', isActive ? 'bg-accent text-on-accent' : 'text-ink hover:bg-surface')
              }
            >
              <Shield className="size-[19px] text-muted group-[.bg-accent]:text-on-accent" /> Administration
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
          <header className="safe-top sticky top-0 z-30 flex items-center gap-3 bg-bg/80 px-4 backdrop-blur-xl backdrop-saturate-150 lg:hidden">
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
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-elevated/80 backdrop-blur-2xl backdrop-saturate-150 lg:hidden">
        <div className="mx-auto flex h-[64px] max-w-lg items-stretch">
          {MOBILE_TABS.map((to) => {
            const n = NAV.find((x) => x.to === to)!;
            return (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold', isActive ? 'text-accent-text' : 'text-muted')}>
                <n.icon className="size-[22px]" />
                {n.label}
              </NavLink>
            );
          })}
          <button onClick={() => setMore(true)} className={cx('relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold', more ? 'text-accent-text' : 'text-muted')}>
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
            <NavLink key={n.to} to={n.to} className="relative flex flex-col items-center gap-2 rounded-[22px] bg-surface-2 py-4 text-[14px] font-semibold">
              <n.icon className="size-5 text-accent-text" />
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

/**
 * The circle picker, styled like the iOS top bar: a pill with the circle's
 * colour, its name and member count. `glass` floats it over the map.
 */
export function CircleSwitcher({ inline, glass }: { inline?: boolean; glass?: boolean }) {
  const { data: circles } = useCircles();
  const { circleId, setCircleId } = useActiveCircle();
  const [open, setOpen] = useState(false);
  const active = circles?.find((c) => c.id === circleId);
  const navigate = useNavigate();
  const sub = active ? `${active.memberCount} ${active.memberCount === 1 ? 'member' : 'members'}` : `${circles?.length ?? 0} ${circles?.length === 1 ? 'circle' : 'circles'}`;
  return (
    <div className={cx('relative', !inline && !glass && 'px-3')}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          'flex w-full items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5 text-left transition',
          glass ? 'glass h-[52px]' : 'bg-surface-2 hover:bg-surface-3',
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: active?.color ?? 'var(--accent)' }}>
          {active ? <Users className="size-[18px]" /> : <Compass className="size-[18px]" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] leading-tight font-bold">{active?.name ?? 'All circles'}</span>
          <span className="block truncate text-[13px] text-muted">{sub}</span>
        </span>
        <ChevronDown className={cx('size-5 shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={cx('absolute z-50 mt-2 animate-rise rounded-[24px] bg-elevated p-2 shadow-float', inline || glass ? 'inset-x-0' : 'inset-x-3')}>
            {[{ id: null, name: 'All circles', color: null as string | null, memberCount: undefined as number | undefined }, ...(circles ?? [])].map((c) => (
              <button
                key={c.id ?? 'all'}
                onClick={() => {
                  setCircleId(c.id);
                  setOpen(false);
                }}
                className={cx('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] font-semibold hover:bg-surface-2', c.id === circleId && 'bg-surface-2')}
              >
                <span className="flex size-8 items-center justify-center rounded-full text-white" style={{ background: c.color ?? 'var(--accent)' }}>
                  {c.id ? <Users className="size-4" /> : <Compass className="size-4" />}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                {c.memberCount != null && <span className="text-[13px] text-muted">{c.memberCount}</span>}
                {c.id === circleId && <Check className="size-4 text-accent-text" />}
              </button>
            ))}
            <div className="mx-3 my-1 h-px bg-line" />
            <button
              onClick={() => {
                setOpen(false);
                navigate('/circles?new=1');
              }}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] font-semibold text-accent-text hover:bg-surface-2"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft">
                <Plus className="size-4" />
              </span>
              New circle
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
