import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
let logFile: string | null = null;

export function getLogDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function resolveLogFile(): string {
  if (logFile) return logFile;
  const dir = getLogDir();
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'main.log');
  try {
    if (fs.statSync(logFile).size > MAX_LOG_BYTES) fs.renameSync(logFile, path.join(dir, 'main.old.log'));
  } catch {
    // No existing log yet.
  }
  return logFile;
}

function format(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args.map(format).join(' ')}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  try {
    fs.appendFileSync(resolveLogFile(), `${line}\n`);
  } catch {
    // Logging must never crash the app.
  }
}

export const log = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
};
