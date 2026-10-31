import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './ui';

type Tone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(Ctx);

let seq = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 4500);
  }, []);
  const icons = { info: Info, success: CheckCircle2, error: TriangleAlert };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex flex-col items-center gap-2 p-3 sm:top-auto sm:bottom-6 sm:left-auto sm:right-6 sm:items-end" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} role="status" className="pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-2xl border border-line bg-elevated p-3.5 shadow-float">
              <Icon className={cx('mt-0.5 size-5 shrink-0', t.tone === 'success' && 'text-success', t.tone === 'error' && 'text-danger', t.tone === 'info' && 'text-accent')} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[13px] text-muted">{t.body}</div>}
                {t.action && (
                  <button className="mt-1.5 text-[13px] font-bold text-accent-text" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                    {t.action.label}
                  </button>
                )}
              </div>
              <button aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => dismiss(t.id)}>
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
