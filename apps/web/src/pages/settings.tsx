import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import {
  Bell,
  Copy,
  Database,
  Download,
  Fingerprint,
  KeyRound,
  Laptop,
  MapPinned,
  Monitor,
  Moon,
  Palette,
  Plus,
  Shield,
  Smartphone,
  Sun,
  Trash2,
  User,
} from 'lucide-react';
import type { Me, ThemePreference } from '@nodara/shared';
import { api } from '@/lib/api';
import { ago, userAgentSummary } from '@/lib/format';
import { useConfig, useUser } from '@/lib/queries';
import { applyTheme } from '@/lib/theme';
import { disablePush, enablePush, pushSupport } from '@/lib/push';
import type { Device, PasskeyInfo, SessionInfo } from '@/lib/types';
import { Avatar, Badge, Button, Card, cx, Dialog, ErrorNote, IconButton, Input, Segmented, Select, Switch } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useTracking } from '@/features/tracking/TrackingProvider';
import { SharingPanel } from '@/features/tracking/SharingPanel';
import { ColorPicker } from './circles';

const SECTIONS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'privacy', label: 'Location & privacy', icon: MapPinned },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance & units', icon: Palette },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'data', label: 'Your data', icon: Database },
] as const;

function useSaveMe() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: object) => api.patch<Me>('/api/me', body),
    onSuccess: (me) => qc.setQueryData(['me'], me),
    onError: (e) => toast({ tone: 'error', title: (e as Error).message }),
  });
}

