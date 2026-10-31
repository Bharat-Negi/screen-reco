// Types shared by the Electron main process, the preload script and the React renderer.
// The sandboxed preload cannot require runtime modules, so it may only use `import type` from here.

export type SourceKind = 'screen' | 'window' | 'monitor' | 'region';
export type Quality = '720p' | '1080p' | 'native';
export type FrameRate = 30 | 60;
export type ThemeSetting = 'system' | 'light' | 'dark';

/** Camera bubble diameter limits, in DIPs. */
export const CAMERA_MIN_DIAMETER = 100;
export const CAMERA_MAX_DIAMETER = 600;

export interface AppSettings {
  outputFolder: string;
  theme: ThemeSetting;
  quality: Quality;
  fps: FrameRate;
  sourceKind: SourceKind;
  systemAudio: boolean;
  microphone: boolean;
  microphoneDeviceId: string;
  /** Floating webcam bubble that is captured together with the screen. */
  camera: boolean;
  cameraDeviceId: string;
  /** Bubble diameter in DIPs (CAMERA_MIN_DIAMETER..CAMERA_MAX_DIAMETER). */
  cameraDiameter: number;
  cameraMirror: boolean;
  hideAppFromCapture: boolean;
  minimizeOnRecord: boolean;
  globalShortcuts: boolean;
  showNotifications: boolean;
  /** Absolute path to a user-supplied ffmpeg.exe, or '' to auto-detect. */
  ffmpegPath: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon?: string;
  /** Only for screens: matches DisplayInfo.id. */
  displayId?: string;
}

export interface DisplayInfo {
  id: string;
  label: string;
  bounds: Rect;
  scaleFactor: number;
  primary: boolean;
}

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'finalizing';

export interface RecorderState {
  status: RecorderStatus;
  elapsedMs: number;
  sourceName?: string;
  /** 0..1 while the MP4 is being encoded. */
  finalizeProgress?: number;
}

export type RecorderCommand = 'start' | 'stop' | 'pause' | 'resume' | 'toggle-pause';

/** Everything needed to turn a raw capture into the final file. Persisted next to the temp file for crash recovery. */
export interface SessionMeta {
  sourceName: string;
  quality: Quality;
  fps: FrameRate;
  /** Crop rectangle in captured-video pixels (custom region recordings). */
  crop?: Rect;
  hasAudio: boolean;
  mimeType: string;
  createdAt: string;
}

export interface RecordingEntry {
  id: string;
  fileName: string;
  filePath: string;
  createdAt: string;
  durationMs: number;
  sizeBytes: number;
  sourceName: string;
  format: 'mp4' | 'webm' | 'mkv';
  /** Filled in by the main process when listing; false when the file was moved or deleted. */
  exists?: boolean;
  /** Filled in by the main process when listing: JPEG data URL of a frame from the video. */
  thumbnail?: string;
}

export type FinalizeResult =
  | { ok: true; entry: RecordingEntry; warning?: string }
  | { ok: false; error: string; tempPath?: string };

export interface DiskStatus {
  path: string;
  freeBytes: number;
  level: 'ok' | 'low' | 'critical';
}

export interface FfmpegStatus {
  available: boolean;
  path?: string;
  version?: string;
  source?: 'custom' | 'bundled' | 'system';
  error?: string;
}

export interface RecoverableRecording {
  sessionId: string;
  createdAt: string;
  sizeBytes: number;
  sourceName: string;
}

export interface AppNotice {
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface ShortcutStatus {
  global: boolean;
  failed: string[];
}

export interface AppInfo {
  version: string;
  logPath: string;
  windowsBuild: number;
}

/** The API exposed to the renderer as `window.scp` by the preload script. */
export interface ScpApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  chooseOutputFolder(): Promise<AppSettings | null>;
  chooseFfmpeg(): Promise<AppSettings | null>;
  openOutputFolder(): Promise<void>;
  openLogFolder(): Promise<void>;

  getSources(kind: 'screen' | 'window'): Promise<CaptureSource[]>;
  getDisplays(): Promise<DisplayInfo[]>;
  selectRegion(displayId: string): Promise<Rect | null>;
  prepareCapture(sourceId: string, systemAudio: boolean): Promise<void>;
  /** A fresh still image of a screen or window, for the live preview. */
  getSourceThumbnail(sourceId: string): Promise<string | null>;

  checkDisk(): Promise<DiskStatus>;
  getFfmpegStatus(): Promise<FfmpegStatus>;
  getShortcutStatus(): Promise<ShortcutStatus>;

  startSession(meta: Omit<SessionMeta, 'createdAt'>): Promise<{ sessionId: string }>;
  writeChunk(sessionId: string, data: Uint8Array): Promise<void>;
  finalizeSession(sessionId: string, durationMs: number): Promise<FinalizeResult>;
  abortSession(sessionId: string): Promise<void>;

  listRecoverable(): Promise<RecoverableRecording[]>;
  recover(sessionId: string): Promise<FinalizeResult>;
  discardRecoverable(sessionId: string): Promise<void>;

  listHistory(): Promise<RecordingEntry[]>;
  removeHistory(id: string, deleteFile: boolean): Promise<RecordingEntry[]>;
  playRecording(id: string): Promise<void>;
  showRecordingInFolder(id: string): Promise<void>;

  publishState(state: RecorderState): void;
  getRecorderState(): Promise<RecorderState>;
  sendCommand(command: RecorderCommand): void;
  setToolbarCompact(compact: boolean): void;
  submitRegion(rect: Rect | null): void;
  reportCameraError(message: string): void;
  /** Live move/resize of the camera bubble window (not persisted; persist the size with updateSettings). */
  moveCamera(x: number, y: number): void;
  resizeCamera(diameter: number, anchor: 'top-left' | 'center'): void;

  onCommand(cb: (command: RecorderCommand) => void): () => void;
  onState(cb: (state: RecorderState) => void): () => void;
  onFinalizeProgress(cb: (progress: number) => void): () => void;
  onNotice(cb: (notice: AppNotice) => void): () => void;
  onSettings(cb: (settings: AppSettings) => void): () => void;
  /** Fired when history changes in the background (e.g. thumbnails were generated). */
  onHistoryChanged(cb: () => void): () => void;
}
