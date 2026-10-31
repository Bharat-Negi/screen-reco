import type { ComponentType } from 'react';
import type { RecorderState } from '../../shared/types';
import { formatDuration } from '../utils/format';
import { FilmIcon, GearIcon, MoonIcon, RecordIcon, SunIcon } from './icons';

export type Page = 'record' | 'recordings' | 'settings';

interface Props {
  page: Page;
  recordingsCount: number;
  recorder: RecorderState;
  isDark: boolean;
  version?: string;
  onNavigate(page: Page): void;
  onToggleTheme(): void;
}

const ITEMS: Array<{ id: Page; label: string; Icon: ComponentType<{ size?: number }> }> = [
  { id: 'record', label: 'Record', Icon: RecordIcon },
  { id: 'recordings', label: 'Recordings', Icon: FilmIcon },
  { id: 'settings', label: 'Settings', Icon: GearIcon },
];

export function Sidebar({ page, recordingsCount, recorder, isDark, version, onNavigate, onToggleTheme }: Props) {
  const active = recorder.status === 'recording' || recorder.status === 'paused';
  const saving = recorder.status === 'stopping' || recorder.status === 'finalizing';

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="nav-list">
        {ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item ${page === id ? 'is-active' : ''} nav-${id}`}
            aria-current={page === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <span className="nav-icon">
              <Icon size={18} />
            </span>
            <span className="nav-label">{label}</span>
            {id === 'recordings' && recordingsCount > 0 && <span className="nav-badge">{recordingsCount}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        {(active || saving) && (
          <button type="button" className={`sidebar-live ${recorder.status}`} onClick={() => onNavigate('record')}>
            <span className="sidebar-live-dot" aria-hidden="true" />
            <span>{saving ? 'Saving…' : recorder.status === 'paused' ? 'Paused' : 'Recording'}</span>
            <span className="sidebar-live-time">{formatDuration(recorder.elapsedMs)}</span>
          </button>
        )}
        <button type="button" className="nav-item" onClick={onToggleTheme} aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
          <span className="nav-icon">{isDark ? <SunIcon size={18} /> : <MoonIcon size={18} />}</span>
          <span className="nav-label">{isDark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        {version && <span className="sidebar-version">Version {version}</span>}
      </div>
    </nav>
  );
}
