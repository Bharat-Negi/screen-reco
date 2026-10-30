// Sandboxed preload: only `electron` may be required here, and only type imports are allowed from shared/.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ScpApi } from '../shared/types';

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ScpApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  chooseOutputFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  chooseFfmpeg: () => ipcRenderer.invoke('settings:choose-ffmpeg'),
  openOutputFolder: () => ipcRenderer.invoke('shell:open-output'),
  openLogFolder: () => ipcRenderer.invoke('shell:open-logs'),

  getSources: (kind) => ipcRenderer.invoke('capture:sources', kind),
  getDisplays: () => ipcRenderer.invoke('capture:displays'),
  selectRegion: (displayId) => ipcRenderer.invoke('capture:select-region', displayId),
  prepareCapture: (sourceId, systemAudio) => ipcRenderer.invoke('capture:prepare', sourceId, systemAudio),

  checkDisk: () => ipcRenderer.invoke('disk:check'),
  getFfmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  getShortcutStatus: () => ipcRenderer.invoke('shortcuts:status'),

  startSession: (meta) => ipcRenderer.invoke('session:start', meta),
  writeChunk: (sessionId, data) => ipcRenderer.invoke('session:chunk', sessionId, data),
  finalizeSession: (sessionId, durationMs) => ipcRenderer.invoke('session:finalize', sessionId, durationMs),
  abortSession: (sessionId) => ipcRenderer.invoke('session:abort', sessionId),

  listRecoverable: () => ipcRenderer.invoke('recovery:list'),
  recover: (sessionId) => ipcRenderer.invoke('recovery:recover', sessionId),
  discardRecoverable: (sessionId) => ipcRenderer.invoke('recovery:discard', sessionId),

  listHistory: () => ipcRenderer.invoke('history:list'),
  removeHistory: (id, deleteFile) => ipcRenderer.invoke('history:remove', id, deleteFile),
  playRecording: (id) => ipcRenderer.invoke('history:play', id),
  showRecordingInFolder: (id) => ipcRenderer.invoke('history:show', id),

  publishState: (state) => ipcRenderer.send('recorder:publish-state', state),
  getRecorderState: () => ipcRenderer.invoke('recorder:get-state'),
  sendCommand: (command) => ipcRenderer.send('recorder:command', command),
  setToolbarCompact: (compact) => ipcRenderer.send('toolbar:compact', compact),
  submitRegion: (rect) => ipcRenderer.send('region:submit', rect),

  onCommand: (cb) => subscribe('recorder:command', cb),
  onState: (cb) => subscribe('recorder:state', cb),
  onFinalizeProgress: (cb) => subscribe('recorder:finalize-progress', cb),
  onNotice: (cb) => subscribe('app:notice', cb),
  onSettings: (cb) => subscribe('settings:changed', cb),
};

contextBridge.exposeInMainWorld('scp', api);
