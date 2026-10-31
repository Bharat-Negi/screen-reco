import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { CaptureSource, DisplayInfo } from '../../shared/types';
import { api, errorMessage } from '../api';
import { CheckIcon, CloseIcon, MonitorsIcon, RefreshIcon, RegionIcon, ScreenIcon, WindowIcon } from './icons';

export type PickerMode = 'window' | 'monitor' | 'region';

const MODES: Record<PickerMode, { title: string; description: string; confirm: string; Icon: ComponentType<{ size?: number }> }> = {
  window: {
    title: 'Choose a window',
    description: 'Only this app window is recorded, even when other windows cover it.',
    confirm: 'Record this window',
    Icon: WindowIcon,
  },
  monitor: {
    title: 'Choose a monitor',
    description: 'Everything shown on the selected display is recorded.',
    confirm: 'Record this monitor',
    Icon: MonitorsIcon,
  },
  region: {
    title: 'Choose a display',
    description: 'Next, you will drag to select the area to record on this display.',
    confirm: 'Select area',
    Icon: RegionIcon,
  },
};

interface Props {
  mode: PickerMode;
  displays: DisplayInfo[];
  selectedId?: string;
  onPick(source: CaptureSource): void;
  onClose(): void;
}

/** Modal grid of live thumbnails for choosing a window or monitor. Click to select, then confirm (or double-click). */
export function SourcePicker({ mode, displays, selectedId, onPick, onClose }: Props) {
  const kind = mode === 'window' ? 'window' : 'screen';
  const meta = MODES[mode];
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | undefined>(selectedId);
  const [refreshing, setRefreshing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const list = await api.getSources(kind);
      setSources(list);
      // With a single display there is nothing to choose between: preselect it.
      if (kind === 'screen' && list.length === 1) setChosen((c) => c ?? list[0].id);
    } catch (err) {
      setError(errorMessage(err));
      setSources([]);
    } finally {
      setRefreshing(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (sources ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [sources, query]);

  const chosenSource = sources?.find((s) => s.id === chosen);
  const confirm = useCallback(() => {
    if (chosenSource) onPick(chosenSource);
  }, [chosenSource, onPick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter' && chosenSource && !(e.target instanceof HTMLButtonElement)) confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirm, chosenSource]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  /** Screens get their real display name and resolution instead of Chromium's generic "Entire screen". */
  const describe = (s: CaptureSource, index: number) => {
    if (kind === 'window') return { name: s.name, detail: undefined, primary: false };
    const display = displays.find((d) => d.id === s.displayId);
    const [label, resolution] = (display?.label ?? `Display ${index + 1}`).split(' — ');
    return { name: label, detail: resolution, primary: Boolean(display?.primary) };
  };

  const countText =
    sources === null
      ? 'Looking for sources…'
      : kind === 'window'
        ? `${filtered.length} window${filtered.length === 1 ? '' : 's'}${query ? ' found' : ' open'}`
        : sources.length === 1
          ? 'One display connected'
          : `${sources.length} displays connected`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal picker picker-${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        aria-describedby="picker-desc"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="picker-header">
          <span className="picker-header-icon" aria-hidden="true">
            <meta.Icon size={22} />
          </span>
          <div className="picker-header-text">
            <h2 id="picker-title">{meta.title}</h2>
            <p id="picker-desc">{meta.description}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="picker-toolbar">
          {kind === 'window' ? (
            <input
              className="input picker-search"
              type="search"
              placeholder="Search windows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search windows"
              autoFocus
            />
          ) : (
            <span className="picker-count">{countText}</span>
          )}
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${refreshing ? 'is-spinning' : ''}`}
            onClick={() => void load()}
            disabled={refreshing}
            title="Refresh thumbnails"
          >
            <RefreshIcon size={16} /> Refresh
          </button>
        </div>

        <div className="picker-body">
          {error && <p className="error-text">{error}</p>}

          {sources === null ? (
            <div className="picker-grid" aria-hidden="true">
              {Array.from({ length: kind === 'window' ? 6 : 2 }, (_, i) => (
                <div key={i} className="picker-card is-skeleton">
                  <span className="picker-thumb" />
                  <span className="skeleton-line" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 && !error ? (
            <div className="picker-empty">
              <span className="empty-state-icon">{kind === 'window' ? <WindowIcon size={28} /> : <ScreenIcon size={28} />}</span>
              <p>{query ? `No windows match “${query}”` : kind === 'window' ? 'No windows to record' : 'No displays found'}</p>
              <span className="muted">
                {query ? 'Try a different name.' : kind === 'window' ? 'Open the app you want to record, then press Refresh.' : 'Check your display connection, then press Refresh.'}
              </span>
            </div>
          ) : (
            <div className="picker-grid" role="listbox" aria-label={meta.title}>
              {filtered.map((s, i) => {
                const info = describe(s, i);
                const selected = s.id === chosen;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`picker-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => setChosen(s.id)}
                    onDoubleClick={() => onPick(s)}
                    title={s.name}
                  >
                    <span className="picker-thumb">
                      {s.thumbnail ? (
                        <img src={s.thumbnail} alt="" draggable={false} />
                      ) : (
                        <span className="picker-thumb-empty">
                          {kind === 'window' ? <WindowIcon size={26} /> : <ScreenIcon size={26} />}
                          <small>{kind === 'window' ? 'Minimized' : 'No preview'}</small>
                        </span>
                      )}
                      {selected && (
                        <span className="picker-check" aria-hidden="true">
                          <CheckIcon size={14} />
                        </span>
                      )}
                      {info.primary && <span className="picker-badge">Primary</span>}
                    </span>
                    <span className="picker-label">
                      {s.appIcon ? (
                        <img src={s.appIcon} alt="" className="picker-app-icon" />
                      ) : (
                        <span className="picker-label-icon" aria-hidden="true">
                          {kind === 'window' ? <WindowIcon size={14} /> : <ScreenIcon size={14} />}
                        </span>
                      )}
                      <span className="picker-label-text">
                        <span className="picker-name">{info.name}</span>
                        {info.detail && <span className="picker-detail">{info.detail}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="picker-footer">
          <span className="picker-footer-hint">
            {chosenSource ? (
              <>
                Selected: <strong>{describe(chosenSource, sources?.indexOf(chosenSource) ?? 0).name}</strong>
              </>
            ) : kind === 'window' ? (
              countText
            ) : (
              'Click a display to select it'
            )}
          </span>
          <div className="button-row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={!chosenSource}>
              {meta.confirm}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
