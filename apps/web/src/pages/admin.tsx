import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Activity, Copy, Database, FileClock, Plus, Settings2, ShieldCheck, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { useUser } from '@/lib/queries';
import { Avatar, Badge, Button, Card, cx, Dialog, ErrorNote, Input, Select, Skeleton, Stat, Switch } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { useToast } from '@/components/toast';

const SECTIONS = [
  { id: 'overview', label: 'System', icon: Activity },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'audit', label: 'Audit log', icon: FileClock },
] as const;

const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

export default function AdminPage() {
  const { section = 'overview' } = useParams();
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-5 flex items-center gap-3">
        <ShieldCheck className="size-7 text-accent" />
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Administration</h1>
      </div>
      <nav className="scrollbar-none mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.id}
            to={`/admin/${s.id}`}
            className={({ isActive }) => cx('-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[14px] font-semibold', isActive || section === s.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            <s.icon className="size-4" />
            {s.label}
          </NavLink>
        ))}
      </nav>
      {section === 'overview' && <Overview />}
      {section === 'users' && <UsersSection />}
      {section === 'settings' && <SettingsSection />}
      {section === 'audit' && <AuditSection />}
    </div>
  );
}

interface Overview {
  version: string;
  uptimeSec: number;
  node: string;
  memoryMb: number;
  realtimeConnections: number;
  counts: Record<string, number>;
  database: { sizeBytes: number; version: string; postgis: string; tables: { name: string; bytes: number; rows: number }[]; oldestLocation: string | null };
  ingest: { hour: string; accepted: number; rejected: number }[];
  notifications: { last7Days: { type: string; n: number }[] };
  email: boolean;
  geocoder: boolean;
  push: boolean;
}

