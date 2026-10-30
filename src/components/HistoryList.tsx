import type { RecordingEntry } from '../../shared/types';
import { formatBytes, formatDate, formatDuration } from '../utils/format';
import { FilmIcon, FolderIcon, PlayIcon, TrashIcon } from './icons';

interface Props {
  entries: RecordingEntry[];
  onPlay(entry: RecordingEntry): void;
  onShow(entry: RecordingEntry): void;
  onRemove(entry: RecordingEntry): void;
}

export function HistoryList({ entries, onPlay, onShow, onRemove }: Props) {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <FilmIcon size={32} />
        <p>No recordings yet</p>
        <span className="muted">Press the red button or Ctrl + Shift + R to make your first recording.</span>
      </div>
    );
  }

  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Date</th>
            <th scope="col">Duration</th>
            <th scope="col">Size</th>
            <th scope="col" className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className={e.exists === false ? 'is-missing' : ''}>
              <td>
                <div className="history-name">
                  <span className={`format-chip format-${e.format}`}>{e.format.toUpperCase()}</span>
                  <div>
                    <span className="history-file" title={e.filePath}>
                      {e.fileName}
                    </span>
                    <span className="history-source">{e.exists === false ? 'File was moved or deleted' : e.sourceName}</span>
                  </div>
                </div>
              </td>
              <td>{formatDate(e.createdAt)}</td>
              <td className="tabular">{formatDuration(e.durationMs)}</td>
              <td className="tabular">{e.exists === false ? '—' : formatBytes(e.sizeBytes)}</td>
              <td className="col-actions">
                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onPlay(e)}
                    disabled={e.exists === false}
                    aria-label={`Play ${e.fileName}`}
                    title="Play"
                  >
                    <PlayIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onShow(e)}
                    disabled={e.exists === false}
                    aria-label={`Show ${e.fileName} in folder`}
                    title="Open folder"
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
