import type { ReactNode } from 'react';
import type { AppSettings, FrameRate, Quality } from '../../shared/types';
import { FolderIcon, MicIcon, SpeakerIcon } from './icons';

export function Toggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
  icon,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
  icon?: ReactNode;
}) {
  return (
    <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`} htmlFor={id}>
      {icon && <span className="toggle-row-icon">{icon}</span>}
      <span className="toggle-row-text">
        <span className="toggle-row-label">{label}</span>
        {description && <span className="toggle-row-desc">{description}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange(value: T): void;
}) {
  return (
    <div className="field">
      <span className="field-label" id={`seg-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? 'is-selected' : ''}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface AudioProps {
  settings: AppSettings;
  microphones: MediaDeviceInfo[];
  disabled: boolean;
  onChange(patch: Partial<AppSettings>): void;
}

export function AudioOptions({ settings, microphones, disabled, onChange }: AudioProps) {
  return (
    <div className="stack-sm">
      <Toggle
        id="opt-system-audio"
        icon={<SpeakerIcon size={18} />}
        label="System audio"
        description="Everything you hear from your PC"
        checked={settings.systemAudio}
        disabled={disabled}
        onChange={(systemAudio) => onChange({ systemAudio })}
      />
      <Toggle
        id="opt-mic"
        icon={<MicIcon size={18} />}
        label="Microphone"
        description="Narrate while you record"
        checked={settings.microphone}
        disabled={disabled}
        onChange={(microphone) => onChange({ microphone })}
      />
      {settings.microphone && (
        <div className="field">
          <label className="field-label" htmlFor="opt-mic-device">
            Microphone device
          </label>
          <select
            id="opt-mic-device"
            className="input"
            value={microphones.some((m) => m.deviceId === settings.microphoneDeviceId) ? settings.microphoneDeviceId : 'default'}
            disabled={disabled || microphones.length === 0}
            onChange={(e) => onChange({ microphoneDeviceId: e.target.value })}
          >
            {microphones.length === 0 && <option value="default">No microphone detected</option>}
            {microphones.map((m, i) => (
              <option key={m.deviceId || i} value={m.deviceId}>
                {m.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

interface VideoProps {
  settings: AppSettings;
  disabled: boolean;
  onChange(patch: Partial<AppSettings>): void;
}

export function VideoOptions({ settings, disabled, onChange }: VideoProps) {
  return (
    <div className="stack-sm">
      <Segmented<Quality>
        label="Quality"
        value={settings.quality}
        disabled={disabled}
        onChange={(quality) => onChange({ quality })}
        options={[
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
          { value: 'native', label: 'Native' },
        ]}
      />
      <Segmented<FrameRate>
        label="Frame rate"
        value={settings.fps}
        disabled={disabled}
        onChange={(fps) => onChange({ fps })}
        options={[
          { value: 30, label: '30 FPS' },
          { value: 60, label: '60 FPS' },
        ]}
      />
      <div className="field field-inline">
        <span className="field-label">Format</span>
        <span className="badge">MP4 · H.264 + AAC</span>
      </div>
    </div>
  );
}

interface OutputProps {
  folder: string;
  disabled: boolean;
  onChoose(): void;
  onOpen(): void;
}

export function OutputFolder({ folder, disabled, onChoose, onOpen }: OutputProps) {
  return (
    <div className="output-folder">
      <span className="output-folder-icon">
        <FolderIcon size={18} />
      </span>
      <span className="output-folder-path" title={folder}>
        {folder}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onChoose} disabled={disabled}>
        Change…
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
        Open
      </button>
    </div>
  );
}
