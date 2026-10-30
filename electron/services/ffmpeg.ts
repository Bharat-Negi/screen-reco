import { spawn } from 'node:child_process';
import path from 'node:path';
import type { FfmpegStatus, SessionMeta } from '../../shared/types';
import { log } from './logger';

let cached: { key: string; status: FfmpegStatus } | null = null;

/** Path of the binary shipped by the `ffmpeg-static` package, adjusted for the unpacked asar location. */
function bundledFfmpegPath(): string | null {
  try {
    const p = require('ffmpeg-static') as string | null;
    return p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : null;
  } catch {
    return null;
  }
}

function probe(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const child = spawn(binary, ['-hide_banner', '-version'], { windowsHide: true });
      const timer = setTimeout(() => {
        child.kill();
        done(null);
      }, 8000);
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.on('error', () => {
        clearTimeout(timer);
        done(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const match = /ffmpeg version (\S+)/.exec(out);
        done(code === 0 && match ? match[1] : null);
      });
    } catch {
      done(null);
    }
  });
}

/** Finds a working FFmpeg: custom path from settings, then the bundled binary, then PATH. */
export async function resolveFfmpeg(customPath: string, force = false): Promise<FfmpegStatus> {
  const key = customPath || '<auto>';
  if (!force && cached?.key === key && cached.status.available) return cached.status;

  const candidates: Array<{ path: string; source: FfmpegStatus['source'] }> = [];
  if (customPath) candidates.push({ path: customPath, source: 'custom' });
  const bundled = bundledFfmpegPath();
  if (bundled) candidates.push({ path: bundled, source: 'bundled' });
  candidates.push({ path: 'ffmpeg', source: 'system' });

  for (const c of candidates) {
    const version = await probe(c.path);
    if (version) {
      const status: FfmpegStatus = { available: true, path: c.path, version, source: c.source };
      cached = { key, status };
      log.info(`Using FFmpeg ${version} (${c.source}) at ${c.path}`);
      return status;
    }
  }
  const status: FfmpegStatus = {
    available: false,
    error: 'FFmpeg was not found. Recordings will be saved as WebM/MKV until FFmpeg is installed or configured in Settings.',
  };
  cached = { key, status };
  log.warn('FFmpeg not available; tried', candidates.map((c) => c.path));
  return status;
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

export function buildTranscodeArgs(input: string, output: string, meta: SessionMeta): string[] {
  const filters: string[] = [];
  if (meta.crop) {
    const { x, y, width, height } = meta.crop;
    filters.push(`crop=${even(width)}:${even(height)}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))}`);
  }
  // Never upscale: cap the height at the chosen preset, keep the aspect ratio, keep dimensions even for H.264.
  if (meta.quality === '720p') filters.push("scale=-2:'min(720,trunc(ih/2)*2)':flags=lanczos");
  else if (meta.quality === '1080p') filters.push("scale=-2:'min(1080,trunc(ih/2)*2)':flags=lanczos");
  else filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  // Constant frame rate output; MediaRecorder produces variable frame timing.
  filters.push(`fps=${meta.fps}`, 'format=yuv420p');

  const args = [
    '-hide_banner',
    '-nostdin',
    '-n', // never overwrite an existing file
    '-fflags',
    '+genpts',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    meta.quality === '720p' ? '23' : '21',
  ];
  if (meta.hasAudio) {
    // aresample=async keeps audio locked to video timestamps (fixes drift and gaps).
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-af', 'aresample=async=1:first_pts=0');
  }
  args.push('-movflags', '+faststart', output);
  return args;
}

function parseTime(text: string): number | null {
  const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  return (Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])) * 1000;
}

/** Runs FFmpeg and resolves with the encoded duration (ms). Rejects with the tail of FFmpeg's log on failure. */
export function transcode(
  ffmpegPath: string,
  args: string[],
  expectedDurationMs: number,
  onProgress: (fraction: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    log.info('ffmpeg', args.join(' '));
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let tail = '';
    let lastTimeMs = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-6000);
      const t = parseTime(text);
      if (t !== null) {
        lastTimeMs = t;
        if (expectedDurationMs > 0) onProgress(Math.min(0.99, t / expectedDurationMs));
      }
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        onProgress(1);
        resolve(lastTimeMs);
      } else {
        log.error(`ffmpeg exited with code ${code}\n${tail}`);
        const reason = tail.trim().split(/\r?\n/).slice(-2).join(' ');
        reject(new Error(`FFmpeg failed (exit code ${code}). ${reason}`));
      }
    });
  });
}
