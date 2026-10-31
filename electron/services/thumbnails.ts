import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RecordingEntry } from '../../shared/types';
import { resolveFfmpeg } from './ffmpeg';
import { log } from './logger';
import { getSettings } from './settings';

const ID = /^[0-9a-f-]{36}$/;
let backfillRunning = false;

function thumbDir(): string {
  return path.join(app.getPath('userData'), 'thumbnails');
}

export function thumbnailPath(id: string): string | null {
  return ID.test(id) ? path.join(thumbDir(), `${id}.jpg`) : null;
}

export function readThumbnail(id: string): string | undefined {
  const file = thumbnailPath(id);
  if (!file) return undefined;
  try {
    return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return undefined;
  }
}

export function deleteThumbnail(id: string): void {
  const file = thumbnailPath(id);
  if (file) fs.rmSync(file, { force: true });
}

/** Grabs one frame (1s in, or the middle of very short clips) as a small JPEG. Failures are logged, never thrown. */
export async function createThumbnail(entry: Pick<RecordingEntry, 'id' | 'filePath' | 'durationMs'>): Promise<boolean> {
  const out = thumbnailPath(entry.id);
  const ffmpeg = await resolveFfmpeg(getSettings().ffmpegPath);
  if (!out || !ffmpeg.available || !ffmpeg.path) return false;
  await fs.promises.mkdir(thumbDir(), { recursive: true });
  const at = Math.max(0, Math.min(1, entry.durationMs / 2000));
  const args = ['-hide_banner', '-nostdin', '-y', '-ss', at.toFixed(2), '-i', entry.filePath, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', out];
  return new Promise((resolve) => {
    const child = spawn(ffmpeg.path!, args, { windowsHide: true });
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) log.warn(`Thumbnail failed for ${entry.filePath} (exit ${code})`);
      resolve(code === 0 && fs.existsSync(out));
    });
  });
}

/** Generates missing thumbnails (e.g. recordings made before thumbnails existed) one at a time in the background. */
export async function backfillThumbnails(entries: RecordingEntry[], onUpdated: () => void): Promise<void> {
  if (backfillRunning) return;
  const missing = entries.filter((e) => e.exists && !e.thumbnail && e.format === 'mp4');
  if (missing.length === 0) return;
  backfillRunning = true;
  try {
    let made = 0;
    for (const entry of missing) {
      if (await createThumbnail(entry)) made++;
      if (made > 0 && made % 6 === 0) onUpdated();
    }
    if (made % 6 !== 0) onUpdated();
  } finally {
    backfillRunning = false;
  }
}
