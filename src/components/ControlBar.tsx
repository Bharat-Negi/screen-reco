import type { RecorderState } from '../../shared/types';
import { formatDuration } from '../utils/format';
import { PauseIcon, PlayIcon, StopIcon } from './icons';
import { RecordButton } from './RecordButton';

const STATUS_TEXT = {
  idle: 'Ready to record',
  starting: 'Starting…',
  recording: 'Recording',
  paused: 'Paused',
  stopping: 'Stopping…',
  finalizing: 'Saving MP4…',
} as const;

interface Props {
  state: RecorderState;
  onStart(): void;
  onStop(): void;
  onTogglePause(): void;
}

/** Timer, the big record button and pause/stop, in one bar under the preview. */
export function ControlBar({ state, onStart, onStop, onTogglePause }: Props) {
  const { status } = state;
  const active = status === 'recording' || status === 'paused';
  const progress = Math.round((state.finalizeProgress ?? 0) * 100);

  return (
    <section className={`control-bar cb-${status}`} aria-label="Recording controls">
      <div className="cb-readout">
        <div className={`status-pill status-${status}`} role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {status === 'finalizing' ? `Saving MP4… ${progress}%` : STATUS_TEXT[status]}
        </div>
        <div className={`timer ${active ? 'is-live' : ''}`} aria-label={`Elapsed time ${formatDuration(state.elapsedMs)}`}>
          {formatDuration(state.elapsedMs)}
        </div>
      </div>

      <RecordButton status={status} onStart={onStart} onStop={onStop} />

      <div className="cb-actions">
        <div className="cb-buttons">
          <button
            type="button"
            className="btn btn-secondary cb-btn"
            onClick={onTogglePause}
            disabled={!active}
            aria-label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
          >
            {status === 'paused' ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
            {status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn btn-secondary cb-btn" onClick={onStop} disabled={!active} aria-label="Stop recording">
            <StopIcon size={16} />
            Stop
          </button>
        </div>
        <p id="record-shortcut-hint" className="cb-hint">
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> record · <kbd>P</kbd> pause · <kbd>S</kbd> stop
        </p>
      </div>

      {status === 'finalizing' && (
        <div className="cb-progress" role="progressbar" aria-label="Saving MP4" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div style={{ width: `${progress}%` }} />
        </div>
      )}
    </section>
  );
}
