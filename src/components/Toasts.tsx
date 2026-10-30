import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppNotice } from '../../shared/types';
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from './icons';

export type ToastLevel = AppNotice['level'];
export interface ToastAction {
  label: string;
  onClick(): void;
}
export type NotifyFn = (level: ToastLevel, message: string, action?: ToastAction) => void;

interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
  action?: ToastAction;
}

const DURATION: Record<ToastLevel, number> = { info: 5000, success: 7000, warning: 9000, error: 12000 };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const notify = useCallback<NotifyFn>(
    (level, message, action) => {
      const id = nextId.current++;
      setToasts((list) => {
        // Avoid stacking identical messages.
        const filtered = list.filter((t) => t.message !== message);
        return [...filtered, { id, level, message, action }].slice(-4);
      });
      timers.current.set(id, window.setTimeout(() => dismiss(id), DURATION[level]));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  return { toasts, notify, dismiss };
}

const ICONS = { info: InfoIcon, success: CheckIcon, warning: WarningIcon, error: WarningIcon };

export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss(id: number): void }) {
  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map((t) => {
        const Icon = ICONS[t.level];
        return (
          <div key={t.id} className={`toast toast-${t.level}`} role={t.level === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon">
              <Icon size={18} />
            </span>
            <p className="toast-message">{t.message}</p>
            {t.action && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <CloseIcon size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
