import type { RecorderStatus } from '../../shared/types';
import { RecordIcon, StopIcon } from './icons';

interface Props {
  status: RecorderStatus;
  onStart(): void;
  onStop(): void;
}

/** The hero control: a large red record button that becomes a stop button while recording. */
export function RecordButton({ status, onStart, onStop }: Props) {
  const active = status === 'recording' || status === 'paused';
  const busy = status === 'starting' || status === 'stopping' || status === 'finalizing';
  const label = active ? 'Stop Recording' : busy ? 'Please wait' : 'Start Recording';

  return (
    <div className="record-button-wrap">
      <button
        type="button"
        className={`record-button ${active ? 'is-active' : ''} ${busy ? 'is-busy' : ''} ${status === 'paused' ? 'is-paused' : ''}`}
        onClick={active ? onStop : onStart}
        disabled={busy}
        aria-label={label}
        aria-describedby="record-shortcut-hint"
        data-tooltip={label}
      >
        <span className="record-button-ring" aria-hidden="true" />
        {busy ? (
          <span className="spinner" aria-hidden="true" />
        ) : active ? (
          <StopIcon size={46} />
        ) : (
          <RecordIcon size={58} />
        )}
      </button>
    </div>
  );
}
