import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '../../shared/types';
import { readJson, writeJson } from './store';

const QUALITIES = ['720p', '1080p', 'native'] as const;
const THEMES = ['system', 'light', 'dark'] as const;
const SOURCE_KINDS = ['screen', 'window', 'monitor', 'region'] as const;

let cache: AppSettings | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function defaultOutputFolder(): string {
  return path.join(app.getPath('videos'), 'ScreenCapture Pro');
}

function defaults(): AppSettings {
  return {
    outputFolder: defaultOutputFolder(),
    theme: 'system',
    quality: '1080p',
    fps: 30,
    sourceKind: 'screen',
    systemAudio: true,
    microphone: false,
    microphoneDeviceId: 'default',
    hideAppFromCapture: true,
    minimizeOnRecord: true,
    globalShortcuts: true,
    showNotifications: true,
    ffmpegPath: '',
  };
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function isUsableFolder(folder: unknown): folder is string {
  return typeof folder === 'string' && folder.length < 1024 && path.isAbsolute(folder) && !folder.includes('\0');
}

export function isUsableFfmpegPath(file: unknown): file is string {
  if (file === '') return true;
  return (
    typeof file === 'string' &&
    path.isAbsolute(file) &&
    path.extname(file).toLowerCase() === '.exe' &&
    fs.existsSync(file)
  );
}

/** Copies only valid, known keys from `patch` onto `base`. Unknown or invalid values are ignored. */
function sanitize(base: AppSettings, patch: Record<string, unknown>): AppSettings {
  const next = { ...base };
  if (isUsableFolder(patch.outputFolder)) next.outputFolder = patch.outputFolder;
  if (isOneOf(THEMES, patch.theme)) next.theme = patch.theme;
  if (isOneOf(QUALITIES, patch.quality)) next.quality = patch.quality;
  if (patch.fps === 30 || patch.fps === 60) next.fps = patch.fps;
  if (isOneOf(SOURCE_KINDS, patch.sourceKind)) next.sourceKind = patch.sourceKind;
  if (typeof patch.microphoneDeviceId === 'string' && patch.microphoneDeviceId.length < 512) {
    next.microphoneDeviceId = patch.microphoneDeviceId;
  }
  if (isUsableFfmpegPath(patch.ffmpegPath)) next.ffmpegPath = patch.ffmpegPath;
  for (const key of [
    'systemAudio',
    'microphone',
    'hideAppFromCapture',
    'minimizeOnRecord',
    'globalShortcuts',
    'showNotifications',
  ] as const) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key] as boolean;
  }
  return next;
}

export function getSettings(): AppSettings {
  if (!cache) {
    const stored = readJson<Record<string, unknown>>(settingsFile(), {});
    cache = sanitize(defaults(), stored && typeof stored === 'object' ? stored : {});
  }
  return cache;
}

export function updateSettings(patch: unknown): AppSettings {
  const safePatch = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {};
  cache = sanitize(getSettings(), safePatch);
  writeJson(settingsFile(), cache);
  return cache;
}
