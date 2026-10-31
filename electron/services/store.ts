import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger';

/** Reads a JSON file, returning `fallback` when it is missing or corrupt. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    // Tolerate a UTF-8 byte-order mark (added by Notepad and some editors when a file is edited by hand).
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${file}`, err);
    return fallback;
  }
}

/** Atomic write: write to a temp file, then rename over the target. */
export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
