import { useEffect, useState } from 'react';
import type { RecorderState } from '../../shared/types';
import { api } from '../api';
import { CollapseIcon, ExpandIcon, GripIcon, PauseIcon, PlayIcon, StopIcon } from '../components/icons';
import { formatDuration } from '../utils/format';

/** Floating always-on-top recording toolbar. It only sends commands; the main window owns the recorder. */
export function ToolbarView() {
  const [state, setState] = useState<RecorderState>({ status: 'recording', elapsedMs: 0 });
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    api.getRecorderState().then(setState);
    return api.onState(setState);
  }, []);

  const toggleCompact = () => {
    const next = !compact;
    setCompact(next);
    api.setToolbarCompact(next);
  };

  const paused = state.status === 'paused';
  const saving = state.status === 'stopping' || state.status === 'finalizing';
  const progress = state.finalizeProgress !== undefined ? Math.round(state.finalizeProgress * 100) : null;
  const mode = saving ? 'saving' : paused ? 'paused' : 'live';
  const statusText = saving
    ? progress !== null
      ? `Saving ${progress}%`
      : 'Saving…'
    : paused
      ? 'Paused'
      : `Recording${state.sourceName ? ` · ${state.sourceName}` : ''}`;

  return (
    <div className="tb-shell">
      <div className={`tb tb-${mode} ${compact ? 'is-compact' : ''}`} role="toolbar" aria-label="Recording controls">
        {!compact && (
          <span className="tb-grip" title="Drag to move" aria-hidden="true">
            <GripIcon size={16} />
          </span>
        )}

        <span className="tb-indicator" aria-hidden="true" />

        {/* Fixed-width readout: the timer is frozen at the final length while saving, so nothing shifts. */}
        <div className="tb-readout">
          <span className="tb-time" role="timer" aria-live="off">
            {formatDuration(state.elapsedMs)}
          </span>
          {!compact && (
            <span className="tb-status" aria-live="polite" title={statusText}>
              {statusText}
            </span>
          )}
        </div>

        {!compact && (
          <div className="tb-actions">
            <button
              type="button"
              className="tb-btn tb-btn-round"
              onClick={() => api.sendCommand('toggle-pause')}
              disabled={saving}
              aria-label={paused ? 'Resume recording' : 'Pause recording'}
              title={paused ? 'Resume (Ctrl+Shift+P)' : 'Pause (Ctrl+Shift+P)'}
            >
              {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
            </button>
            <button
              type="button"
              className="tb-btn tb-btn-stop"
              onClick={() => api.sendCommand('stop')}
              disabled={saving}
              aria-label="Stop recording"
              title="Stop and save (Ctrl+Shift+S)"
            >
              <StopIcon size={14} />
              <span>Stop</span>
            </button>
          </div>
        )}

        <button
          type="button"
          className="tb-btn tb-btn-ghost"
          onClick={toggleCompact}
          aria-label={compact ? 'Expand toolbar' : 'Minimize toolbar'}
          title={compact ? 'Expand' : 'Minimize toolbar'}
        >
          {compact ? <ExpandIcon size={13} /> : <CollapseIcon size={14} />}
        </button>

        {saving && (
          <div className="tb-progress" aria-hidden="true">
            <div className={progress === null ? 'is-indeterminate' : ''} style={progress !== null ? { width: `${progress}%` } : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}
