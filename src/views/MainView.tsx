import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppInfo,
  AppSettings,
  CaptureSource,
  DisplayInfo,
  FfmpegStatus,
  FinalizeResult,
  RecordingEntry,
  RecoverableRecording,
  Rect,
  ShortcutStatus,
  SourceKind,
} from '../../shared/types';
import { api, errorMessage } from '../api';
import { HistoryList } from '../components/HistoryList';
import { CheckIcon, FolderIcon, GearIcon, MoonIcon, PauseIcon, PlayIcon, StopIcon, SunIcon, WarningIcon } from '../components/icons';
import { Logo } from '../components/Logo';
import { AudioOptions, OutputFolder, VideoOptions } from '../components/Options';
import { RecordButton } from '../components/RecordButton';
import { SettingsDialog } from '../components/SettingsDialog';
import { SourcePicker } from '../components/SourcePicker';
import { SourceSelector, type SelectionSummary } from '../components/SourceSelector';
import { ToastStack, useToasts } from '../components/Toasts';
import type { EngineStartOptions } from '../recorder/engine';
import { useRecorder } from '../recorder/useRecorder';
import { formatBytes, formatDate, formatDuration } from '../utils/format';

interface Selection {
  monitor?: CaptureSource;
  window?: CaptureSource;
  region?: { displayId: string; rect: Rect; displayLabel: string };
}

type PickerMode = 'window' | 'monitor' | 'region' | null;

const STATUS_TEXT = {
  idle: 'Ready to record',
  starting: 'Starting…',
  recording: 'Recording',
  paused: 'Paused',
  stopping: 'Stopping…',
  finalizing: 'Saving MP4…',
} as const;

