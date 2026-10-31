import { useMemo, useState } from 'react';
import type { RecordingEntry } from '../../shared/types';
import { FilmIcon, FolderIcon, PlayIcon, TrashIcon } from '../components/icons';
import { formatBytes, formatDate, formatDuration } from '../utils/format';

interface Props {
  entries: RecordingEntry[];
  folder: string;
  onPlay(entry: RecordingEntry): void;
  onShow(entry: RecordingEntry): void;
  onRemove(entry: RecordingEntry): void;
  onOpenFolder(): void;
  onRecordNow(): void;
}

export function RecordingsPage({ entries, folder, onPlay, onShow, onRemove, onOpenFolder, onRecordNow }: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.fileName} ${e.sourceName}`.toLowerCase().includes(q)) : entries;
  }, [entries, query]);
  const totalBytes = entries.reduce((sum, e) => sum + (e.exists === false ? 0 : e.sizeBytes), 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Recordings</h1>
          <p className="muted">
            {entries.length === 0
              ? 'Your recordings will appear here.'
              : `${entries.length} recording${entries.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)} · `}
            {entries.length > 0 && (
              <span className="path-inline" title={folder}>
                {folder}
              </span>
            )}
          </p>
        </div>
        <div className="page-header-actions">
          {entries.length > 0 && (
            <input
              className="input search-input"
              type="search"
              placeholder="Search recordings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search recordings"
            />
          )}
          <button type="button" className="btn btn-secondary" onClick={onOpenFolder}>
            <FolderIcon size={16} /> Open folder
          </button>
        </div>
      </header>

      {entries.length === 0 ? (
        <div className="empty-state empty-state-large">
          <span className="empty-state-icon">
            <FilmIcon size={34} />
          </span>
          <p>No recordings yet</p>
          <span className="muted">Press Record or Ctrl + Shift + R to make your first recording.</span>
          <button type="button" className="btn btn-primary" onClick={onRecordNow}>
            Start recording
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted empty-search">No recordings match “{query}”.</p>
      ) : (
        <div className="rec-grid">
          {filtered.map((e) => {
            const missing = e.exists === false;
            return (
              <article key={e.id} className={`rec-card ${missing ? 'is-missing' : ''}`}>
                <button
                  type="button"
                  className="rec-thumb"
                  onClick={() => onPlay(e)}
                  disabled={missing}
                  aria-label={`Play ${e.fileName}`}
                  title={missing ? 'The file was moved or deleted' : 'Play'}
                >
                  {e.thumbnail ? <img src={e.thumbnail} alt="" draggable={false} /> : <FilmIcon size={30} />}
                  {!missing && (
                    <span className="rec-play" aria-hidden="true">
                      <PlayIcon size={22} />
                    </span>
                  )}
                  <span className="rec-duration">{formatDuration(e.durationMs)}</span>
                  {e.format !== 'mp4' && <span className="rec-format">{e.format.toUpperCase()}</span>}
                  {missing && <span className="rec-missing">File missing</span>}
                </button>
                <div className="rec-body">
                  <div className="rec-text">
                    <span className="rec-name" title={e.filePath}>
                      {e.fileName}
                    </span>
                    <span className="rec-meta">
                      {formatDate(e.createdAt)}
                      {!missing && ` · ${formatBytes(e.sizeBytes)}`}
                    </span>
                    <span className="rec-source" title={e.sourceName}>
                      {e.sourceName}
                    </span>
                  </div>
                  <div className="rec-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onShow(e)}
                      disabled={missing}
                      aria-label={`Show ${e.fileName} in folder`}
                      title="Show in folder"
                    >
                      <FolderIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      onClick={() => onRemove(e)}
                      aria-label={`Remove ${e.fileName}`}
                      title="Remove"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
