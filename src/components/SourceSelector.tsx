import type { ComponentType } from 'react';
import type { SourceKind } from '../../shared/types';
import { MonitorsIcon, RegionIcon, ScreenIcon, WindowIcon } from './icons';

const OPTIONS: Array<{ kind: SourceKind; label: string; hint: string; Icon: ComponentType<{ size?: number }> }> = [
  { kind: 'screen', label: 'Entire Screen', hint: 'Primary display', Icon: ScreenIcon },
  { kind: 'window', label: 'Application Window', hint: 'A single app', Icon: WindowIcon },
  { kind: 'monitor', label: 'Selected Monitor', hint: 'Pick a display', Icon: MonitorsIcon },
  { kind: 'region', label: 'Custom Region', hint: 'Drag an area', Icon: RegionIcon },
];

export interface SelectionSummary {
  title: string;
  detail?: string;
  thumbnail?: string;
  icon?: string;
  needsChoice: boolean;
}

interface Props {
  value: SourceKind;
  disabled: boolean;
  summary: SelectionSummary;
  onChange(kind: SourceKind): void;
  onChoose(): void;
}

export function SourceSelector({ value, disabled, summary, onChange, onChoose }: Props) {
  return (
    <div>
      <div className="source-grid" role="radiogroup" aria-label="Recording source">
        {OPTIONS.map(({ kind, label, hint, Icon }) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={value === kind}
            className={`source-tile ${value === kind ? 'is-selected' : ''}`}
            onClick={() => onChange(kind)}
            disabled={disabled}
          >
            <span className="source-tile-icon">
              <Icon size={22} />
            </span>
            <span className="source-tile-label">{label}</span>
            <span className="source-tile-hint">{hint}</span>
          </button>
        ))}
      </div>

      <div className={`selection-summary ${summary.needsChoice ? 'needs-choice' : ''}`}>
        <div className="selection-thumb" aria-hidden="true">
          {summary.thumbnail ? <img src={summary.thumbnail} alt="" /> : <ScreenIcon size={22} />}
        </div>
        <div className="selection-text">
          <span className="selection-title">
            {summary.icon && <img className="selection-app-icon" src={summary.icon} alt="" />}
            {summary.title}
          </span>
          {summary.detail && <span className="selection-detail">{summary.detail}</span>}
        </div>
        {value !== 'screen' && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onChoose} disabled={disabled}>
            {summary.needsChoice ? 'Choose…' : 'Change…'}
          </button>
        )}
      </div>
    </div>
  );
}
