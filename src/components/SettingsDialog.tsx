import { useEffect, useRef } from 'react';
import type { AppInfo, AppSettings, FfmpegStatus, ShortcutStatus, ThemeSetting } from '../../shared/types';
import { CheckIcon, CloseIcon, WarningIcon } from './icons';
import { OutputFolder, Segmented, Toggle } from './Options';

interface Props {
  settings: AppSettings;
  ffmpeg: FfmpegStatus | null;
  shortcuts: ShortcutStatus | null;
  info: AppInfo | null;
  recording: boolean;
  onChange(patch: Partial<AppSettings>): void;
  onChooseFolder(): void;
  onOpenFolder(): void;
  onChooseFfmpeg(): void;
  onResetFfmpeg(): void;
  onOpenLogs(): void;
  onClose(): void;
}

export function SettingsDialog(props: Props) {
  const { settings, ffmpeg, shortcuts, info, recording, onChange, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exclusionSupported = !info || info.windowsBuild >= 19041;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={ref}>
        <header className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="modal-body settings-body">
          <section>
            <h3>Saving</h3>
            <OutputFolder folder={settings.outputFolder} disabled={recording} onChoose={props.onChooseFolder} onOpen={props.onOpenFolder} />
            <p className="muted small">
              Files are named automatically, e.g. <code>ScreenCapture_2026-10-30_14-05-33.mp4</code>. Existing files are never
              overwritten.
            </p>
          </section>

          <section>
            <h3>Appearance</h3>
            <Segmented<ThemeSetting>
              label="Theme"
              value={settings.theme}
              onChange={(theme) => onChange({ theme })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </section>

          <section>
            <h3>While recording</h3>
            <Toggle
              id="set-hide"
              label="Hide ScreenCapture Pro from recordings"
              description={
                exclusionSupported
                  ? 'The app window and toolbar will not appear in your videos.'
                  : 'Requires Windows 10 version 2004 or later. On this version the windows may appear black instead.'
              }
              checked={settings.hideAppFromCapture}
              disabled={recording}
              onChange={(hideAppFromCapture) => onChange({ hideAppFromCapture })}
            />
            <Toggle
              id="set-minimize"
              label="Minimize main window when recording starts"
              description="Recording controls stay available in the floating toolbar."
              checked={settings.minimizeOnRecord}
              disabled={recording}
              onChange={(minimizeOnRecord) => onChange({ minimizeOnRecord })}
            />
            <Toggle
              id="set-notify"
              label="Show a Windows notification when a recording is saved"
              checked={settings.showNotifications}
              onChange={(showNotifications) => onChange({ showNotifications })}
            />
          </section>

          <section>
            <h3>Keyboard shortcuts</h3>
            <Toggle
              id="set-global"
              label="Work in any application"
              description="When off, shortcuts only work while ScreenCapture Pro is focused, so they never clash with other apps."
              checked={settings.globalShortcuts}
              onChange={(globalShortcuts) => onChange({ globalShortcuts })}
            />
            <dl className="shortcut-list">
              <div>
                <dt>Start recording</dt>
                <dd>
                  <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>
                </dd>
              </div>
              <div>
                <dt>Pause / resume</dt>
                <dd>
                  <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>
                </dd>
              </div>
              <div>
                <dt>Stop recording</dt>
                <dd>
                  <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>
                </dd>
              </div>
            </dl>
            {shortcuts && shortcuts.failed.length > 0 && (
              <p className="warning-text">
                <WarningIcon size={16} /> {shortcuts.failed.join(', ')} {shortcuts.failed.length === 1 ? 'is' : 'are'} used by another
                application and only work inside this window.
              </p>
            )}
          </section>

          <section>
            <h3>Video encoder (FFmpeg)</h3>
            {ffmpeg?.available ? (
              <p className="ok-text">
                <CheckIcon size={16} /> FFmpeg {ffmpeg.version} ({ffmpeg.source}) is ready.
              </p>
            ) : (
              <p className="warning-text">
                <WarningIcon size={16} /> {ffmpeg?.error ?? 'Checking FFmpeg…'}
              </p>
            )}
            {ffmpeg?.path && (
              <p className="muted small path-text" title={ffmpeg.path}>
                {ffmpeg.path}
              </p>
            )}
            <div className="button-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={props.onChooseFfmpeg}>
                Use a custom ffmpeg.exe…
              </button>
              {settings.ffmpegPath && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={props.onResetFfmpeg}>
                  Use automatic detection
                </button>
              )}
            </div>
          </section>

          <section>
            <h3>About</h3>
            <p className="muted small">
              ScreenCapture Pro {info?.version ?? ''} · Recordings stay on this PC and are never uploaded.
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={props.onOpenLogs}>
              Open log folder
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
