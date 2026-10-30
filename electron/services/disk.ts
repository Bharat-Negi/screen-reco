import fs from 'node:fs';
import type { DiskStatus } from '../../shared/types';

const MB = 1024 * 1024;
/** Below this we refuse to start, and stop an active recording. */
export const CRITICAL_BYTES = 500 * MB;
/** Below this we warn but allow recording. */
export const LOW_BYTES = 2048 * MB;

export async function checkDisk(dir: string): Promise<DiskStatus> {
  await fs.promises.mkdir(dir, { recursive: true });
  const stats = await fs.promises.statfs(dir);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const level = freeBytes < CRITICAL_BYTES ? 'critical' : freeBytes < LOW_BYTES ? 'low' : 'ok';
  return { path: dir, freeBytes, level };
}

/** Recording needs space for both the temporary capture and the final MP4, so report the worse of the two. */
export async function checkRecordingDisks(outputDir: string, tempDir: string): Promise<DiskStatus> {
  const [out, tmp] = await Promise.all([checkDisk(outputDir), checkDisk(tempDir)]);
  return out.freeBytes <= tmp.freeBytes ? out : tmp;
}
