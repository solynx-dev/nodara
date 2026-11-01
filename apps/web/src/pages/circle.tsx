import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Check, Copy, Link2, LogOut, Share2, Trash2, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useUser } from '@/lib/queries';
import type { CircleDetail, Invitation } from '@/lib/types';
import { Avatar, Badge, Button, Card, cx, Dialog, ErrorNote, Input, SectionHeader, Select, Skeleton, Switch } from '@/components/ui';
import { useToast } from '@/components/toast';
import { ColorPicker } from './circles';

export default function CirclePage() {
  const { id = '' } = useParams();
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [inviteOpen, setInviteOpen] = useState(params.get('invite') === '1');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const { data: circle, isLoading, error } = useQuery({ queryKey: ['circle', id], queryFn: () => api.get<CircleDetail>(`/api/circles/${id}`) });
  const isAdmin = circle?.role === 'owner' || circle?.role === 'admin';
  const { data: invites = [] } = useQuery({
    queryKey: ['circle', id, 'invitations'],
    enabled: isAdmin,
    queryFn: () => api.get<Invitation[]>(`/api/circles/${id}/invitations`),
  });

  useEffect(() => {
    if (params.get('welcome') === '1') {
      toast({ tone: 'success', title: `Welcome to ${circle?.name ?? 'the circle'}`, body: 'You are now sharing your location with this circle.' });
      setParams({}, { replace: true });
    }
    if (params.get('invite') === '1') setParams({}, { replace: true });
  }, [params, setParams, toast, circle?.name]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['circle', id] });
    qc.invalidateQueries({ queryKey: ['circles'] });
    qc.invalidateQueries({ queryKey: ['live'] });
  };
  const update = useMutation({ mutationFn: (body: object) => api.patch(`/api/circles/${id}`, body), onSuccess: refresh });
  const mine = useMutation({ mutationFn: (body: object) => api.patch(`/api/circles/${id}/me`, body), onSuccess: refresh });
  const role = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api.patch(`/api/circles/${id}/members/${userId}`, { role }),
    onSuccess: refresh,
    onError: (e) => toast({ tone: 'error', title: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/api/circles/${id}/members/${userId}`),
    onSuccess: (_d, userId) => {
      if (userId === me.id) {
        qc.invalidateQueries({ queryKey: ['circles'] });
        navigate('/circles');
      } else refresh();
    },
    onError: (e) => toast({ tone: 'error', title: (e as Error).message }),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/circles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['circles'] });
      navigate('/circles');
    },
  });
  const revoke = useMutation({ mutationFn: (inv: string) => api.del(`/api/circles/${id}/invitations/${inv}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['circle', id, 'invitations'] }) });

  if (isLoading) return <div className="mx-auto max-w-4xl space-y-4 p-6"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (error || !circle) return <div className="mx-auto max-w-4xl p-6"><ErrorNote error={error ?? new Error('Circle not found')} /></div>;
  const canInvite = isAdmin || circle.settings.membersCanInvite;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <Link to="/circles" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Circles
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-2xl text-white shadow-card" style={{ background: circle.color }}>
          <span className="text-[22px] font-extrabold">{circle.name[0]?.toUpperCase()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[28px] font-extrabold tracking-[-0.03em]">{circle.name}</h1>
          <p className="text-[14px] text-muted">
            {circle.memberCount} {circle.memberCount === 1 ? 'member' : 'members'} · created {format(new Date(circle.createdAt), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <Button onClick={() => setEditing(true)}>Edit</Button>}
          {canInvite && (
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
              Invite
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <SectionHeader title="Members" />
          <ul className="divide-y divide-line">
            {circle.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <Avatar name={m.displayName} color={m.avatarColor} url={m.avatarUrl} size={40} dim={!m.sharing} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-bold">{m.displayName}{m.id === me.id && ' (you)'}</span>
                    {m.role !== 'member' && <Badge tone={m.role === 'owner' ? 'accent' : 'info'}>{m.role}</Badge>}
                  </div>
                  <div className="truncate text-[13px] text-muted">
                    {m.sharing ? 'Sharing location' : 'Not sharing'} · joined {format(new Date(m.joinedAt), 'MMM d')}
                    {m.email && ` · ${m.email}`}
                  </div>
                </div>
                {isAdmin && m.id !== me.id && m.role !== 'owner' && (circle.role === 'owner' || m.role === 'member') && (
                  <div className="flex items-center gap-1">
                    <select
                      aria-label="Role"
                      className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] font-semibold"
                      value={m.role}
                      onChange={(e) => role.mutate({ userId: m.id, role: e.target.value })}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      {circle.role === 'owner' && <option value="owner">Make owner</option>}
                    </select>
                    <button
                      className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`Remove ${m.displayName}`}
                      title="Remove from circle"
                      onClick={() => window.confirm(`Remove ${m.displayName} from ${circle.name}?`) && remove.mutate(m.id)}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card className="space-y-3 p-5">
            <SectionHeader title="Your sharing" className="mb-1" />
            <Switch checked={circle.sharing} onChange={(v) => mine.mutate({ sharing: v })} label="Share my location" description={`Members of ${circle.name} can see where you are.`} />
            <Switch checked={!circle.notify.muted} onChange={(v) => mine.mutate({ notify: { muted: !v } })} label="Notifications" description="Arrivals, departures and alerts from this circle." />
          </Card>

          <Card className="space-y-3 p-5">
            <SectionHeader title="Circle privacy" className="mb-1" />
            <Switch
              disabled={!isAdmin}
              checked={circle.settings.historyVisible}
              onChange={(v) => update.mutate({ settings: { historyVisible: v } })}
              label="Members can view history"
              description="Location history since each person started sharing with this circle."
            />
            <Switch disabled={!isAdmin} checked={circle.settings.tripsVisible} onChange={(v) => update.mutate({ settings: { tripsVisible: v } })} label="Members can view trips" />
            <Switch disabled={!isAdmin} checked={circle.settings.membersCanInvite} onChange={(v) => update.mutate({ settings: { membersCanInvite: v } })} label="Members can invite" />
            {!isAdmin && <p className="text-[12.5px] text-muted">Only circle admins can change these.</p>}
          </Card>

          {isAdmin && invites.length > 0 && (
            <Card className="p-5">
              <SectionHeader title="Open invitations" />
              <ul className="space-y-2">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px]">
                    <Link2 className="size-4 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        {i.role} · {i.uses}/{i.maxUses} used
                      </div>
                      <div className="text-muted">expires {format(new Date(i.expiresAt), 'MMM d, h:mm a')}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">Links are shown only once when created; revoke and create a new one if lost.</p>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            {circle.role !== 'owner' && (
              <Button variant="danger" icon={<LogOut className="size-4" />} onClick={() => setConfirm('leave')}>
                Leave circle
              </Button>
            )}
            {circle.role === 'owner' && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('delete')}>
                Delete circle
              </Button>
            )}
          </div>
        </div>
      </div>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} circle={circle} />
      <EditCircleDialog open={editing} onClose={() => setEditing(false)} circle={circle} onSave={(b) => update.mutateAsync(b).then(() => setEditing(false))} />
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'delete' ? `Delete ${circle.name}?` : `Leave ${circle.name}?`}
        description={
          confirm === 'delete'
            ? 'Everyone will be removed and the circle’s shared places deleted. Each person keeps their own location history.'
            : 'You’ll stop sharing your location with this circle and lose access to its members’ locations.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending || remove.isPending} onClick={() => (confirm === 'delete' ? del.mutate() : remove.mutate(me.id))}>
              {confirm === 'delete' ? 'Delete circle' : 'Leave'}
            </Button>
          </>
        }
      />
    </div>
  );
}

