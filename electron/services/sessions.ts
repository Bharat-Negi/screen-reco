import { app, Notification, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FinalizeResult, RecordingEntry, RecoverableRecording, SessionMeta } from '../../shared/types';
import { buildTranscodeArgs, resolveFfmpeg, transcode } from './ffmpeg';
import { addHistory } from './history';
import { log } from './logger';
import { getSettings } from './settings';
import { createThumbnail } from './thumbnails';

/**
 * A recording session streams MediaRecorder chunks straight to a temp file on disk, so a crash
 * or power loss never loses more than about a second of footage. On stop the temp file is
 * encoded to MP4 by FFmpeg, then removed.
 */
interface ActiveSession {
  id: string;
  tempPath: string;
  metaPath: string;
  meta: SessionMeta;
  stream: fs.WriteStream;
  bytes: number;
  finalizing: boolean;
}

const MAX_CHUNK_BYTES = 128 * 1024 * 1024;
const SESSION_ID = /^[0-9a-f-]{36}$/;
const active = new Map<string, ActiveSession>();

export function tempDir(): string {
  return path.join(app.getPath('userData'), 'recordings-temp');
}

function containerExt(mimeType: string): 'webm' | 'mkv' {
  return /h264|avc1|matroska/i.test(mimeType) ? 'mkv' : 'webm';
}

function pathsFor(id: string): { tempPath: string; metaPath: string } {
  return { tempPath: path.join(tempDir(), `${id}.capture`), metaPath: path.join(tempDir(), `${id}.json`) };
}

export function hasActiveSessions(): boolean {
  return active.size > 0;
}

export async function startSession(input: unknown): Promise<{ sessionId: string }> {
  const raw = (input ?? {}) as Partial<SessionMeta>;
  const meta: SessionMeta = {
    sourceName: typeof raw.sourceName === 'string' ? raw.sourceName.slice(0, 200) : 'Screen',
    quality: raw.quality === '720p' || raw.quality === 'native' ? raw.quality : '1080p',
    fps: raw.fps === 60 ? 60 : 30,
    hasAudio: raw.hasAudio === true,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType.slice(0, 100) : 'video/webm',
    createdAt: new Date().toISOString(),
  };
  const c = raw.crop;
  if (c && [c.x, c.y, c.width, c.height].every((n) => Number.isFinite(n) && n >= 0) && c.width >= 16 && c.height >= 16) {
    meta.crop = { x: c.x, y: c.y, width: c.width, height: c.height };
  }

  await fs.promises.mkdir(tempDir(), { recursive: true });
  const id = randomUUID();
  const { tempPath, metaPath } = pathsFor(id);
  await fs.promises.writeFile(metaPath, JSON.stringify(meta), 'utf8');
  const stream = fs.createWriteStream(tempPath, { flags: 'wx' });
  await new Promise<void>((resolve, reject) => {
    stream.once('open', () => resolve());
    stream.once('error', reject);
  });
  active.set(id, { id, tempPath, metaPath, meta, stream, bytes: 0, finalizing: false });
  log.info(`Session ${id} started`, meta);
  return { sessionId: id };
}

export function writeChunk(sessionId: unknown, data: unknown): Promise<void> {
  const session = typeof sessionId === 'string' ? active.get(sessionId) : undefined;
  if (!session || session.finalizing) return Promise.reject(new Error('Recording session is not active.'));
  if (!(data instanceof Uint8Array) || data.byteLength > MAX_CHUNK_BYTES) {
    return Promise.reject(new Error('Invalid recording data.'));
  }
  return new Promise((resolve, reject) => {
    session.stream.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength), (err) => {
      if (err) {
        log.error(`Write failed for session ${session.id}`, err);
        reject(new Error(`Could not write to disk: ${err.message}`));
      } else {
        session.bytes += data.byteLength;
        resolve();
      }
    });
  });
}

function closeStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) return resolve();
    stream.end(() => resolve());
  });
}

/** Closes all open capture files (used when the renderer crashes). They remain recoverable. */
export async function closeAllSessions(): Promise<void> {
  for (const s of active.values()) await closeStream(s.stream);
  active.clear();
}

export async function abortSession(sessionId: unknown): Promise<void> {
  const session = typeof sessionId === 'string' ? active.get(sessionId) : undefined;
  if (!session) return;
  active.delete(session.id);
  await closeStream(session.stream);
  await fs.promises.rm(session.tempPath, { force: true });
  await fs.promises.rm(session.metaPath, { force: true });
  log.info(`Session ${session.id} aborted`);
}

function timestampName(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `ScreenCapture_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Returns a path in `folder` that does not exist yet: "name.mp4", "name (2).mp4", ... */
function uniquePath(folder: string, base: string, ext: string): string {
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(folder, `${i === 1 ? base : `${base} (${i})`}.${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find a free file name.');
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fs.promises.rm(from, { force: true });
  }
}

function notifySaved(entry: RecordingEntry): void {
  if (!getSettings().showNotifications || !Notification.isSupported()) return;
  const n = new Notification({
    title: 'Recording saved',
    body: `${entry.fileName}\n${path.dirname(entry.filePath)}`,
  });
  n.on('click', () => shell.showItemInFolder(entry.filePath));
  n.show();
}