export default function SettingsPage() {
  const { section = 'account' } = useParams();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="mb-5 text-[28px] font-extrabold tracking-[-0.03em]">Settings</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:w-56 md:shrink-0 md:flex-col md:px-0">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.id}
              to={`/settings/${s.id}`}
              className={({ isActive }) =>
                cx(
                  'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] font-semibold whitespace-nowrap transition',
                  isActive || (section === s.id) ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2/60',
                )
              }
            >
              <s.icon className="size-4 text-muted" />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-5">
          {section === 'account' && <AccountSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'devices' && <DevicesSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'data' && <DataSection />}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx('p-5 sm:p-6', className)}>
      <h2 className="text-[16px] font-bold tracking-tight">{title}</h2>
      {description && <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function AccountSection() {
  const me = useUser();
  const save = useSaveMe();
  const toast = useToast();
  const [name, setName] = useState(me.displayName);
  const resend = useMutation({ mutationFn: () => api.post('/api/auth/resend-verification'), onSuccess: () => toast({ tone: 'success', title: 'Verification email sent' }) });
  return (
    <>
      <Panel title="Profile">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Avatar name={me.displayName} color={me.avatarColor} url={me.avatarUrl} size={72} />
            <ProfilePhotoButtons hasPhoto={Boolean(me.avatarUrl)} />
          </div>
          <div>
            <div className="text-[17px] font-bold">{me.displayName}</div>
            <div className="text-[13.5px] text-muted">
              {me.email} {me.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Unverified</Badge>}
            </div>
            {me.isAdmin && <Badge tone="accent" className="mt-1">Administrator</Badge>}
          </div>
        </div>
        <div className="mt-6 space-y-5">
          <div className="flex gap-2">
            <Input className="flex-1" label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <Button className="self-end" variant="primary" disabled={!name.trim() || name === me.displayName} loading={save.isPending} onClick={() => save.mutate({ displayName: name })}>
              Save
            </Button>
          </div>
          <div>
            <div className="label mb-2">Map colour</div>
            <ColorPicker value={me.avatarColor} onChange={(c) => save.mutate({ avatarColor: c })} />
          </div>
          {!me.emailVerified && (
            <Button size="sm" onClick={() => resend.mutate()} loading={resend.isPending}>
              Resend verification email
            </Button>
          )}
        </div>
      </Panel>
    </>
  );
}

/** Resize a picked image to a 512×512 JPEG in the browser before uploading. */
async function squareJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function ProfilePhotoButtons({ hasPhoto }: { hasPhoto: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const done = (me: Me) => {
    qc.setQueryData(['me'], me);
    qc.invalidateQueries({ queryKey: ['live'] });
  };
  const fail = (e: unknown) => toast({ tone: 'error', title: (e as Error).message });
  const upload = useMutation({ mutationFn: async (file: File) => api.put<Me>('/api/me/avatar', { image: await squareJpeg(file) }), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: () => api.del<Me>('/api/me/avatar'), onSuccess: done, onError: fail });
  return (
    <div className="flex gap-1">
      <label className="cursor-pointer rounded-md px-2 py-1 text-[12.5px] font-semibold text-accent-text hover:bg-surface-2">
        {upload.isPending ? 'Uploading…' : hasPhoto ? 'Change' : 'Add photo'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = '';
          }}
        />
      </label>
      {hasPhoto && (
        <button type="button" className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-danger hover:bg-surface-2" onClick={() => remove.mutate()} disabled={remove.isPending}>
          Remove
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PrivacySection() {
  const me = useUser();
  const save = useSaveMe();
  const p = me.preferences;
  return (
    <>
      <Panel title="Location sharing" description="Who can see you, and what this device sends.">
        <SharingPanel />
      </Panel>
      <Panel title="Updates from this browser" description="How often this device reports your location while Nodara is open.">
        <div className="space-y-4">
          <Select label="Update interval" value={p.updateIntervalSec} onChange={(e) => save.mutate({ preferences: { updateIntervalSec: Number(e.target.value) } })}>
            {[10, 15, 30, 60, 120, 300].map((s) => (
              <option key={s} value={s}>
                Every {s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}`}
              </option>
            ))}
          </Select>
          <Switch checked={p.adaptiveInterval} onChange={(v) => save.mutate({ preferences: { adaptiveInterval: v } })} label="Adaptive updates" description="Update more often while moving and less often while still, to save battery." />
          <Switch checked={p.highAccuracy} onChange={(v) => save.mutate({ preferences: { highAccuracy: v } })} label="High accuracy" description="Use GPS for the best precision. Uses more battery." />
        </div>
      </Panel>
      <Panel title="Battery alerts" description="Let your circles know when your phone is about to die (on devices that report battery).">
        <div className="space-y-4">
          <Switch checked={p.notifyLowBattery} onChange={(v) => save.mutate({ preferences: { notifyLowBattery: v } })} label="Notify my circles when my battery is low" />
          <Select label="Low battery threshold" value={p.lowBatteryThreshold} onChange={(e) => save.mutate({ preferences: { lowBatteryThreshold: Number(e.target.value) } })} disabled={!p.notifyLowBattery}>
            {[5, 10, 15, 20, 25].map((v) => (
              <option key={v} value={v}>
                {v}%
              </option>
            ))}
          </Select>
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function DevicesSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const tracking = useTracking();
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: () => api.get<Device[]>('/api/devices') });
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState<{ token: string; device: Device } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/devices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      toast({ tone: 'success', title: 'Device removed' });
    },
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api.post<{ token: string; device: Device }>(`/api/devices/${id}/token`),
    onSuccess: (r) => setToken(r),
  });
  const icon = (k: Device['kind']) => (k === 'web' ? Laptop : Smartphone);
  return (
    <>
      <Panel title="Your devices" description="Anything that reports your location. Removing a device revokes its access immediately; its history is kept.">
        <ul className="divide-y divide-line">
          {devices.map((d) => {
            const I = icon(d.kind);
            return (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-surface-2">
                  <I className="size-5 text-ink-2" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14.5px] font-bold">
                    {d.name}
                    {d.id === tracking.deviceId && <Badge tone="accent">This browser</Badge>}
                    {d.pushEnabled && <Badge>Push</Badge>}
                  </div>
                  <div className="text-[12.5px] text-muted">
                    {d.kind} · last location {ago(d.lastLocationAt)}
                    {d.tokenHint && ` · token …${d.tokenHint}`}
                  </div>
                </div>
                {d.kind !== 'web' && (
                  <Button size="sm" variant="ghost" onClick={() => window.confirm('Create a new token? The old one stops working.') && rotate.mutate(d.id)}>
                    New token
                  </Button>
                )}
                <IconButton label="Remove device" onClick={() => window.confirm(`Remove ${d.name}?`) && remove.mutate(d.id)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
        <Button className="mt-4" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          Connect an app
        </Button>
      </Panel>
      <Panel
        title="Reliable background tracking"
        description="Browsers can’t share your location in the background. Until Nodara’s native apps ship, you can use these open-source apps — they send locations straight to your Nodara server with full background support."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line p-4">
            <div className="font-bold">OwnTracks</div>
            <div className="mt-1 text-[13px] text-muted">iOS & Android · HTTP mode</div>
          </div>
          <div className="rounded-2xl border border-line p-4">
            <div className="font-bold">Overland</div>
            <div className="mt-1 text-[13px] text-muted">iOS · GeoJSON batches</div>
          </div>
        </div>
      </Panel>
      <AddDeviceDialog open={adding} onClose={() => setAdding(false)} onCreated={(r) => setToken(r)} />
      {token && <TokenDialog data={token} onClose={() => setToken(null)} />}
    </>
  );
}

function AddDeviceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: { token: string; device: Device }) => void }) {
  const [kind, setKind] = useState<'owntracks' | 'overland' | 'other'>('owntracks');
  const [name, setName] = useState('My phone');
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post<{ token: string; device: Device }>('/api/devices', { name, kind }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      onClose();
      onCreated(r);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect an app"
      description="Creates a device token that can only submit locations — it can't read anything."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending}>
            Create token
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Select label="App" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="owntracks">OwnTracks (iOS / Android)</option>
          <option value="overland">Overland (iOS)</option>
          <option value="other">Other / custom client</option>
        </Select>
        <Input label="Device name" value={name} onChange={(e) => setName(e.target.value)} />
        <ErrorNote error={create.error} />
      </div>
    </Dialog>
  );
}

function TokenDialog({ data, onClose }: { data: { token: string; device: Device }; onClose: () => void }) {
  const origin = window.location.origin;
  const me = useUser();
  const copy = (s: string) => void navigator.clipboard.writeText(s);
  const rows: [string, string][] =
    data.device.kind === 'owntracks'
      ? [
          ['Mode', 'HTTP'],
          ['URL', `${origin}/api/ingest/owntracks`],
          ['Authentication', 'On'],
          ['Username', me.email],
          ['Password', data.token],
        ]
      : data.device.kind === 'overland'
        ? [['Receiver endpoint', `${origin}/api/ingest/overland?token=${data.token}`]]
        : [
            ['Endpoint', `${origin}/api/locations`],
            ['Header', `Authorization: Bearer ${data.token}`],
          ];
  return (
    <Dialog open onClose={onClose} title={`Set up ${data.device.name}`} description="Copy these settings into the app now — the token is shown only once." wide>
      <div className="space-y-2 pb-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
            <div className="w-36 shrink-0 text-[12.5px] font-bold text-muted">{k}</div>
            <div className="min-w-0 flex-1 font-mono text-[12.5px] break-all">{v}</div>
            <IconButton label={`Copy ${k}`} onClick={() => copy(v)}>
              <Copy className="size-4" />
            </IconButton>
          </div>
        ))}
        <p className="pt-2 text-[12.5px] text-muted">
          See <code>docs/clients.md</code> for step-by-step instructions. Use HTTPS so the token is never sent in clear text.
        </p>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
type NotifKey = 'places' | 'circle' | 'sharing' | 'lowBattery' | 'deviceOffline';
const NOTIF_TYPES: { key: NotifKey; label: string; description: string }[] = [
  { key: 'places', label: 'Arrivals & departures', description: 'When people reach or leave places you have alerts on.' },
  { key: 'circle', label: 'Circle activity', description: 'When someone joins one of your circles.' },
  { key: 'sharing', label: 'Sharing changes', description: 'When someone pauses or resumes sharing with you.' },
  { key: 'lowBattery', label: 'Low battery', description: "When someone's phone is about to run out." },
  { key: 'deviceOffline', label: 'Device offline', description: 'When a device stops reporting location.' },
];

function NotificationsSection() {
  const me = useUser();
  const save = useSaveMe();
  const toast = useToast();
  const tracking = useTracking();
  const { data: config } = useConfig();
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: () => api.get<Device[]>('/api/devices') });
  const qc = useQueryClient();
  const support = pushSupport();
  const thisDevice = devices.find((d) => d.id === tracking.deviceId);
  const [busy, setBusy] = useState(false);
  const prefs = ((me.preferences as unknown as { notifications?: Record<string, { inApp?: boolean; push?: boolean }> }).notifications ?? {}) as Record<string, { inApp?: boolean; push?: boolean }>;
  const set = (key: NotifKey, field: 'inApp' | 'push', v: boolean) => save.mutate({ preferences: { notifications: { ...prefs, [key]: { ...prefs[key], [field]: v } } } });

  const togglePush = async (on: boolean) => {
    setBusy(true);
    try {
      let deviceId = tracking.deviceId;
      if (!deviceId) {
        const r = await api.post<{ device: Device }>('/api/devices', { name: 'This browser', kind: 'web' });
        deviceId = r.device.id;
        localStorage.setItem(`nodara.device.${me.id}`, JSON.stringify(deviceId));
      }
      if (on) {
        await enablePush(deviceId, config!.webPushPublicKey!);
        await api.post(`/api/devices/${deviceId}/push/test`);
        toast({ tone: 'success', title: 'Push notifications enabled', body: 'A test notification is on its way.' });
      } else {
        await disablePush(deviceId);
      }
      qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (e) {
      toast({ tone: 'error', title: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel title="Push notifications" description="Get alerts on this device even when Nodara is closed.">
        {support.supported && config?.webPushPublicKey ? (
          <Switch checked={Boolean(thisDevice?.pushEnabled)} onChange={(v) => void togglePush(v)} disabled={busy} label="Push on this device" description="Delivered via your browser vendor's push service, end-to-end encrypted." />
        ) : (
          <p className="rounded-xl bg-surface-2 p-3.5 text-[13.5px] text-muted">{support.reason ?? 'Push is not available on this server.'}</p>
        )}
      </Panel>
      <Panel title="What to notify me about" description="In-app notifications appear in Nodara; push goes to devices where you enabled it.">
        <div className="divide-y divide-line">
          {NOTIF_TYPES.map((t) => (
            <div key={t.key} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">{t.label}</div>
                <div className="text-[12.5px] text-muted">{t.description}</div>
              </div>
              <label className="flex flex-col items-center gap-1 text-[11px] font-bold text-muted">
                In-app
                <Switch checked={prefs[t.key]?.inApp !== false} onChange={(v) => set(t.key, 'inApp', v)} />
              </label>
              <label className="flex flex-col items-center gap-1 text-[11px] font-bold text-muted">
                Push
                <Switch checked={prefs[t.key]?.push !== false} onChange={(v) => set(t.key, 'push', v)} />
              </label>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted">Per-circle muting is in each circle’s settings. Per-place alerts are on the Places page.</p>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function AppearanceSection() {
  const me = useUser();
  const save = useSaveMe();
  const { data: config } = useConfig();
  const setTheme = (t: ThemePreference) => {
    applyTheme(t);
    save.mutate({ preferences: { theme: t } });
  };
  return (
    <>
      <Panel title="Theme">
        <div className="grid grid-cols-3 gap-3">
          {([
            ['system', 'System', Monitor],
            ['light', 'Light', Sun],
            ['dark', 'Dark', Moon],
          ] as const).map(([v, label, I]) => (
            <button key={v} onClick={() => setTheme(v)} className={cx('flex flex-col items-center gap-2 rounded-2xl border p-4 text-[14px] font-semibold transition', me.preferences.theme === v ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}>
              <I className="size-5" />
              {label}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Units">
        <Segmented value={me.preferences.units} onChange={(u) => save.mutate({ preferences: { units: u } })} options={[{ value: 'metric', label: 'Kilometres (km/h)' }, { value: 'imperial', label: 'Miles (mph)' }]} />
      </Panel>
      <Panel title="Map style" description="Tile servers are configured by your administrator.">
        <Select value={me.preferences.mapStyle ?? ''} onChange={(e) => save.mutate({ preferences: { mapStyle: e.target.value || null } })}>
          <option value="">Automatic — match light/dark theme</option>
          {config?.mapStyles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
function SecuritySection() {
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const changePw = useMutation({
    mutationFn: () => api.post('/api/auth/password', pw),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      toast({ tone: 'success', title: 'Password changed', body: 'Other sessions were signed out.' });
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const { data: sessions = [] } = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionInfo[]>('/api/auth/sessions') });
  const { data: passkeys = [] } = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<PasskeyInfo[]>('/api/auth/passkeys') });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/api/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const revokeOthers = useMutation({ mutationFn: () => api.post('/api/auth/sessions/revoke-others'), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const removePk = useMutation({ mutationFn: (id: string) => api.del(`/api/auth/passkeys/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['passkeys'] }); qc.invalidateQueries({ queryKey: ['me'] }); } });
  const addPasskey = async () => {
    try {
      const { challengeId, options } = await api.post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/api/auth/passkeys/register/options');
      const response = await startRegistration({ optionsJSON: options });
      const name = window.prompt('Name this passkey', `${navigator.platform || 'Device'} passkey`) ?? 'Passkey';
      await api.post('/api/auth/passkeys/register/verify', { challengeId, response, name });
      qc.invalidateQueries({ queryKey: ['passkeys'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast({ tone: 'success', title: 'Passkey added' });
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError') toast({ tone: 'error', title: (e as Error).message });
    }
  };
  return (
    <>
      <Panel title="Password">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input type="password" label="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          <Input type="password" label="New password" autoComplete="new-password" minLength={10} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint="At least 10 characters" />
        </div>
        <ErrorNote error={changePw.error} className="mt-3" />
        <Button className="mt-4" variant="primary" icon={<KeyRound className="size-4" />} disabled={!pw.currentPassword || pw.newPassword.length < 10} loading={changePw.isPending} onClick={() => changePw.mutate()}>
          Change password
        </Button>
      </Panel>
      <TotpPanel enabled={me.totpEnabled} />
      <Panel title="Passkeys" description="Sign in with Face ID, Touch ID, Windows Hello or a security key — no password needed.">
        <ul className="divide-y divide-line">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <Fingerprint className="size-5 text-muted" />
              <div className="flex-1">
                <div className="text-[14px] font-semibold">{p.name}</div>
                <div className="text-[12px] text-muted">Added {format(new Date(p.createdAt), 'MMM d, yyyy')} · last used {ago(p.lastUsedAt)}</div>
              </div>
              <IconButton label="Remove passkey" onClick={() => window.confirm('Remove this passkey?') && removePk.mutate(p.id)}>
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
        {'PublicKeyCredential' in window ? (
          <Button className="mt-3" icon={<Plus className="size-4" />} onClick={addPasskey}>
            Add a passkey
          </Button>
        ) : (
          <p className="text-[13px] text-muted">This browser doesn’t support passkeys.</p>
        )}
      </Panel>
      <Panel title="Active sessions" description="Places where you're signed in.">
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <Monitor className="size-5 text-muted" />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[14px] font-semibold">
                  {userAgentSummary(s.userAgent)} {s.current && <Badge tone="success">This session</Badge>}
                </div>
                <div className="text-[12px] text-muted">
                  {s.ip ?? 'unknown IP'} · active {ago(s.lastSeenAt)} · signed in {format(new Date(s.createdAt), 'MMM d')}
                </div>
              </div>
              {!s.current && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <Button className="mt-3" size="sm" variant="danger" onClick={() => revokeOthers.mutate()}>
            Sign out all other sessions
          </Button>
        )}
      </Panel>
    </>
  );
}

function TotpPanel({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const start = useMutation({
    mutationFn: () => api.post<{ secret: string; uri: string }>('/api/auth/totp/setup'),
    onSuccess: async (r) => setSetup({ ...r, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }) }),
  });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/auth/totp/enable', { code }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const disable = useMutation({
    mutationFn: () => api.post('/api/auth/totp/disable', { password }),
    onSuccess: () => {
      setDisabling(false);
      setPassword('');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <Panel title="Two-step verification" description="Require a code from an authenticator app (like Aegis, 2FAS, 1Password or Google Authenticator) when signing in with a password.">
      {enabled ? (
        <div className="flex items-center gap-3">
          <Badge tone="success">Enabled</Badge>
          <Button size="sm" variant="danger" onClick={() => setDisabling(true)}>
            Turn off
          </Button>
        </div>
      ) : setup ? (
        <div className="flex flex-col gap-5 sm:flex-row">
          <img src={setup.qr} alt="Authenticator QR code" className="size-[180px] rounded-xl bg-white p-2" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-[13.5px]">Scan the code, or enter this key manually:</p>
            <code className="block rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] break-all">{setup.secret}</code>
            <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            <ErrorNote error={enable.error} />
            <Button variant="primary" onClick={() => enable.mutate()} loading={enable.isPending} disabled={code.length < 6}>
              Verify & enable
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => start.mutate()} loading={start.isPending} icon={<Shield className="size-4" />}>
          Set up two-step verification
        </Button>
      )}
      <Dialog open={codes !== null} onClose={() => setCodes(null)} title="Save your recovery codes" description="Each code works once if you lose your authenticator. Store them somewhere safe — they won't be shown again.">
        <div className="grid grid-cols-2 gap-2 pb-3 font-mono text-[14px]">
          {codes?.map((c) => (
            <div key={c} className="rounded-lg bg-surface-2 px-3 py-2 text-center">
              {c}
            </div>
          ))}
        </div>
        <Button className="mb-3 w-full" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(codes?.join('\n') ?? '')}>
          Copy codes
        </Button>
      </Dialog>
      <Dialog
        open={disabling}
        onClose={() => setDisabling(false)}
        title="Turn off two-step verification?"
        footer={
          <Button variant="danger" onClick={() => disable.mutate()} loading={disable.isPending}>
            Turn off
          </Button>
        }
      >
        <Input type="password" label="Confirm your password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote error={disable.error} className="mt-3" />
      </Dialog>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
function DataSection() {
  const me = useUser();
  const save = useSaveMe();
  const { data: config } = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState({ password: '', confirm: '' });
  const [clearFrom, setClearFrom] = useState('');
  const [clearTo, setClearTo] = useState('');
  const del = useMutation({
    mutationFn: () => api.del('/api/me', confirm),
    onSuccess: () => {
      qc.clear();
      navigate('/login');
    },
  });
  const clear = useMutation({
    mutationFn: () => api.del<{ deleted: number }>(`/api/history/points?from=${new Date(clearFrom).toISOString()}&to=${new Date(clearTo).toISOString()}`),
    onSuccess: (r) => {
      toast({ tone: 'success', title: `Deleted ${r.deleted.toLocaleString()} location points` });
      qc.invalidateQueries();
    },
  });
  const retention = me.preferences.retentionDays;
  const serverDefault = config?.defaultRetentionDays;
  useEffect(() => {
    const now = new Date();
    setClearTo(format(now, "yyyy-MM-dd'T'HH:mm"));
    setClearFrom(format(new Date(now.getTime() - 3600_000), "yyyy-MM-dd'T'HH:mm"));
  }, []);
  return (
    <>
      <Panel title="Export your data" description="Your location history belongs to you. Download it any time, in open formats.">
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['json', 'Full account (JSON)', 'Profile, circles, places, trips and every location point.'],
            ['geojson', 'Locations (GeoJSON)', 'For QGIS, Kepler, geojson.io…'],
            ['gpx', 'Track (GPX)', 'For mapping & fitness apps.'],
            ['csv', 'Spreadsheet (CSV)', 'For Excel, Numbers, pandas…'],
          ] as const).map(([f, label, desc]) => (
            <a key={f} href={`/api/me/export?format=${f}`} download className="flex items-start gap-3 rounded-2xl border border-line p-4 transition hover:bg-surface-2">
              <Download className="mt-0.5 size-5 text-accent" />
              <div>
                <div className="text-[14px] font-bold">{label}</div>
                <div className="text-[12.5px] text-muted">{desc}</div>
              </div>
            </a>
          ))}
        </div>
      </Panel>
      <Panel title="History retention" description="Nodara never limits your history. You decide how long to keep it.">
        <Select
          label="Keep my location history"
          value={retention ?? ''}
          onChange={(e) => save.mutate({ preferences: { retentionDays: e.target.value ? Number(e.target.value) : null } })}
        >
          <option value="">{serverDefault ? `Server default (${serverDefault} days)` : 'Forever (server default)'}</option>
          {[30, 90, 180, 365, 730, 1825].map((d) => (
            <option key={d} value={d}>
              {d < 365 ? `${d} days` : `${d / 365} year${d > 365 ? 's' : ''}`}
            </option>
          ))}
        </Select>
        <p className="mt-2 text-[12.5px] text-muted">When old history is removed, you get a notification saying how much was deleted. Export first if you want a copy.</p>
      </Panel>
      <Panel title="Delete part of your history" description="Permanently remove location points (and trips) in a time range — for example, a trip you'd rather not keep.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input type="datetime-local" label="From" value={clearFrom} onChange={(e) => setClearFrom(e.target.value)} />
          <Input type="datetime-local" label="To" value={clearTo} onChange={(e) => setClearTo(e.target.value)} />
        </div>
        <Button className="mt-4" variant="danger" loading={clear.isPending} onClick={() => window.confirm('Permanently delete this history?') && clear.mutate()}>
          Delete history in range
        </Button>
      </Panel>
      <Panel title="Delete account" description="Removes your account, devices, location history, trips and places. Circles you own pass to another member.">
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
          Delete my account
        </Button>
      </Panel>
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your account?"
        description="This cannot be undone. Export your data first if you want to keep it."
        footer={
          <Button variant="danger" disabled={confirm.confirm !== 'DELETE' || !confirm.password} loading={del.isPending} onClick={() => del.mutate()}>
            Delete forever
          </Button>
        }
      >
        <div className="space-y-3 pb-2">
          <Input type="password" label="Password" value={confirm.password} onChange={(e) => setConfirm({ ...confirm, password: e.target.value })} />
          <Input label="Type DELETE to confirm" value={confirm.confirm} onChange={(e) => setConfirm({ ...confirm, confirm: e.target.value })} />
          <ErrorNote error={del.error} />
        </div>
      </Dialog>
    </>
  );
}