function EditCircleDialog({ open, onClose, circle, onSave }: { open: boolean; onClose: () => void; circle: CircleDetail; onSave: (b: object) => Promise<unknown> }) {
  const [name, setName] = useState(circle.name);
  const [color, setColor] = useState(circle.color);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit circle"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave({ name, color })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5 pb-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <div className="label mb-2">Colour</div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
    </Dialog>
  );
}

function InviteDialog({ open, onClose, circle }: { open: boolean; onClose: () => void; circle: CircleDetail }) {
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [hours, setHours] = useState(72);
  const [uses, setUses] = useState(1);
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post<{ url: string; expiresAt: string }>(`/api/circles/${circle.id}/invitations`, { role, expiresInHours: hours, maxUses: uses }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['circle', circle.id, 'invitations'] }),
  });
  const close = () => {
    create.reset();
    setCopied(false);
    onClose();
  };
  const url = create.data?.url;
  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  const share = () => url && navigator.share?.({ title: `Join ${circle.name} on Nodara`, text: `Join my circle "${circle.name}" on Nodara`, url }).catch(() => {});
  return (
    <Dialog open={open} onClose={close} title={`Invite to ${circle.name}`} description="Create a secure, expiring link and send it however you like.">
      {url ? (
        <div className="space-y-4 pb-3">
          <div className="rounded-2xl border border-line bg-surface-2 p-3.5">
            <div className="eyebrow mb-1">Invitation link</div>
            <div className="font-mono text-[13px] break-all">{url}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {'share' in navigator && (
              <Button className="flex-1" icon={<Share2 className="size-4" />} onClick={share}>
                Share…
              </Button>
            )}
          </div>
          <p className="text-[12.5px] text-muted">
            This link is shown only now. It expires {format(new Date(create.data!.expiresAt), 'MMM d, h:mm a')} and works {uses === 1 ? 'once' : `${uses} times`}.
          </p>
        </div>
      ) : (
        <div className="space-y-4 pb-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')} disabled={circle.role === 'member'}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
            <Select label="Expires in" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              <option value={1}>1 hour</option>
              <option value={24}>1 day</option>
              <option value={72}>3 days</option>
              <option value={168}>1 week</option>
              <option value={720}>30 days</option>
            </Select>
          </div>
          <Select label="Can be used" value={uses} onChange={(e) => setUses(Number(e.target.value))}>
            <option value={1}>Once (one person)</option>
            <option value={5}>Up to 5 times</option>
            <option value={20}>Up to 20 times</option>
          </Select>
          <ErrorNote error={create.error} />
          <Button variant="primary" className={cx('w-full')} loading={create.isPending} onClick={() => create.mutate()} icon={<Link2 className="size-4" />}>
            Create invitation link
          </Button>
        </div>
      )}
    </Dialog>
  );
}