/** Encodes a raw capture into the output folder and records it in history. Shared by stop and crash recovery. */
async function produceFinalFile(
  tempPath: string,
  metaPath: string,
  meta: SessionMeta,
  durationMs: number,
  onProgress: (fraction: number) => void,
): Promise<FinalizeResult> {
  const settings = getSettings();
  const stat = await fs.promises.stat(tempPath).catch(() => null);
  if (!stat || stat.size === 0) {
    await fs.promises.rm(tempPath, { force: true });
    await fs.promises.rm(metaPath, { force: true });
    return { ok: false, error: 'No video data was captured, so nothing was saved.' };
  }

  try {
    await fs.promises.mkdir(settings.outputFolder, { recursive: true });
    await fs.promises.access(settings.outputFolder, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      error: `The output folder "${settings.outputFolder}" is not writable. Choose another folder in Settings, then use Recover.`,
      tempPath,
    };
  }

  const base = timestampName(meta.createdAt);
  const ffmpeg = await resolveFfmpeg(settings.ffmpegPath);
  let finalPath: string;
  let warning: string | undefined;
  let finalDuration = durationMs;

  if (ffmpeg.available && ffmpeg.path) {
    finalPath = uniquePath(settings.outputFolder, base, 'mp4');
    try {
      const encoded = await transcode(ffmpeg.path, buildTranscodeArgs(tempPath, finalPath, meta), durationMs, onProgress);
      if (!finalDuration) finalDuration = encoded;
    } catch (err) {
      await fs.promises.rm(finalPath, { force: true });
      log.error('Transcode failed', err);
      return {
        ok: false,
        error: `Could not create the MP4 file. ${(err as Error).message} The raw recording was kept and can be recovered.`,
        tempPath,
      };
    }
    await fs.promises.rm(tempPath, { force: true });
  } else {
    // Closest reliable fallback: keep the original capture so nothing is lost.
    const ext = containerExt(meta.mimeType);
    finalPath = uniquePath(settings.outputFolder, base, ext);
    await moveFile(tempPath, finalPath);
    warning = `FFmpeg is not available, so the recording was saved as .${ext} instead of MP4. Install FFmpeg or set its path in Settings.`;
  }
  await fs.promises.rm(metaPath, { force: true });

  const size = (await fs.promises.stat(finalPath)).size;
  const entry: RecordingEntry = {
    id: randomUUID(),
    fileName: path.basename(finalPath),
    filePath: finalPath,
    createdAt: meta.createdAt,
    durationMs: Math.round(finalDuration),
    sizeBytes: size,
    sourceName: meta.sourceName,
    format: path.extname(finalPath).slice(1) as RecordingEntry['format'],
  };
  if (entry.format === 'mp4') await createThumbnail(entry);
  addHistory(entry);
  notifySaved(entry);
  log.info(`Saved ${finalPath} (${size} bytes)`);
  return { ok: true, entry, warning };
}

export async function finalizeSession(
  sessionId: unknown,
  durationMs: unknown,
  onProgress: (fraction: number) => void,
): Promise<FinalizeResult> {
  const session = typeof sessionId === 'string' ? active.get(sessionId) : undefined;
  if (!session) return { ok: false, error: 'Recording session not found.' };
  if (session.finalizing) return { ok: false, error: 'Recording is already being saved.' };
  session.finalizing = true;
  await closeStream(session.stream);
  try {
    const duration = typeof durationMs === 'number' && Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    return await produceFinalFile(session.tempPath, session.metaPath, session.meta, duration, onProgress);
  } finally {
    active.delete(session.id);
  }
}

export async function listRecoverable(): Promise<RecoverableRecording[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(tempDir());
  } catch {
    return [];
  }
  const result: RecoverableRecording[] = [];
  for (const name of names) {
    if (!name.endsWith('.capture')) continue;
    const id = name.slice(0, -'.capture'.length);
    if (!SESSION_ID.test(id) || active.has(id)) continue;
    const { tempPath, metaPath } = pathsFor(id);
    const stat = await fs.promises.stat(tempPath).catch(() => null);
    if (!stat) continue;
    if (stat.size === 0) {
      await fs.promises.rm(tempPath, { force: true });
      await fs.promises.rm(metaPath, { force: true });
      continue;
    }
    const meta = readMeta(metaPath, stat.mtime);
    result.push({ sessionId: id, createdAt: meta.createdAt, sizeBytes: stat.size, sourceName: meta.sourceName });
  }
  return result;
}

function readMeta(metaPath: string, fallbackDate: Date): SessionMeta {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SessionMeta;
  } catch {
    return {
      sourceName: 'Recovered recording',
      quality: 'native',
      fps: 30,
      hasAudio: true,
      mimeType: 'video/webm',
      createdAt: fallbackDate.toISOString(),
    };
  }
}

export async function recoverSession(sessionId: unknown, onProgress: (f: number) => void): Promise<FinalizeResult> {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || active.has(sessionId)) {
    return { ok: false, error: 'Unknown recording.' };
  }
  const { tempPath, metaPath } = pathsFor(sessionId);
  const stat = await fs.promises.stat(tempPath).catch(() => null);
  if (!stat) return { ok: false, error: 'The unfinished recording no longer exists.' };
  const meta = readMeta(metaPath, stat.mtime);
  // A crashed capture may not contain an audio track even if one was requested; the "?" map handles that.
  return produceFinalFile(tempPath, metaPath, meta, 0, onProgress);
}

export async function discardRecoverable(sessionId: unknown): Promise<void> {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || active.has(sessionId)) return;
  const { tempPath, metaPath } = pathsFor(sessionId);
  await fs.promises.rm(tempPath, { force: true });
  await fs.promises.rm(metaPath, { force: true });
}
