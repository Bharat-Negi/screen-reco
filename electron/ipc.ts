import { app, desktopCapturer, dialog, ipcMain, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import os from 'node:os';
import type { AppSettings, CaptureSource, DisplayInfo, RecorderCommand, RecorderState } from '../shared/types';
import { checkRecordingDisks } from './services/disk';
import { resolveFfmpeg } from './services/ffmpeg';
import { getHistoryEntry, listHistory, removeHistory } from './services/history';
import { getLogDir, log } from './services/logger';
import { backfillThumbnails } from './services/thumbnails';
import * as sessions from './services/sessions';
import { getSettings, isUsableFolder, updateSettings } from './services/settings';
import {
  broadcast,
  getCameraWindow,
  getMainWindow,
  getToolbarWindow,
  isTrustedUrl,
  moveCamera,
  resizeCamera,
  selectRegion,
  setToolbarCompact,
  submitRegion,
} from './windows';

export interface IpcContext {
  getRecorderState(): RecorderState;
  onRecorderState(state: RecorderState): void;
  sendCommand(command: RecorderCommand): void;
  setPendingCapture(capture: { id: string; name: string; systemAudio: boolean }): void;
  onSettingsChanged(settings: AppSettings): void;
  getShortcutStatus(): { global: boolean; failed: string[] };
  onCameraError(message: string): void;
}

const COMMANDS: RecorderCommand[] = ['start', 'stop', 'pause', 'resume', 'toggle-pause'];
const STATUSES = ['idle', 'starting', 'recording', 'paused', 'stopping', 'finalizing'];

function assertTrusted(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (!isTrustedUrl(event.senderFrame?.url)) {
    log.warn('Rejected IPC from untrusted sender', event.senderFrame?.url);
    throw new Error('Untrusted sender');
  }
}

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event);
    try {
      return await fn(...args);
    } catch (err) {
      log.error(`IPC ${channel} failed`, err);
      throw err;
    }
  });
}

function on(channel: string, fn: (...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertTrusted(event);
      fn(...args);
    } catch (err) {
      log.error(`IPC ${channel} failed`, err);
    }
  });
}

function ownWindowSourceIds(): Set<string> {
  const ids = new Set<string>();
  for (const win of [getMainWindow(), getToolbarWindow(), getCameraWindow()]) {
    if (win) ids.add(win.getMediaSourceId());
  }
  return ids;
}

async function getSources(kind: unknown): Promise<CaptureSource[]> {
  const type = kind === 'window' ? 'window' : 'screen';
  const sources = await desktopCapturer.getSources({
    types: [type],
    thumbnailSize: { width: 384, height: 216 },
    fetchWindowIcons: type === 'window',
  });
  const own = ownWindowSourceIds();
  return sources
    .filter((s) => !own.has(s.id) && s.name.trim() !== '')
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: type,
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
      displayId: s.display_id || undefined,
    }));
}

function getDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: `${d.label || `Display ${i + 1}`} — ${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)}`,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    primary: d.id === primaryId,
  }));
}

function sendProgress(fraction: number): void {
  broadcast('recorder:finalize-progress', fraction);
}

