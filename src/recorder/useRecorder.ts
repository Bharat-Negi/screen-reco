import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinalizeResult, RecorderCommand, RecorderState } from '../../shared/types';
import { api, errorMessage } from '../api';
import type { NotifyFn } from '../components/Toasts';
import { RecordingEngine, type EngineStartOptions } from './engine';

const TICK_MS = 250;
const DISK_CHECK_MS = 15_000;

interface UseRecorderOptions {
  /** Validates the current selection and returns capture options. Throws with a user-facing message. */
  resolveStart(): Promise<EngineStartOptions>;
  notify: NotifyFn;
  onFinished(result: FinalizeResult): void;
}

export function useRecorder({ resolveStart, notify, onFinished }: UseRecorderOptions) {
  const [state, setState] = useState<RecorderState>({ status: 'idle', elapsedMs: 0 });
  const stateRef = useRef(state);
  const engineRef = useRef<RecordingEngine | null>(null);
  // Elapsed time excludes paused periods: accumulated time + the current running segment.
  const timing = useRef({ accumulated: 0, segmentStart: 0 });

  const update = useCallback((patch: Partial<RecorderState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
    api.publishState(next);
  }, []);

  const elapsed = useCallback(() => {
    const t = timing.current;
    return t.accumulated + (stateRef.current.status === 'recording' ? performance.now() - t.segmentStart : 0);
  }, []);

  // A stop requested while capture is still starting is honoured as soon as recording begins.
  const pendingStop = useRef(false);

  const stop = useCallback(async () => {
    const status = stateRef.current.status;
    if (status === 'starting') {
      pendingStop.current = true;
      return;
    }
    if (status !== 'recording' && status !== 'paused') return;
    const durationMs = elapsed();
    update({ status: 'stopping', elapsedMs: durationMs });

    const engine = engineRef.current;
    engineRef.current = null;
    let sessionId: string | null = null;
    try {
      sessionId = (await engine?.stop()) ?? null;
    } catch (err) {
      notify('error', `Could not stop the recorder cleanly: ${errorMessage(err)}`);
    }
    if (!sessionId) {
      update({ status: 'idle', elapsedMs: 0, finalizeProgress: undefined });
      return;
    }

    update({ status: 'finalizing', finalizeProgress: 0 });
    try {
      onFinished(await api.finalizeSession(sessionId, durationMs));
    } catch (err) {
      notify('error', `Saving failed: ${errorMessage(err)}`);
    } finally {
      update({ status: 'idle', elapsedMs: 0, finalizeProgress: undefined });
    }
  }, [elapsed, notify, onFinished, update]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (stateRef.current.status !== 'idle') return;
    pendingStop.current = false;
    update({ status: 'starting', elapsedMs: 0, finalizeProgress: undefined });
    const engine = new RecordingEngine();
    try {
      const options = await resolveStart();
      engineRef.current = engine;
      await engine.start(options, {
        onWarning: (message) => notify('warning', message),
        onInterrupted: (message) => {
          notify('warning', message);
          void stopRef.current();
        },
      });
      timing.current = { accumulated: 0, segmentStart: performance.now() };
      update({ status: 'recording', elapsedMs: 0, sourceName: options.sourceName });
      if (pendingStop.current) {
        pendingStop.current = false;
        void stopRef.current();
      }
    } catch (err) {
      pendingStop.current = false;
      engineRef.current = null;
      update({ status: 'idle', elapsedMs: 0 });
      notify('error', errorMessage(err));
    }
  }, [notify, resolveStart, update]);

  const pause = useCallback(() => {
    if (stateRef.current.status !== 'recording') return;
    engineRef.current?.pause();
    timing.current.accumulated += performance.now() - timing.current.segmentStart;
    update({ status: 'paused', elapsedMs: timing.current.accumulated });
  }, [update]);

  const resume = useCallback(() => {
    if (stateRef.current.status !== 'paused') return;
    engineRef.current?.resume();
    timing.current.segmentStart = performance.now();
    update({ status: 'recording' });
  }, [update]);

  const togglePause = useCallback(() => {
    if (stateRef.current.status === 'recording') pause();
    else if (stateRef.current.status === 'paused') resume();
  }, [pause, resume]);

  // Live timer.
  useEffect(() => {
    if (state.status !== 'recording') return;
    const id = window.setInterval(() => update({ elapsedMs: elapsed() }), TICK_MS);
    return () => window.clearInterval(id);
  }, [state.status, elapsed, update]);

  // Stop safely before the disk fills up.
  useEffect(() => {
    if (state.status !== 'recording' && state.status !== 'paused') return;
    const id = window.setInterval(async () => {
      try {
        const disk = await api.checkDisk();
        if (disk.level === 'critical') {
          notify('error', 'Disk space is almost full. The recording was stopped and saved.');
          void stopRef.current();
        }
      } catch {
        // A failed check must not interrupt recording.
      }
    }, DISK_CHECK_MS);
    return () => window.clearInterval(id);
  }, [state.status, notify]);

  useEffect(
    () =>
      api.onFinalizeProgress((progress) => {
        if (stateRef.current.status === 'finalizing') update({ finalizeProgress: progress });
      }),
    [update],
  );

  // Commands from the floating toolbar, global shortcuts, and app shutdown.
  const actions = useRef<Record<RecorderCommand, () => void>>({} as Record<RecorderCommand, () => void>);
  actions.current = {
    start: () => void start(),
    stop: () => void stop(),
    pause,
    resume,
    'toggle-pause': togglePause,
  };
  useEffect(() => api.onCommand((command) => actions.current[command]?.()), []);

  return { state, start, stop, pause, resume, togglePause };
}
