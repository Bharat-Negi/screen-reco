import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureSource } from '../../shared/types';
import { api, errorMessage } from '../api';
import { CloseIcon, RefreshIcon, ScreenIcon, WindowIcon } from './icons';

interface Props {
  kind: 'screen' | 'window';
  title: string;
  description: string;
  selectedId?: string;
  onPick(source: CaptureSource): void;
  onClose(): void;
}

/** Modal grid of live thumbnails for choosing a window or monitor. */
export function SourcePicker({ kind, title, description, selectedId, onPick, onClose }: Props) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setError(null);
    try {
      setSources(await api.getSources(kind));
    } catch (err) {
      setError(errorMessage(err));
      setSources([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (sources ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [sources, query]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="modal-header">
          <div>
            <h2 id="picker-title">{title}</h2>
            <p className="muted">{description}</p>
          </div>
          <div className="modal-header-actions">
            <button type="button" className="icon-btn" onClick={() => void load()} aria-label="Refresh list" title="Refresh">
              <RefreshIcon size={18} />
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        </header>

        {kind === 'window' && (
          <input
            className="input picker-search"
            type="search"
            placeholder="Search windows…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search windows"
          />
        )}

        <div className="picker-body">
          {sources === null && <p className="muted picker-empty">Loading sources…</p>}
          {error && <p className="error-text">{error}</p>}
          {sources !== null && filtered.length === 0 && !error && (
            <p className="muted picker-empty">
              {kind === 'window' ? 'No windows found. Open the app you want to record, then refresh.' : 'No displays found.'}
            </p>
          )}
          <div className="picker-grid">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`picker-item ${s.id === selectedId ? 'is-selected' : ''}`}
                onClick={() => onPick(s)}
                title={s.name}
              >
                <span className="picker-thumb">
                  {s.thumbnail ? (
                    <img src={s.thumbnail} alt="" />
                  ) : kind === 'window' ? (
                    <span className="picker-thumb-empty">
                      <WindowIcon size={28} />
                      <small>Minimized</small>
                    </span>
                  ) : (
                    <ScreenIcon size={28} />
                  )}
                </span>
                <span className="picker-name">
                  {s.appIcon && <img src={s.appIcon} alt="" className="picker-app-icon" />}
                  <span>{s.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
