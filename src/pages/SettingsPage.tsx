import type { ReactNode } from 'react';
import type { AppInfo, AppSettings, FfmpegStatus, ShortcutStatus, ThemeSetting } from '../../shared/types';
import { CheckIcon, WarningIcon } from '../components/icons';
import { OutputFolder, Segmented, Toggle } from '../components/Options';

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
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2>{title}</h2>
        {description && <p className="muted small">{description}</p>}
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

export function SettingsPage(props: Props) {
  const { settings, ffmpeg, shortcuts, info, recording, onChange } = props;
  const exclusionSupported = !info || info.windowsBuild >= 19041;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Preferences are saved automatically.</p>
        </div>
      </header>

      <div className="settings-stack">
        <Section title="Saving" description="Files are named automatically, for example ScreenCapture_2026-10-30_14-05-33.mp4. Existing files are never overwritten.">
          <OutputFolder folder={settings.outputFolder} disabled={recording} onChoose={props.onChooseFolder} onOpen={props.onOpenFolder} />
        </Section>

        <Section title="Appearance">
          <Segmented<ThemeSetting>
            label="Theme"
            value={settings.theme}
            onChange={(theme) => onChange({ theme })}
            options={[
              { value: 'system', label: 'Use Windows setting' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Section>

        <Section title="While recording">
          <Toggle
            id="set-hide"
            label="Hide ScreenCapture Pro from recordings"
            description={
              exclusionSupported
                ? 'The app window and recording toolbar never appear in your videos. The camera bubble is always recorded.'
                : 'Requires Windows 10 version 2004 or later. On this version the windows may appear black instead.'
            }
            checked={settings.hideAppFromCapture}
            disabled={recording}
            onChange={(hideAppFromCapture) => onChange({ hideAppFromCapture })}
          />
          <Toggle
            id="set-minimize"
            label="Minimize this window when recording starts"
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
        </Section>

        <Section title="Keyboard shortcuts">
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
              <dt>Stop and save</dt>
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
        </Section>

        <Section title="Video encoder" description="FFmpeg turns your recordings into MP4 files.">
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
        </Section>

        <Section title="About">
          <p className="muted small">
            ScreenCapture Pro {info?.version ?? ''}. Recordings stay on this PC and are never uploaded.
          </p>
          <div className="button-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={props.onOpenLogs}>
              Open log folder
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
