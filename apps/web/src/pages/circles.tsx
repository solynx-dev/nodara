import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useCircles } from '@/lib/queries';
import type { Circle, CircleDetail } from '@/lib/types';
import { Avatar, Badge, Button, Card, cx, Dialog, EmptyState, ErrorNote, Input, Skeleton } from '@/components/ui';
import { PLACE_COLORS } from '@/features/map/icons';

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLACE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className={cx('size-8 rounded-full transition', value.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-ink ring-offset-2 ring-offset-elevated' : 'hover:scale-110')}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

export function NewCircleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PLACE_COLORS[0]!);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.post<Circle>('/api/circles', { name, color }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['circles'] });
      qc.invalidateQueries({ queryKey: ['live'] });
      onClose();
      navigate(`/circles/${c.id}?invite=1`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New circle"
      description="A circle is a group of people who share locations with each other."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim()}>
            Create circle
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5 pb-2">
        <Input label="Name" placeholder="Family, Roommates, Road trip…" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        <div>
          <div className="label mb-2">Colour</div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <ErrorNote error={create.error} />
      </form>
    </Dialog>
  );
}

export default function CirclesPage() {
  const { data: circles, isLoading } = useCircles();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);
  const details = useQueries({
    queries: (circles ?? []).map((c) => ({ queryKey: ['circle', c.id], queryFn: () => api.get<CircleDetail>(`/api/circles/${c.id}`) })),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Circles</h1>
          <p className="mt-1 text-[14px] text-muted">The groups you share your location with. You control sharing per circle.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New circle
        </Button>
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : circles?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="size-7" />}
            title="No circles yet"
            body="Create a circle for your family or friends, then share an invite link. Everyone keeps control over their own sharing."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Create a circle
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {circles?.map((c, i) => {
            const d = details[i]?.data;
            return (
              <Link key={c.id} to={`/circles/${c.id}`} className="card group relative overflow-hidden p-5 transition hover:border-line-strong">
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: c.color }} />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-2xl text-white" style={{ background: c.color }}>
                      <Users className="size-5" />
                    </div>
                    <div>
                      <div className="text-[17px] font-bold tracking-tight">{c.name}</div>
                      <div className="text-[13px] text-muted">
                        {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} · {c.role}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-muted transition group-hover:translate-x-0.5" />
                </div>
                <div className="mt-5 flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {d?.members.slice(0, 6).map((m) => <Avatar key={m.id} name={m.displayName} color={m.avatarColor} size={30} className="ring-2 ring-surface" />)}
                  </div>
                  {c.sharing ? <Badge tone="success">You're sharing</Badge> : <Badge tone="warning">Not sharing</Badge>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <NewCircleDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
