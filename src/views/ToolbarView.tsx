import { useEffect, useState } from 'react';
import type { RecorderState } from '../../shared/types';
import { api } from '../api';
import { CollapseIcon, ExpandIcon, PauseIcon, PlayIcon, StopIcon } from '../components/icons';
import { formatDuration } from '../utils/format';

/** Compact always-on-top recording toolbar. It only sends commands; the main window owns the recorder. */
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
  const live = state.status === 'recording';

  return (
    <div className={`toolbar ${compact ? 'is-compact' : ''}`} role="toolbar" aria-label="Recording controls">
      <span className={`toolbar-dot ${live ? 'is-live' : ''} ${paused ? 'is-paused' : ''}`} aria-hidden="true" />
      <span className="toolbar-time" role="timer" aria-live="off">
        {saving
          ? `Saving${state.finalizeProgress !== undefined ? ` ${Math.round(state.finalizeProgress * 100)}%` : '…'}`
          : formatDuration(state.elapsedMs)}
      </span>
      {!compact && !saving && <span className="toolbar-label">{paused ? 'Paused' : 'Recording'}</span>}

      {!compact && (
        <div className="toolbar-buttons">
          <button
            type="button"
            className="tb-btn"
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
            title="Stop (Ctrl+Shift+S)"
          >
            <StopIcon size={16} />
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
        {compact ? <ExpandIcon size={14} /> : <CollapseIcon size={14} />}
      </button>
    </div>
  );
}
