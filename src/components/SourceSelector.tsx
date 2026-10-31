import type { ComponentType } from 'react';
import type { SourceKind } from '../../shared/types';
import { MonitorsIcon, RegionIcon, ScreenIcon, WindowIcon } from './icons';

const OPTIONS: Array<{ kind: SourceKind; label: string; hint: string; Icon: ComponentType<{ size?: number }> }> = [
  { kind: 'screen', label: 'Entire Screen', hint: 'Primary display', Icon: ScreenIcon },
  { kind: 'window', label: 'App Window', hint: 'A single app', Icon: WindowIcon },
  { kind: 'monitor', label: 'Monitor', hint: 'Pick a display', Icon: MonitorsIcon },
  { kind: 'region', label: 'Custom Region', hint: 'Drag an area', Icon: RegionIcon },
];

/** What the preview shows about the current selection. */
export interface SelectionSummary {
  title: string;
  detail?: string;
  icon?: string;
  needsChoice: boolean;
}

interface Props {
  value: SourceKind;
  disabled: boolean;
  onChange(kind: SourceKind): void;
}

export function SourceSelector({ value, disabled, onChange }: Props) {
  return (
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
            <Icon size={20} />
          </span>
          <span className="source-tile-text">
            <span className="source-tile-label">{label}</span>
            <span className="source-tile-hint">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
