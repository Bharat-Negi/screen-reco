import type { FrameRate, Quality, Rect } from '../../shared/types';
import { api, errorMessage } from '../api';

export interface EngineStartOptions {
  sourceId: string;
  sourceName: string;
  systemAudio: boolean;
  microphone: boolean;
  microphoneDeviceId: string;
  fps: FrameRate;
  quality: Quality;
  /** Custom region: the selected rectangle and the bounds of its display, both in DIPs. */
  region?: { rect: Rect; displayBounds: Rect };
}

export interface EngineCallbacks {
  onWarning(message: string): void;
  /** The capture can no longer continue (source closed, encoder error, disk write failed). */
  onInterrupted(message: string): void;
}

const MIME_CANDIDATES_AV = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const MIME_CANDIDATES_V = ['video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function pickMimeType(withAudio: boolean): string {
  const list = withAudio ? MIME_CANDIDATES_AV : MIME_CANDIDATES_V;
  return list.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
}

/** Intermediate bitrate: generous so the final FFmpeg encode is the only real quality loss. */
function pickBitrate(width: number, height: number, fps: number): number {
  const bps = width * height * fps * 0.12;
  return Math.round(Math.min(40_000_000, Math.max(4_000_000, bps)));
}

function captureErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Screen capture was blocked. Check that ScreenCapture Pro is allowed to capture your screen and try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The selected screen or window could not be captured. It may be minimized, protected (DRM), or in use by another app.';
    case 'NotFoundError':
      return 'The selected screen or window is no longer available.';
    default:
      return errorMessage(err);
  }
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') {
    return 'Microphone access is blocked. Enable it in Windows Settings › Privacy & security › Microphone ("Let desktop apps access your microphone"). Recording continues without the microphone.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'The selected microphone was not found. Recording continues without the microphone.';
  }
  if (name === 'NotReadableError') {
    return 'The microphone is in use by another app or unavailable. Recording continues without the microphone.';
  }
  return `Microphone unavailable (${errorMessage(err)}). Recording continues without it.`;
}

/**
 * Owns the capture streams and MediaRecorder for one recording. Chunks are streamed to the main
 * process every second and appended to a temp file; the main process turns that into an MP4 on stop.
 */
export class RecordingEngine {
  private streams: MediaStream[] = [];
  private audioContext: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private sessionId: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private writeError: string | null = null;
  private interrupted = false;

  async start(opts: EngineStartOptions, cb: EngineCallbacks): Promise<void> {
    try {
      await api.prepareCapture(opts.sourceId, opts.systemAudio);
      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: opts.fps, max: opts.fps } },
          audio: opts.systemAudio,
        });
      } catch (err) {
        throw new Error(captureErrorMessage(err));
      }
      this.streams.push(display);

      const videoTrack = display.getVideoTracks()[0];
      if (!videoTrack) throw new Error('No video was received from the selected source.');
      videoTrack.contentHint = 'detail';

      const audioTracks: MediaStreamTrack[] = [...display.getAudioTracks()];
      if (opts.systemAudio && audioTracks.length === 0) {
        cb.onWarning('System audio could not be captured. Recording continues without it.');
      }

      if (opts.microphone) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: opts.microphoneDeviceId && opts.microphoneDeviceId !== 'default' ? { exact: opts.microphoneDeviceId } : undefined,
              // Echo cancellation would try to remove the system audio we are deliberately recording.
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          this.streams.push(mic);
          audioTracks.push(...mic.getAudioTracks());
        } catch (err) {
          cb.onWarning(micErrorMessage(err));
        }
      }

      // Mix every audio source into a single track so the file has one synchronized audio stream.
      let mixedAudio: MediaStreamTrack | undefined;
      if (audioTracks.length > 0) {
        this.audioContext = new AudioContext({ sampleRate: 48000 });
        const destination = this.audioContext.createMediaStreamDestination();
        for (const track of audioTracks) {
          this.audioContext.createMediaStreamSource(new MediaStream([track])).connect(destination);
        }
        mixedAudio = destination.stream.getAudioTracks()[0];
      }

      const settings = videoTrack.getSettings();
      const width = settings.width ?? 1920;
      const height = settings.height ?? 1080;

      let crop: Rect | undefined;
      if (opts.region) {
        // Region is in DIPs relative to the display; the captured frame is in physical pixels.
        const sx = width / opts.region.displayBounds.width;
        const sy = height / opts.region.displayBounds.height;
        const r = opts.region.rect;
        const x = Math.max(0, Math.round(r.x * sx));
        const y = Math.max(0, Math.round(r.y * sy));
        crop = {
          x,
          y,
          width: Math.min(width - x, Math.round(r.width * sx)),
          height: Math.min(height - y, Math.round(r.height * sy)),
        };
      }

      const mimeType = pickMimeType(Boolean(mixedAudio));
      const { sessionId } = await api.startSession({
        sourceName: opts.sourceName,
        quality: opts.quality,
        fps: opts.fps,
        crop,
        hasAudio: Boolean(mixedAudio),
        mimeType,
      });
      this.sessionId = sessionId;

      const output = new MediaStream(mixedAudio ? [videoTrack, mixedAudio] : [videoTrack]);
      const recorder = new MediaRecorder(output, {
        mimeType,
        videoBitsPerSecond: pickBitrate(width, height, opts.fps),
        audioBitsPerSecond: 192_000,
      });
      this.recorder = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.enqueueChunk(event.data, cb);
      };
      recorder.onerror = (event) => {
        const message = (event as Event & { error?: DOMException }).error?.message ?? 'unknown error';
        this.interrupt(cb, `The recorder stopped unexpectedly (${message}). The footage captured so far will be saved.`);
      };
      videoTrack.addEventListener('ended', () => {
        this.interrupt(cb, 'The captured screen or window was closed. The recording has been stopped and saved.');
      });

      recorder.start(1000);
    } catch (err) {
      await this.dispose();
      if (this.sessionId) await api.abortSession(this.sessionId).catch(() => undefined);
      this.sessionId = null;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private interrupt(cb: EngineCallbacks, message: string): void {
    if (this.interrupted) return;
    this.interrupted = true;
    cb.onInterrupted(message);
  }

  private enqueueChunk(blob: Blob, cb: EngineCallbacks): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    this.writeChain = this.writeChain.then(async () => {
      if (this.writeError) return;
      try {
        await api.writeChunk(sessionId, new Uint8Array(await blob.arrayBuffer()));
      } catch (err) {
        this.writeError = errorMessage(err);
        this.interrupt(cb, `Recording stopped: ${this.writeError}`);
      }
    });
  }

  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }

  /** Stops capture, flushes every pending chunk to disk and returns the session id to finalize. */
  async stop(): Promise<string | null> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    await this.writeChain;
    await this.dispose();
    const id = this.sessionId;
    this.sessionId = null;
    return id;
  }

  /** Releases capture devices: stops all tracks so Windows removes its capture indicators. */
  private async dispose(): Promise<void> {
    for (const stream of this.streams) stream.getTracks().forEach((t) => t.stop());
    this.streams = [];
    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.recorder = null;
  }
}
