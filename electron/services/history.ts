import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { RecordingEntry } from '../../shared/types';
import { log } from './logger';
import { readJson, writeJson } from './store';
import { deleteThumbnail, readThumbnail } from './thumbnails';

const MAX_ENTRIES = 500;

function historyFile(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

function load(): RecordingEntry[] {
  const data = readJson<unknown>(historyFile(), []);
  return Array.isArray(data) ? (data as RecordingEntry[]) : [];
}

export function listHistory(): RecordingEntry[] {
  return load().map((entry) => {
    try {
      const stat = fs.statSync(entry.filePath);
      return { ...entry, exists: true, sizeBytes: stat.size, thumbnail: readThumbnail(entry.id) };
    } catch {
      return { ...entry, exists: false };
    }
  });
}

export function addHistory(entry: RecordingEntry): void {
  const entries = [entry, ...load()].slice(0, MAX_ENTRIES);
  writeJson(historyFile(), entries);
}

/** Looks an entry up by id. File operations only ever use paths that came from our own history. */
export function getHistoryEntry(id: unknown): RecordingEntry | undefined {
  if (typeof id !== 'string') return undefined;
  return load().find((e) => e.id === id);
}

export async function removeHistory(id: unknown, deleteFile: boolean): Promise<RecordingEntry[]> {
  const entry = getHistoryEntry(id);
  if (entry && deleteFile && fs.existsSync(entry.filePath)) {
    try {
      await shell.trashItem(entry.filePath);
    } catch (err) {
      log.error('Failed to move recording to Recycle Bin', err);
      throw new Error('Could not move the file to the Recycle Bin.');
    }
  }
  writeJson(
    historyFile(),
    load().filter((e) => e.id !== id),
  );
  if (entry) deleteThumbnail(entry.id);
  return listHistory();
}
