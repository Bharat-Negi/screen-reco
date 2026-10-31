import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CAMERA_MAX_DIAMETER, CAMERA_MIN_DIAMETER, type AppSettings, type FrameRate, type Quality } from '../../shared/types';
import { api } from '../api';
import { CameraIcon, FolderIcon, MicIcon, SpeakerIcon, WarningIcon } from './icons';

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

/** Resizes the bubble live while dragging and saves the size once the slider settles. */
function CameraSizeSlider({ diameter, onCommit }: { diameter: number; onCommit(value: number): void }) {
  const [value, setValue] = useState(diameter);
  const commitTimer = useRef<number | null>(null);

  // Follow size changes made on the bubble itself (wheel, handle, buttons).
  useEffect(() => setValue(diameter), [diameter]);
  useEffect(() => () => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
  }, []);

  const change = (next: number) => {
    setValue(next);
    api.resizeCamera(next, 'center');
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => onCommit(next), 300);
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor="opt-camera-size">
        Bubble size <span className="camera-size-value">{value} px</span>
      </label>
      <input
        id="opt-camera-size"
        className="range"
        type="range"
        min={CAMERA_MIN_DIAMETER}
        max={CAMERA_MAX_DIAMETER}
        step={10}
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
      <span className="muted small">Tip: scroll over the camera bubble, or drag its corner handle, to resize it.</span>
    </div>
  );
}

interface CameraProps {
  settings: AppSettings;
  cameras: MediaDeviceInfo[];
  onChange(patch: Partial<AppSettings>): void;
}

export function CameraOptions({ settings, cameras, onChange }: CameraProps) {
  return (
    <div className="camera-options">
      <div className="stack-sm">
        <Toggle
          id="opt-camera"
          icon={<CameraIcon size={18} />}
          label="Show camera"
          description="A round webcam bubble recorded with your screen. Drag it anywhere."
          checked={settings.camera}
          onChange={(camera) => onChange({ camera })}
        />
        {settings.camera && (
          <div className="field">
            <label className="field-label" htmlFor="opt-camera-device">
              Camera device
            </label>
            <select
              id="opt-camera-device"
              className="input"
              value={cameras.some((c) => c.deviceId === settings.cameraDeviceId) ? settings.cameraDeviceId : 'default'}
              disabled={cameras.length === 0}
              onChange={(e) => onChange({ cameraDeviceId: e.target.value })}
            >
              {cameras.length === 0 && <option value="default">No camera detected</option>}
              {cameras.length > 0 && !cameras.some((c) => c.deviceId === settings.cameraDeviceId) && (
                <option value="default">Default camera</option>
              )}
              {cameras.map((c, i) => (
                <option key={c.deviceId || i} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {settings.camera && (
        <div className="stack-sm">
          <CameraSizeSlider diameter={settings.cameraDiameter} onCommit={(cameraDiameter) => onChange({ cameraDiameter })} />
          <Toggle
            id="opt-camera-mirror"
            label="Mirror image"
            description="Show yourself like in a mirror"
            checked={settings.cameraMirror}
            onChange={(cameraMirror) => onChange({ cameraMirror })}
          />
        </div>
      )}
      {settings.camera && settings.sourceKind === 'window' && (
        <p className="warning-text camera-note">
          <WarningIcon size={16} /> In Application Window mode only that window is recorded, so the camera bubble won't appear. Choose Entire
          Screen, Selected Monitor or Custom Region to include it.
        </p>
      )}
      {settings.camera && settings.sourceKind === 'region' && (
        <p className="muted small camera-note">Drag the camera bubble inside the selected area to include it in the recording.</p>
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