export function MainView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [primaryScreen, setPrimaryScreen] = useState<CaptureSource | null>(null);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<RecordingEntry[]>([]);
  const [recoverable, setRecoverable] = useState<RecoverableRecording[]>([]);
  const [recovering, setRecovering] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<RecordingEntry | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const { toasts, notify, dismiss } = useToasts();

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // ---------- Data loading ----------

  const refreshHistory = useCallback(() => {
    api.listHistory().then(setHistory).catch((err) => notify('error', errorMessage(err)));
  }, [notify]);

  const refreshRecoverable = useCallback(() => {
    api.listRecoverable().then(setRecoverable).catch(() => undefined);
  }, []);

  const refreshScreens = useCallback(async () => {
    const [screens, ds] = await Promise.all([api.getSources('screen'), api.getDisplays()]);
    setDisplays(ds);
    const primary = ds.find((d) => d.primary);
    setPrimaryScreen(screens.find((s) => s.displayId === primary?.id) ?? screens[0] ?? null);
  }, []);

  const refreshMicrophones = useCallback(async (unlockLabels = false) => {
    try {
      let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      if (unlockLabels && devices.length > 0 && devices.every((d) => !d.label)) {
        // Device names are hidden until microphone access has been granted once.
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      }
      setMicrophones(devices);
    } catch {
      setMicrophones([]);
    }
  }, []);

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.getAppInfo().then(setInfo);
    api.getFfmpegStatus().then(setFfmpeg);
    api.getShortcutStatus().then(setShortcuts);
    refreshHistory();
    refreshRecoverable();
    void refreshScreens();
    void refreshMicrophones();
    const onDeviceChange = () => void refreshMicrophones();
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    const offSettings = api.onSettings(setSettings);
    const offNotice = api.onNotice((n) => notify(n.level, n.message));
    const onFocus = () => refreshHistory();
    window.addEventListener('focus', onFocus);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      offSettings();
      offNotice();
      window.removeEventListener('focus', onFocus);
    };
  }, [notify, refreshHistory, refreshMicrophones, refreshRecoverable, refreshScreens]);

  useEffect(() => {
    if (settings?.microphone) void refreshMicrophones(true);
  }, [settings?.microphone, refreshMicrophones]);

  const changeSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      try {
        const next = await api.updateSettings(patch);
        setSettings(next);
        if ('globalShortcuts' in patch) setShortcuts(await api.getShortcutStatus());
      } catch (err) {
        notify('error', `Could not save settings: ${errorMessage(err)}`);
      }
    },
    [notify],
  );

  // ---------- Recording ----------

  /** Validates the chosen source, disk space and encoder, and builds the capture options. */
  const resolveStart = useCallback(async (): Promise<EngineStartOptions> => {
    const s = settingsRef.current;
    if (!s) throw new Error('Settings are still loading. Please try again.');
    const sel = selectionRef.current;
    const [screens, ds] = await Promise.all([api.getSources('screen'), api.getDisplays()]);

    let source: CaptureSource | undefined;
    let sourceName = '';
    let region: EngineStartOptions['region'];

    switch (s.sourceKind) {
      case 'screen': {
        const primary = ds.find((d) => d.primary);
        source = screens.find((x) => x.displayId === primary?.id) ?? screens[0];
        if (!source) throw new Error('No screen is available to record.');
        sourceName = 'Entire screen';
        break;
      }
      case 'monitor': {
        if (!sel.monitor) {
          setPicker('monitor');
          throw new Error('Choose the monitor you want to record first.');
        }
        source = screens.find((x) => x.id === sel.monitor!.id);
        if (!source) throw new Error('The selected monitor is no longer connected. Please choose another one.');
        sourceName = source.name;
        break;
      }
      case 'window': {
        if (!sel.window) {
          setPicker('window');
          throw new Error('Choose the application window you want to record first.');
        }
        const windows = await api.getSources('window');
        source = windows.find((x) => x.id === sel.window!.id);
        if (!source) throw new Error(`"${sel.window.name}" was closed. Please choose the window again.`);
        sourceName = source.name;
        break;
      }
      case 'region': {
        if (!sel.region) throw new Error('Select an area of the screen to record first.');
        const display = ds.find((d) => d.id === sel.region!.displayId);
        source = screens.find((x) => x.displayId === sel.region!.displayId);
        if (!display || !source) throw new Error('The display for the selected region is no longer connected.');
        region = { rect: sel.region.rect, displayBounds: display.bounds };
        sourceName = `Region ${Math.round(sel.region.rect.width)}×${Math.round(sel.region.rect.height)}`;
        break;
      }
    }

    const disk = await api.checkDisk();
    if (disk.level === 'critical') {
      throw new Error(`Not enough disk space to record (${formatBytes(disk.freeBytes)} free). Free up space or choose another folder.`);
    }
    if (disk.level === 'low') {
      notify('warning', `Disk space is low (${formatBytes(disk.freeBytes)} free). Long recordings may be stopped early.`);
    }

    const ff = await api.getFfmpegStatus();
    setFfmpeg(ff);
    if (!ff.available) notify('warning', ff.error ?? 'FFmpeg is not available; the recording will be saved as WebM.');

    return {
      sourceId: source!.id,
      sourceName,
      systemAudio: s.systemAudio,
      microphone: s.microphone,
      microphoneDeviceId: s.microphoneDeviceId,
      fps: s.fps,
      quality: s.quality,
      region,
    };
  }, [notify]);

  const onFinished = useCallback(
    (result: FinalizeResult) => {
      if (result.ok) {
        setLastSaved(result.entry);
        notify('success', `Saved ${result.entry.fileName}`, {
          label: 'Open folder',
          onClick: () => void api.showRecordingInFolder(result.entry.id),
        });
        if (result.warning) notify('warning', result.warning);
      } else {
        notify('error', result.error);
        refreshRecoverable();
      }
      refreshHistory();
    },
    [notify, refreshHistory, refreshRecoverable],
  );

  const recorder = useRecorder({ resolveStart, notify, onFinished });
  const { status } = recorder.state;
  const active = status === 'recording' || status === 'paused';
  const busy = status !== 'idle';

  // In-window shortcuts (also the fallback when global shortcuts are disabled or taken).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === 'r') recorder.start();
      else if (key === 'p') recorder.togglePause();
      else if (key === 's') recorder.stop();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recorder]);

  // ---------- Source selection ----------

  const startRegionSelection = useCallback(
    async (display: DisplayInfo) => {
      const rect = await api.selectRegion(display.id);
      if (rect) {
        setSelection((s) => ({ ...s, region: { displayId: display.id, rect, displayLabel: display.label } }));
      } else if (!selectionRef.current.region) {
        notify('info', 'Region selection was cancelled.');
      }
    },
    [notify],
  );

  const chooseForKind = useCallback(
    (kind: SourceKind) => {
      if (kind === 'window') setPicker('window');
      else if (kind === 'monitor') setPicker('monitor');
      else if (kind === 'region') {
        if (displays.length === 1) void startRegionSelection(displays[0]);
        else setPicker('region');
      }
    },
    [displays, startRegionSelection],
  );

  const onKindChange = (kind: SourceKind) => {
    void changeSettings({ sourceKind: kind });
    const sel = selectionRef.current;
    const missing = (kind === 'window' && !sel.window) || (kind === 'monitor' && !sel.monitor) || (kind === 'region' && !sel.region);
    if (missing) chooseForKind(kind);
  };

  const onPick = (source: CaptureSource) => {
    const mode = picker;
    setPicker(null);
    if (mode === 'window') setSelection((s) => ({ ...s, window: source }));
    else if (mode === 'monitor') setSelection((s) => ({ ...s, monitor: source }));
    else if (mode === 'region') {
      const display = displays.find((d) => d.id === source.displayId) ?? displays[0];
      if (display) void startRegionSelection(display);
    }
  };

  const summary: SelectionSummary = useMemo(() => {
    switch (settings?.sourceKind) {
      case 'window':
        return selection.window
          ? { title: selection.window.name, detail: 'Application window', thumbnail: selection.window.thumbnail, icon: selection.window.appIcon, needsChoice: false }
          : { title: 'No window selected', detail: 'Choose the app you want to record', needsChoice: true };
      case 'monitor':
        return selection.monitor
          ? { title: selection.monitor.name, detail: displays.find((d) => d.id === selection.monitor!.displayId)?.label, thumbnail: selection.monitor.thumbnail, needsChoice: false }
          : { title: 'No monitor selected', detail: 'Choose which display to record', needsChoice: true };
      case 'region':
        return selection.region
          ? {
              title: `${Math.round(selection.region.rect.width)} × ${Math.round(selection.region.rect.height)} area`,
              detail: selection.region.displayLabel,
              needsChoice: false,
            }
          : { title: 'No region selected', detail: 'Drag to select an area of the screen', needsChoice: true };
      default:
        return {
          title: 'Entire screen',
          detail: displays.find((d) => d.primary)?.label ?? 'Primary display',
          thumbnail: primaryScreen?.thumbnail,
          needsChoice: false,
        };
    }
  }, [settings?.sourceKind, selection, displays, primaryScreen]);

  // ---------- Misc actions ----------

  const chooseFolder = async () => {
    try {
      const next = await api.chooseOutputFolder();
      if (next) {
        setSettings(next);
        notify('success', 'Output folder updated.');
      }
    } catch (err) {
      notify('error', errorMessage(err));
    }
  };

  const openFolder = () => api.openOutputFolder().catch((err) => notify('error', errorMessage(err)));

  const removeEntry = async (entry: RecordingEntry) => {
    const deleteFile =
      entry.exists !== false &&
      window.confirm(`Remove "${entry.fileName}" from history?\n\nOK = also move the video file to the Recycle Bin\nCancel = keep the file`);
    try {
      setHistory(await api.removeHistory(entry.id, deleteFile));
      if (lastSaved?.id === entry.id) setLastSaved(null);
    } catch (err) {
      notify('error', errorMessage(err));
    }
  };

  const recover = async (r: RecoverableRecording) => {
    setRecovering(r.sessionId);
    try {
      onFinished(await api.recover(r.sessionId));
    } catch (err) {
      notify('error', errorMessage(err));
    } finally {
      setRecovering(null);
      refreshRecoverable();
    }
  };

  const discard = async (r: RecoverableRecording) => {
    if (!window.confirm('Permanently delete this unfinished recording?')) return;
    await api.discardRecoverable(r.sessionId);
    refreshRecoverable();
  };

  if (!settings) {
    return (
      <div className="app-loading">
        <Logo size={48} />
      </div>
    );
  }

  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-brand">
          <Logo size={22} />
          <span className="titlebar-title">ScreenCapture Pro</span>
        </div>
        <div className="titlebar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => void changeSettings({ theme: isDark ? 'light' : 'dark' })}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Light theme' : 'Dark theme'}
          >
            {isDark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            <GearIcon size={18} />
          </button>
        </div>
      </header>

      <main className="content">
        {recoverable.length > 0 && (
          <div className="banner banner-warning" role="status">
            <WarningIcon size={18} />
            <div className="banner-text">
              <strong>Unfinished recording found.</strong>
              {recoverable.map((r) => (
                <div key={r.sessionId} className="banner-item">
                  <span>
                    {r.sourceName} · {formatDate(r.createdAt)} · {formatBytes(r.sizeBytes)}
                  </span>
                  <button type="button" className="btn btn-primary btn-sm" disabled={recovering !== null || busy} onClick={() => void recover(r)}>
                    {recovering === r.sessionId ? 'Recovering…' : 'Recover'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={recovering !== null} onClick={() => void discard(r)}>
                    Discard
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="dashboard">
          <section className="card hero" aria-labelledby="hero-title">
            <h1 id="hero-title" className="sr-only">
              Recorder
            </h1>
            <div className={`status-pill status-${status}`} role="status" aria-live="polite">
              <span className="status-dot" aria-hidden="true" />
              {STATUS_TEXT[status]}
              {recorder.state.sourceName && active ? ` · ${recorder.state.sourceName}` : ''}
            </div>

            <div className={`timer ${active ? 'is-live' : ''}`} aria-label={`Elapsed time ${formatDuration(recorder.state.elapsedMs)}`}>
              {formatDuration(recorder.state.elapsedMs)}
            </div>

            <RecordButton status={status} onStart={() => void recorder.start()} onStop={() => void recorder.stop()} />

            <div className="hero-controls">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={recorder.togglePause}
                disabled={!active}
                aria-label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
              >
                {status === 'paused' ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
                {status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void recorder.stop()} disabled={!active} aria-label="Stop recording">
                <StopIcon size={16} />
                Stop
              </button>
            </div>

            {status === 'finalizing' && (
              <div className="progress" role="progressbar" aria-label="Saving MP4" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((recorder.state.finalizeProgress ?? 0) * 100)}>
                <div className="progress-bar" style={{ width: `${Math.round((recorder.state.finalizeProgress ?? 0) * 100)}%` }} />
              </div>
            )}

            <p id="record-shortcut-hint" className="muted small hero-hint">
              <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> start · <kbd>P</kbd> pause · <kbd>S</kbd> stop
            </p>

            {lastSaved && status === 'idle' && (
              <div className="saved-card">
                <span className="saved-icon">
                  <CheckIcon size={18} />
                </span>
                <div className="saved-text">
                  <strong>Recording saved</strong>
                  <span className="muted small path-text" title={lastSaved.filePath}>
                    {lastSaved.filePath}
                  </span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void api.playRecording(lastSaved.id).catch((e) => notify('error', errorMessage(e)))}>
                  <PlayIcon size={14} /> Play
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.showRecordingInFolder(lastSaved.id)}>
                  <FolderIcon size={14} /> Open folder
                </button>
              </div>
            )}
          </section>

          <div className="options-column">
            <section className="card" aria-labelledby="source-title">
              <h2 id="source-title" className="card-title">
                Recording source
              </h2>
              <SourceSelector
                value={settings.sourceKind}
                disabled={busy}
                summary={summary}
                onChange={onKindChange}
                onChoose={() => chooseForKind(settings.sourceKind)}
              />
            </section>

            <div className="options-pair">
              <section className="card" aria-labelledby="audio-title">
                <h2 id="audio-title" className="card-title">
                  Audio
                </h2>
                <AudioOptions settings={settings} microphones={microphones} disabled={busy} onChange={(p) => void changeSettings(p)} />
              </section>
              <section className="card" aria-labelledby="video-title">
                <h2 id="video-title" className="card-title">
                  Video
                </h2>
                <VideoOptions settings={settings} disabled={busy} onChange={(p) => void changeSettings(p)} />
              </section>
            </div>

            <section className="card" aria-labelledby="output-title">
              <h2 id="output-title" className="card-title">
                Save recordings to
              </h2>
              <OutputFolder folder={settings.outputFolder} disabled={busy} onChoose={() => void chooseFolder()} onOpen={() => void openFolder()} />
            </section>
          </div>
        </div>

        <section className="card history" aria-labelledby="history-title">
          <div className="card-header">
            <h2 id="history-title" className="card-title">
              Recordings
            </h2>
            <span className="muted small">{history.length > 0 ? `${history.length} recording${history.length === 1 ? '' : 's'}` : ''}</span>
          </div>
          <HistoryList
            entries={history}
            onPlay={(e) => void api.playRecording(e.id).catch((err) => notify('error', errorMessage(err)))}
            onShow={(e) => void api.showRecordingInFolder(e.id).catch((err) => notify('error', errorMessage(err)))}
            onRemove={(e) => void removeEntry(e)}
          />
        </section>
      </main>

      <ToastStack toasts={toasts} dismiss={dismiss} />

      {picker && (
        <SourcePicker
          kind={picker === 'window' ? 'window' : 'screen'}
          title={picker === 'window' ? 'Choose a window' : picker === 'monitor' ? 'Choose a monitor' : 'Choose a display for the region'}
          description={
            picker === 'window'
              ? 'Only the selected application window will be recorded, even if other windows cover it.'
              : picker === 'monitor'
                ? 'Everything shown on the selected display will be recorded.'
                : 'You will drag to select an area on the chosen display next.'
          }
          selectedId={picker === 'window' ? selection.window?.id : picker === 'monitor' ? selection.monitor?.id : undefined}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          ffmpeg={ffmpeg}
          shortcuts={shortcuts}
          info={info}
          recording={busy}
          onChange={(p) => void changeSettings(p)}
          onChooseFolder={() => void chooseFolder()}
          onOpenFolder={() => void openFolder()}
          onChooseFfmpeg={async () => {
            try {
              const next = await api.chooseFfmpeg();
              if (next) {
                setSettings(next);
                setFfmpeg(await api.getFfmpegStatus());
              }
            } catch (err) {
              notify('error', errorMessage(err));
            }
          }}
          onResetFfmpeg={async () => {
            await changeSettings({ ffmpegPath: '' });
            setFfmpeg(await api.getFfmpegStatus());
          }}
          onOpenLogs={() => void api.openLogFolder()}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
