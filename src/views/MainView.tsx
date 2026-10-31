import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { ControlBar } from '../components/ControlBar';
import { CameraIcon, CheckIcon, FilmIcon, FolderIcon, PlayIcon, ScreenIcon, SpeakerIcon, WarningIcon } from '../components/icons';
import { Logo } from '../components/Logo';
import { AudioOptions, CameraOptions, OutputFolder, VideoOptions } from '../components/Options';
import { PreviewPanel } from '../components/PreviewPanel';
import { Sidebar, type Page } from '../components/Sidebar';
import { SourcePicker } from '../components/SourcePicker';
import { SourceSelector, type SelectionSummary } from '../components/SourceSelector';
import { ToastStack, useToasts } from '../components/Toasts';
import { RecordingsPage } from '../pages/RecordingsPage';
import { SettingsPage } from '../pages/SettingsPage';
import type { EngineStartOptions } from '../recorder/engine';
import { useRecorder } from '../recorder/useRecorder';
import { formatBytes, formatDate } from '../utils/format';

interface Selection {
  monitor?: CaptureSource;
  window?: CaptureSource;
  region?: { displayId: string; rect: Rect; displayLabel: string };
}

type PickerMode = 'window' | 'monitor' | 'region' | null;

export function MainView() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [screens, setScreens] = useState<CaptureSource[]>([]);
  const [primaryScreen, setPrimaryScreen] = useState<CaptureSource | null>(null);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [page, setPage] = useState<Page>('record');
  const [history, setHistory] = useState<RecordingEntry[]>([]);
  const [recoverable, setRecoverable] = useState<RecoverableRecording[]>([]);
  const [recovering, setRecovering] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<RecordingEntry | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
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
    setScreens(screens);
    const primary = ds.find((d) => d.primary);
    setPrimaryScreen(screens.find((s) => s.displayId === primary?.id) ?? screens[0] ?? null);
  }, []);

  const refreshMicrophones = useCallback(async (unlockLabels = false) => {
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === 'audioinput');
      if (unlockLabels && mics.length > 0 && mics.every((d) => !d.label)) {
        // Device names are hidden until microphone access has been granted once.
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      }
      setMicrophones(devices.filter((d) => d.kind === 'audioinput'));
      setCameras(devices.filter((d) => d.kind === 'videoinput'));
    } catch {
      setMicrophones([]);
      setCameras([]);
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
    const offHistory = api.onHistoryChanged(refreshHistory);
    const onFocus = () => {
      refreshHistory();
      void refreshScreens();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      offSettings();
      offNotice();
      offHistory();
      window.removeEventListener('focus', onFocus);
    };
  }, [notify, refreshHistory, refreshMicrophones, refreshRecoverable, refreshScreens]);

  useEffect(() => {
    if (settings?.microphone) void refreshMicrophones(true);
  }, [settings?.microphone, refreshMicrophones]);

  // Camera names become readable once the camera bubble has been granted access.
  useEffect(() => {
    if (!settings?.camera) return;
    const id = window.setTimeout(() => void refreshMicrophones(), 1500);
    return () => window.clearTimeout(id);
  }, [settings?.camera, refreshMicrophones]);

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
          ? { title: selection.window.name, detail: 'Application window', icon: selection.window.appIcon, needsChoice: false }
          : { title: 'No window selected', detail: 'Choose the app you want to record', needsChoice: true };
      case 'monitor':
        return selection.monitor
          ? { title: selection.monitor.name, detail: displays.find((d) => d.id === selection.monitor!.displayId)?.label, needsChoice: false }
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
          needsChoice: false,
        };
    }
  }, [settings?.sourceKind, selection, displays]);

  /** Which screen/window the live preview shows, plus the region outline for custom regions. */
  const preview = useMemo((): { sourceId?: string; region?: { rect: Rect; displayBounds: Rect } } => {
    switch (settings?.sourceKind) {
      case 'window':
        return { sourceId: selection.window?.id };
      case 'monitor':
        return { sourceId: selection.monitor?.id };
      case 'region': {
        const r = selection.region;
        const display = r && displays.find((d) => d.id === r.displayId);
        if (!r || !display) return {};
        return { sourceId: screens.find((s) => s.displayId === r.displayId)?.id, region: { rect: r.rect, displayBounds: display.bounds } };
      }
      default:
        return { sourceId: primaryScreen?.id };
    }
  }, [settings?.sourceKind, selection, displays, screens, primaryScreen]);

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
  const savedEntry = lastSaved ? (history.find((h) => h.id === lastSaved.id) ?? lastSaved) : null;

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-brand">
          <Logo size={20} />
          <span className="titlebar-title">ScreenCapture Pro</span>
        </div>
      </header>

      <div className="shell">
        <Sidebar
          page={page}
          recordingsCount={history.length}
          recorder={recorder.state}
          isDark={isDark}
          version={info?.version}
          onNavigate={setPage}
          onToggleTheme={() => void changeSettings({ theme: isDark ? 'light' : 'dark' })}
        />

        <main className="content">
          {page === 'record' && (
            <div className="page page-record">
              {recoverable.length > 0 && (
                <div className="banner banner-warning" role="status">
                  <WarningIcon size={18} />
                  <div className="banner-text">
                    <strong>Unfinished recording found</strong>
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

              <div className="record-layout">
                <div className="record-main">
                  <PreviewPanel
                    kind={settings.sourceKind}
                    summary={summary}
                    sourceId={preview.sourceId}
                    region={preview.region}
                    recording={active}
                    disabled={busy}
                    onChoose={() => chooseForKind(settings.sourceKind)}
                  />
                  <ControlBar
                    state={recorder.state}
                    onStart={() => void recorder.start()}
                    onStop={() => void recorder.stop()}
                    onTogglePause={recorder.togglePause}
                  />
                  {savedEntry && status === 'idle' && (
                    <div className="saved-strip" role="status">
                      <span className="saved-strip-thumb" aria-hidden="true">
                        {savedEntry.thumbnail ? <img src={savedEntry.thumbnail} alt="" /> : <CheckIcon size={18} />}
                      </span>
                      <div className="saved-strip-text">
                        <strong>Recording saved</strong>
                        <span className="muted small path-text" title={savedEntry.filePath}>
                          {savedEntry.filePath}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void api.playRecording(savedEntry.id).catch((e) => notify('error', errorMessage(e)))}
                      >
                        <PlayIcon size={14} /> Play
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.showRecordingInFolder(savedEntry.id)}>
                        <FolderIcon size={14} /> Show in folder
                      </button>
                    </div>
                  )}
                </div>

                <aside className="options-panel" aria-label="Recording options">
                  <PanelSection title="Source" icon={<ScreenIcon size={16} />}>
                    <SourceSelector value={settings.sourceKind} disabled={busy} onChange={onKindChange} />
                  </PanelSection>
                  <PanelSection title="Audio" icon={<SpeakerIcon size={16} />}>
                    <AudioOptions settings={settings} microphones={microphones} disabled={busy} onChange={(p) => void changeSettings(p)} />
                  </PanelSection>
                  <PanelSection title="Camera" icon={<CameraIcon size={16} />}>
                    <CameraOptions settings={settings} cameras={cameras} onChange={(p) => void changeSettings(p)} />
                  </PanelSection>
                  <PanelSection title="Video" icon={<FilmIcon size={16} />}>
                    <VideoOptions settings={settings} disabled={busy} onChange={(p) => void changeSettings(p)} />
                  </PanelSection>
                  <PanelSection title="Save to" icon={<FolderIcon size={16} />}>
                    <OutputFolder folder={settings.outputFolder} disabled={busy} onChoose={() => void chooseFolder()} onOpen={() => void openFolder()} />
                  </PanelSection>
                </aside>
              </div>
            </div>
          )}

          {page === 'recordings' && (
            <RecordingsPage
              entries={history}
              folder={settings.outputFolder}
              onPlay={(e) => void api.playRecording(e.id).catch((err) => notify('error', errorMessage(err)))}
              onShow={(e) => void api.showRecordingInFolder(e.id).catch((err) => notify('error', errorMessage(err)))}
              onRemove={(e) => void removeEntry(e)}
              onOpenFolder={() => void openFolder()}
              onRecordNow={() => setPage('record')}
            />
          )}

          {page === 'settings' && (
            <SettingsPage
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
            />
          )}
        </main>
      </div>

      <ToastStack toasts={toasts} dismiss={dismiss} />

      {picker && (
        <SourcePicker
          mode={picker}
          displays={displays}
          selectedId={picker === 'window' ? selection.window?.id : picker === 'monitor' ? selection.monitor?.id : undefined}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function PanelSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="panel-section">
      <h2 className="panel-title">
        <span className="panel-title-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
