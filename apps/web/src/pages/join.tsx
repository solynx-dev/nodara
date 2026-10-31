import { useParams, useNavigate, Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { RegisterPage } from './auth';

interface Preview {
  circleName: string;
  circleColor: string;
  invitedBy: string | null;
  role: string;
  memberCount: number;
  expiresAt: string;
}

export function JoinPage() {
  const { token = '' } = useParams();
  const { data: me, isLoading: meLoading } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<Preview>(`/api/invitations/${token}`), retry: false });
  const accept = useMutation({
    mutationFn: () => api.post<{ circleId: string }>(`/api/invitations/${token}/accept`),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['circles'] });
      navigate(`/circles/${r.circleId}?welcome=1`);
    },
  });

  if (preview.isLoading || meLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (preview.error) {
    return (
      <AuthLayout title="Invitation unavailable" footer={<Link to="/" className="font-bold text-accent-text">Go to Nodara</Link>}>
        <ErrorNote error={preview.error} />
      </AuthLayout>
    );
  }
  const p = preview.data!;
  if (!me) return <RegisterPage inviteToken={token} circleName={p.circleName} />;
  return (
    <AuthLayout title={`Join ${p.circleName}`} subtitle={`${p.invitedBy ?? 'Someone'} invited you to share locations with ${p.memberCount} ${p.memberCount === 1 ? 'person' : 'people'}.`}>
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
          <div className="flex size-12 items-center justify-center rounded-2xl text-white" style={{ background: p.circleColor }}>
            <Users className="size-6" />
          </div>
          <div>
            <div className="font-bold">{p.circleName}</div>
            <div className="text-[13px] text-muted">You'll join as {p.role === 'admin' ? 'an admin' : 'a member'}. You can stop sharing with this circle at any time.</div>
          </div>
        </div>
        <ErrorNote error={accept.error} />
        <Button variant="primary" size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
          Join circle as {me.displayName}
        </Button>
      </div>
    </AuthLayout>
  );
}