function Overview() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/api/admin/overview'), refetchInterval: 30_000 });
  const purge = useMutation({
    mutationFn: () => api.del<{ removedUsers: number }>('/api/admin/demo'),
    onSuccess: (r) => {
      toast({ tone: 'success', title: `Removed ${r.removedUsers} demo users and their data` });
      qc.invalidateQueries();
    },
  });
  if (isLoading || !data) return <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  const c = data.counts;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Users', c.users, `${c.sessions} active sessions`],
          ['Circles', c.circles, `${c.places} places`],
          ['Devices', c.devices, `${data.realtimeConnections} live connections`],
          ['Location points', Number(c.locations).toLocaleString(), data.database.oldestLocation ? `since ${format(new Date(data.database.oldestLocation), 'MMM yyyy')}` : 'none yet'],
          ['Trips', c.trips?.toLocaleString(), ''],
          ['Notifications', c.notifications?.toLocaleString(), `${c.notifications_24h} in last 24 h`],
          ['Database', bytes(data.database.sizeBytes), `PostgreSQL ${data.database.version.split(' ')[0]} · PostGIS ${data.database.postgis}`],
          ['Server', `v${data.version}`, `Node ${data.node} · ${data.memoryMb} MB · up ${Math.round(data.uptimeSec / 3600)} h`],
        ].map(([l, v, s]) => (
          <Card key={l as string} className="p-4">
            <Stat label={l} value={v} sub={s} />
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">Location ingestion · last 48 h</h2>
          {data.ingest.length ? (
            <BarChart data={data.ingest.map((r) => ({ label: format(new Date(r.hour), 'HH:mm'), value: r.accepted, tooltip: `${format(new Date(r.hour), 'MMM d HH:mm')} · ${r.accepted} accepted · ${r.rejected} rejected` }))} format={(v) => String(Math.round(v))} />
          ) : (
            <p className="py-10 text-center text-[13px] text-muted">No locations received yet.</p>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-[15px] font-bold">Services</h2>
          <ul className="space-y-2 text-[14px]">
            {[
              ['Email (SMTP)', data.email, 'Set SMTP_URL to enable'],
              ['Geocoding', data.geocoder, 'Set GEOCODER_URL to enable'],
              ['Web push (VAPID)', data.push, ''],
            ].map(([n, ok, hint]) => (
              <li key={n as string} className="flex items-center justify-between gap-2">
                <span className="font-semibold">{n}</span>
                {ok ? <Badge tone="success">On</Badge> : <span className="text-[12px] text-muted">{hint || 'Off'}</span>}
              </li>
            ))}
          </ul>
          <h2 className="mt-6 mb-3 text-[15px] font-bold">Notifications · 7 days</h2>
          <ul className="space-y-1 text-[13px]">
            {data.notifications.last7Days.length === 0 && <li className="text-muted">None</li>}
            {data.notifications.last7Days.map((n) => (
              <li key={n.type} className="flex justify-between">
                <span className="text-ink-2">{n.type.replace('_', ' ')}</span>
                <span className="tnum font-semibold">{n.n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold">
          <Database className="size-4" /> Storage by table
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1.5 font-semibold">Table</th>
                <th className="py-1.5 text-right font-semibold">Rows (est.)</th>
                <th className="py-1.5 text-right font-semibold">Size</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {data.database.tables.map((t) => (
                <tr key={t.name} className="border-t border-line">
                  <td className="py-1.5 font-mono">{t.name}</td>
                  <td className="py-1.5 text-right">{Math.max(0, t.rows).toLocaleString()}</td>
                  <td className="py-1.5 text-right">{bytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {(c.demo_users ?? 0) > 0 && (
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <div className="flex-1">
            <div className="font-bold">Demo data is installed</div>
            <div className="text-[13px] text-muted">{c.demo_users} demo accounts (flagged and separate from real users).</div>
          </div>
          <Button variant="danger" loading={purge.isPending} onClick={() => window.confirm('Remove all demo data?') && purge.mutate()}>
            Remove demo data
          </Button>
        </Card>
      )}
    </div>
  );
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
  isAdmin: boolean;
  isDemo: boolean;
  disabled: boolean;
  emailVerified: boolean;
  totp: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  locations: number;
}

function UsersSection() {
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: users = [] } = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<AdminUser[]>('/api/admin/users') });
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api.patch(`/api/admin/users/${id}`, body), onSuccess: refresh, onError: (e) => toast({ tone: 'error', title: (e as Error).message }) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/admin/users/${id}`), onSuccess: refresh });
  const reset = useMutation({ mutationFn: (id: string) => api.post<{ link: string }>(`/api/admin/users/${id}/reset-link`), onSuccess: (r) => setLink(r.link) });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Create user
        </Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-[13.5px]">
          <thead className="border-b border-line text-left text-[12px] text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Points</th>
              <th className="px-4 py-3 font-semibold">Last active</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={u.displayName} color={u.avatarColor} size={32} dim={u.disabled} />
                    <div>
                      <div className="font-bold">{u.displayName}</div>
                      <div className="text-[12px] text-muted">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.isAdmin && <Badge tone="accent">Admin</Badge>}
                    {u.isDemo && <Badge tone="info">Demo</Badge>}
                    {u.disabled && <Badge tone="danger">Disabled</Badge>}
                    {u.totp && <Badge tone="success">2FA</Badge>}
                    {!u.emailVerified && <Badge>Unverified</Badge>}
                  </div>
                </td>
                <td className="tnum px-4 py-3 text-right">{u.locations.toLocaleString()}</td>
                <td className="px-4 py-3 text-muted">{ago(u.lastSeenAt)}</td>
                <td className="px-4 py-3">
                  {u.id !== me.id && !u.isDemo && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: u.id, body: { isAdmin: !u.isAdmin } })}>
                        {u.isAdmin ? 'Revoke admin' : 'Make admin'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => reset.mutate(u.id)}>
                        Reset link
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabled } })}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => window.confirm(`Permanently delete ${u.displayName} and all their data?`) && del.mutate(u.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onLink={setLink} />
      <Dialog open={link !== null} onClose={() => setLink(null)} title="One-time setup link" description="Send this link to the person. It lets them choose a password and expires in 7 days.">
        <div className="mb-3 rounded-xl bg-surface-2 p-3 font-mono text-[12.5px] break-all">{link}</div>
        <Button className="mb-3 w-full" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(link ?? '')}>
          Copy link
        </Button>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({ open, onClose, onLink }: { open: boolean; onClose: () => void; onLink: (l: string) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: '', displayName: '', password: '', isAdmin: false });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string; setupLink: string | null }>('/api/admin/users', { ...form, password: form.password || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
      setForm({ email: '', displayName: '', password: '', isAdmin: false });
      if (r.setupLink) onLink(r.setupLink);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create user"
      description="Leave the password empty to generate a one-time setup link instead."
      footer={
        <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending}>
          Create
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <Input label="Name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password (optional)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Switch checked={form.isAdmin} onChange={(v) => setForm({ ...form, isAdmin: v })} label="Administrator" />
        <ErrorNote error={create.error} />
      </div>
    </Dialog>
  );
}

interface SysSettings {
  registrationPolicy: 'open' | 'invite' | 'closed';
  defaultRetentionDays: number;
  telemetryEnabled: boolean;
  geocodingEnabled: boolean;
  offlineAfterMinutes: number;
  geofenceCooldownSec: number;
  trip: { departRadiusM: number; endAfterSec: number; minDistanceM: number };
}

function SettingsSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<{ settings: SysSettings; telemetryEndpointConfigured: boolean }>('/api/admin/settings') });
  const [s, setS] = useState<SysSettings | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const payload = useQuery({ queryKey: ['admin', 'telemetry'], enabled: showPayload, queryFn: () => api.get<{ payload: unknown; endpoint: string | null }>('/api/admin/telemetry/preview') });
  const preview = useQuery({ queryKey: ['admin', 'retention-preview', s?.defaultRetentionDays], enabled: Boolean(s && s.defaultRetentionDays > 0 && data && s.defaultRetentionDays !== data.settings.defaultRetentionDays), queryFn: () => api.get<{ affected: { locations: number }[] }>('/api/admin/retention/preview') });
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.patch('/api/admin/settings', s!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['config'] });
      toast({ tone: 'success', title: 'Settings saved' });
    },
    onError: (e) => toast({ tone: 'error', title: (e as Error).message }),
  });
  const runRetention = useMutation({ mutationFn: () => api.post<{ results: unknown[] }>('/api/admin/retention/run'), onSuccess: (r) => toast({ tone: 'success', title: `Retention applied to ${r.results.length} users` }) });
  if (!s) return <Skeleton className="h-96" />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold">Registration</h2>
        <Select label="Who can create accounts" value={s.registrationPolicy} onChange={(e) => setS({ ...s, registrationPolicy: e.target.value as SysSettings['registrationPolicy'] })}>
          <option value="invite">Invite only — needs a circle invitation link</option>
          <option value="open">Open — anyone who can reach this server</option>
          <option value="closed">Closed — administrators create accounts</option>
        </Select>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold">Data retention</h2>
        <Select label="Default history retention" value={s.defaultRetentionDays} onChange={(e) => setS({ ...s, defaultRetentionDays: Number(e.target.value) })}>
          <option value={0}>Keep forever (recommended)</option>
          {[90, 180, 365, 730, 1825].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </Select>
        {preview.data && <p className="text-[12.5px] text-warning">Applying this would affect {preview.data.affected.length} users on the next retention run.</p>}
        <p className="text-[12.5px] text-muted">Users can override this in their own settings. Users are notified whenever history is removed.</p>
        <Button size="sm" onClick={() => window.confirm('Run retention now?') && runRetention.mutate()} loading={runRetention.isPending}>
          Run retention now
        </Button>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold">Trip detection</h2>
        <Input label="Start a trip after moving (m)" type="number" min={50} max={2000} value={s.trip.departRadiusM} onChange={(e) => setS({ ...s, trip: { ...s.trip, departRadiusM: Number(e.target.value) } })} />
        <Input label="End a trip after stopping (seconds)" type="number" min={60} max={3600} value={s.trip.endAfterSec} onChange={(e) => setS({ ...s, trip: { ...s.trip, endAfterSec: Number(e.target.value) } })} />
        <Input label="Ignore trips shorter than (m)" type="number" min={50} max={10000} value={s.trip.minDistanceM} onChange={(e) => setS({ ...s, trip: { ...s.trip, minDistanceM: Number(e.target.value) } })} />
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold">Alerts</h2>
        <Input label="Device offline after (minutes)" type="number" min={10} value={s.offlineAfterMinutes} onChange={(e) => setS({ ...s, offlineAfterMinutes: Number(e.target.value) })} />
        <Input label="Geofence cooldown (seconds)" type="number" min={0} max={3600} value={s.geofenceCooldownSec} onChange={(e) => setS({ ...s, geofenceCooldownSec: Number(e.target.value) })} hint="Suppresses repeated arrive/leave alerts when someone is on the edge of a place." />
        <Switch checked={s.geocodingEnabled} onChange={(v) => setS({ ...s, geocodingEnabled: v })} label="Address lookups" description="Uses the geocoder in GEOCODER_URL. Requests are proxied and cached by the server." />
      </Card>
      <Card className="space-y-4 p-5 lg:col-span-2">
        <h2 className="text-[15px] font-bold">Anonymous usage statistics</h2>
        <Switch
          checked={s.telemetryEnabled}
          onChange={(v) => setS({ ...s, telemetryEnabled: v })}
          label="Share anonymous statistics"
          description="Off by default. Sends only a weekly version number and bucketed counts (e.g. “6–20 users”). Never coordinates, addresses, names, emails, device IDs or circle details."
        />
        {!data?.telemetryEndpointConfigured && <p className="text-[12.5px] text-muted">No TELEMETRY_ENDPOINT is configured, so nothing would be sent even when enabled.</p>}
        <Button size="sm" variant="ghost" onClick={() => setShowPayload((x) => !x)}>
          {showPayload ? 'Hide' : 'Show'} exactly what would be sent
        </Button>
        {showPayload && payload.data && <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 text-[12px]">{JSON.stringify(payload.data.payload, null, 2)}</pre>}
      </Card>
      <div className="lg:col-span-2">
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

function AuditSection() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.get<{ id: string; action: string; target: { type: string; id: string } | null; details: Record<string, unknown>; ip: string | null; actor: string | null; createdAt: string }[]>('/api/admin/audit?limit=200'),
  });
  if (isLoading) return <Skeleton className="h-96" />;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[700px] text-[13px]">
        <thead className="border-b border-line text-left text-[12px] text-muted">
          <tr>
            <th className="px-4 py-2.5 font-semibold">When</th>
            <th className="px-4 py-2.5 font-semibold">Action</th>
            <th className="px-4 py-2.5 font-semibold">Actor</th>
            <th className="px-4 py-2.5 font-semibold">Target</th>
            <th className="px-4 py-2.5 font-semibold">IP</th>
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2 whitespace-nowrap text-muted">{format(new Date(a.createdAt), 'MMM d, HH:mm:ss')}</td>
              <td className="px-4 py-2 font-mono font-semibold">{a.action}</td>
              <td className="px-4 py-2">{a.actor ?? <span className="text-muted">system</span>}</td>
              <td className="px-4 py-2 font-mono text-[12px] text-muted">{a.target ? `${a.target.type}:${a.target.id.slice(0, 8)}` : '—'}</td>
              <td className="px-4 py-2 text-muted">{a.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