export function registerIpc(ctx: IpcContext): void {
  handle('app:info', () => ({
    version: app.getVersion(),
    logPath: getLogDir(),
    windowsBuild: Number(os.release().split('.')[2] ?? 0),
  }));

  handle('settings:get', () => getSettings());
  handle('settings:update', (patch: unknown) => {
    const next = updateSettings(patch);
    ctx.onSettingsChanged(next);
    return next;
  });
  handle('settings:choose-folder', async () => {
    const win = getMainWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Choose where recordings are saved',
      defaultPath: getSettings().outputFolder,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const folder = result.filePaths[0];
    if (result.canceled || !isUsableFolder(folder)) return null;
    const next = updateSettings({ outputFolder: folder });
    ctx.onSettingsChanged(next);
    return next;
  });
  handle('settings:choose-ffmpeg', async () => {
    const win = getMainWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Locate ffmpeg.exe',
      properties: ['openFile'],
      filters: [{ name: 'FFmpeg', extensions: ['exe'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const status = await resolveFfmpeg(result.filePaths[0], true);
    if (!status.available || status.source !== 'custom') {
      throw new Error('That file is not a working FFmpeg executable.');
    }
    const next = updateSettings({ ffmpegPath: result.filePaths[0] });
    ctx.onSettingsChanged(next);
    return next;
  });
  handle('shell:open-output', async () => {
    const folder = getSettings().outputFolder;
    await import('node:fs').then((fs) => fs.promises.mkdir(folder, { recursive: true }));
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  handle('shell:open-logs', async () => {
    await shell.openPath(getLogDir());
  });

  handle('capture:sources', (kind: unknown) => getSources(kind));
  handle('capture:displays', () => getDisplays());
  handle('capture:select-region', (displayId: unknown) => {
    if (typeof displayId !== 'string') throw new Error('Invalid display.');
    return selectRegion(displayId);
  });
  handle('capture:prepare', async (sourceId: unknown, systemAudio: unknown) => {
    if (typeof sourceId !== 'string') throw new Error('Invalid capture source.');
    const all = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    const source = all.find((s) => s.id === sourceId);
    if (!source) throw new Error('The selected screen or window is no longer available. Please choose it again.');
    ctx.setPendingCapture({ id: source.id, name: source.name, systemAudio: systemAudio === true });
  });

  handle('capture:thumbnail', async (sourceId: unknown) => {
    if (typeof sourceId !== 'string') return null;
    const type = sourceId.startsWith('window:') ? 'window' : 'screen';
    const sources = await desktopCapturer.getSources({
      types: [type],
      thumbnailSize: { width: 960, height: 540 },
      fetchWindowIcons: false,
    });
    const source = sources.find((s) => s.id === sourceId);
    return source && !source.thumbnail.isEmpty()
      ? `data:image/jpeg;base64,${source.thumbnail.toJPEG(82).toString('base64')}`
      : null;
  });

  handle('disk:check', () => checkRecordingDisks(getSettings().outputFolder, sessions.tempDir()));
  handle('ffmpeg:status', () => resolveFfmpeg(getSettings().ffmpegPath, true));
  handle('shortcuts:status', () => ctx.getShortcutStatus());

  handle('session:start', (meta: unknown) => sessions.startSession(meta));
  handle('session:chunk', (sessionId: unknown, data: unknown) => sessions.writeChunk(sessionId, data));
  handle('session:finalize', (sessionId: unknown, durationMs: unknown) =>
    sessions.finalizeSession(sessionId, durationMs, sendProgress),
  );
  handle('session:abort', (sessionId: unknown) => sessions.abortSession(sessionId));

  handle('recovery:list', () => sessions.listRecoverable());
  handle('recovery:recover', (sessionId: unknown) => sessions.recoverSession(sessionId, sendProgress));
  handle('recovery:discard', (sessionId: unknown) => sessions.discardRecoverable(sessionId));

  handle('history:list', () => {
    const entries = listHistory();
    void backfillThumbnails(entries, () => getMainWindow()?.webContents.send('history:changed'));
    return entries;
  });
  handle('history:remove', (id: unknown, deleteFile: unknown) => removeHistory(id, deleteFile === true));
  handle('history:play', async (id: unknown) => {
    const entry = getHistoryEntry(id);
    if (!entry) throw new Error('Recording not found.');
    const error = await shell.openPath(entry.filePath);
    if (error) throw new Error(`Could not open the video: ${error}`);
  });
  handle('history:show', (id: unknown) => {
    const entry = getHistoryEntry(id);
    if (!entry) throw new Error('Recording not found.');
    shell.showItemInFolder(entry.filePath);
  });

  handle('recorder:get-state', () => ctx.getRecorderState());
  on('recorder:publish-state', (state: unknown) => {
    const s = state as RecorderState;
    if (!s || !STATUSES.includes(s.status) || typeof s.elapsedMs !== 'number') return;
    ctx.onRecorderState({
      status: s.status,
      elapsedMs: s.elapsedMs,
      sourceName: typeof s.sourceName === 'string' ? s.sourceName.slice(0, 200) : undefined,
      finalizeProgress: typeof s.finalizeProgress === 'number' ? s.finalizeProgress : undefined,
    });
  });
  on('recorder:command', (command: unknown) => {
    if (COMMANDS.includes(command as RecorderCommand)) ctx.sendCommand(command as RecorderCommand);
  });
  on('toolbar:compact', (compact: unknown) => setToolbarCompact(compact === true));
  on('region:submit', (rect: unknown) => submitRegion(rect));
  on('camera:move', (x: unknown, y: unknown) => moveCamera(x, y));
  on('camera:resize', (diameter: unknown, anchor: unknown) => resizeCamera(diameter, anchor));
  on('camera:error', (message: unknown) => {
    if (typeof message === 'string') ctx.onCameraError(message.slice(0, 500));
  });
}
