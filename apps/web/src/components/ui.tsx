import { clsx } from 'clsx';
import { Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { initials } from '@/lib/format';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_6px_16px_-6px_var(--accent)]',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  subtle: 'bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-[background,color,box-shadow,transform] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-2 transition hover:bg-surface-2 hover:text-ink active:scale-95',
        active && 'bg-accent-soft text-accent-text hover:bg-accent-soft',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode; error?: string }>(
  function Input({ label, hint, error, className, id, ...rest }, ref) {
    const auto = useId();
    const inputId = id ?? auto;
    return (
      <div className={cx('flex flex-col gap-1.5', className)}>
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
          </label>
        )}
        <input ref={ref} id={inputId} className={cx('field', error && 'border-danger')} {...rest} />
        {error ? <p className="text-[13px] text-danger">{error}</p> : hint && <p className="text-[13px] text-muted">{hint}</p>}
      </div>
    );
  },
);

export function Select({ label, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      <select id={id} className="field appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9" style={{ backgroundImage: CHEVRON }} {...rest}>
        {children}
      </select>
    </div>
  );
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const sw = (
    <button
      id={id}
      role="switch"
      type="button"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-3',
      )}
    >
      <span className={cx('absolute left-[3px] size-5 rounded-full bg-white shadow-sm transition-transform', checked && 'translate-x-[18px]')} />
    </button>
  );
  if (!label) return sw;
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="text-[15px] font-semibold">{label}</div>
        {description && <div className="mt-0.5 text-[13px] leading-snug text-muted">{description}</div>}
      </label>
      {sw}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-xl bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-lg font-semibold whitespace-nowrap transition',
            size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[13px]',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

export function Avatar({
  name,
  color,
  url,
  size = 40,
  ring,
  dim,
  className,
}: {
  name: string;
  color: string;
  /** Profile photo (served by the Nodara API); falls back to initials. */
  url?: string | null;
  size?: number;
  ring?: boolean;
  dim?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = url && broken !== url;
  return (
    <div
      className={cx('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white select-none', dim && 'grayscale-[0.7] opacity-70', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(140deg, color-mix(in srgb, ${color} 80%, white), ${color})`,
        boxShadow: ring ? `0 0 0 2px var(--surface), 0 0 0 4px ${color}` : undefined,
      }}
      aria-hidden
    >
      {initials(name)}
      {showPhoto && <img src={url} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" onError={() => setBroken(url)} />}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent-text',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/14 text-warning',
    danger: 'bg-danger/12 text-danger',
    info: 'bg-info/12 text-info',
  };
  return <span className={cx('inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[11.5px] font-bold', tones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-surface-2', className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="relative mb-5 flex size-16 items-center justify-center rounded-[20px] bg-accent-soft text-accent-text">
        <div className="absolute inset-0 rounded-[20px] border border-accent/20" />
        {icon}
      </div>
      <h3 className="text-[17px] font-bold tracking-tight">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className={cx('rounded-xl border border-danger/25 bg-danger/8 px-3.5 py-2.5 text-[13.5px] text-danger', className)}>{msg}</div>;
}

/** Modal dialog on desktop, bottom sheet on mobile. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className={cx(
          'relative flex max-h-[92dvh] w-full animate-rise flex-col overflow-hidden rounded-t-3xl border border-line bg-elevated shadow-float sm:rounded-3xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>}
          </div>
          <IconButton label="Close" data-close onClick={onClose} className="-mt-1 -mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-6 py-3">{children}</div>
        {footer && <div className="safe-bottom flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-1 truncate text-[22px] font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <img src="/logo-mark.svg" alt="" className="size-7" />
      {withText && <span className="text-[19px] font-extrabold tracking-[-0.03em]">nodara</span>}
    </div>
  );
}
