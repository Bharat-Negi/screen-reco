import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { CAMERA_MAX_DIAMETER, CAMERA_MIN_DIAMETER, type AppSettings } from '../../shared/types';
import { api, errorMessage } from '../api';
import { CameraOffIcon } from '../components/icons';

const BUTTON_STEP = 40;
const WHEEL_STEP = 20;
const PERSIST_DELAY_MS = 400;

const clamp = (d: number) => Math.round(Math.min(CAMERA_MAX_DIAMETER, Math.max(CAMERA_MIN_DIAMETER, d)));

function cameraErrorMessage(err: unknown): { short: string; full: string } {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') {
    return {
      short: 'Camera blocked',
      full: 'Camera access is blocked. Enable it in Windows Settings › Privacy & security › Camera ("Let desktop apps access your camera").',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { short: 'No camera found', full: 'The selected camera was not found. Connect a camera or choose another one in the Camera card.' };
  }
  if (name === 'NotReadableError') {
    return { short: 'Camera in use', full: 'The camera is being used by another app (for example Teams or Zoom). Close it and toggle the camera off and on.' };
  }
  return { short: 'Camera unavailable', full: `The camera could not be started (${errorMessage(err)}).` };
}

/**
 * Round webcam bubble, captured as part of the screen recording.
 * Drag to move, scroll or drag the corner handle to resize, or use the −/+ buttons shown on hover.
 */
export function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<'move' | 'resize' | null>(null);

  // Pointer gestures work in screen coordinates so the window can move under the cursor.
  const start = useRef({ screenX: 0, screenY: 0, winX: 0, winY: 0, diameter: 0 });
  const frame = useRef<number | null>(null);
  const persistTimer = useRef<number | null>(null);
  // The size we asked for. Never derived from window.innerWidth, which lags and is rounded by display scaling.
  const diameter = useRef(220);
  const gestureRef = useRef<'move' | 'resize' | null>(null);

  useEffect(() => {
    const apply = (s: AppSettings) => {
      setSettings(s);
      if (!gestureRef.current && persistTimer.current === null) diameter.current = s.cameraDiameter;
    };
    api.getSettings().then(apply);
    return api.onSettings(apply);
  }, []);

  const deviceId = settings?.cameraDeviceId;

  useEffect(() => {
    if (deviceId === undefined) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        s.getVideoTracks()[0]?.addEventListener('ended', () => {
          setError('Camera disconnected');
          api.reportCameraError('The camera was disconnected.');
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = cameraErrorMessage(err);
        setError(msg.short);
        api.reportCameraError(msg.full);
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  const applySize = (next: number, anchor: 'top-left' | 'center') => {
    diameter.current = clamp(next);
    api.resizeCamera(diameter.current, anchor);
  };

  /** Saves the bubble size once the user has finished resizing. */
  const persistSize = (delay = PERSIST_DELAY_MS) => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      void api.updateSettings({ cameraDiameter: diameter.current });
    }, delay);
  };

  /** Coalesces pointer moves into one IPC call per animation frame. */
  const schedule = (fn: () => void) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      fn();
    });
  };

  const beginGesture = (e: PointerEvent, kind: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = {
      screenX: e.screenX,
      screenY: e.screenY,
      winX: window.screenX,
      winY: window.screenY,
      diameter: diameter.current,
    };
    gestureRef.current = kind;
    setGesture(kind);
  };

  const endGesture = () => {
    const kind = gestureRef.current;
    if (!kind) return;
    gestureRef.current = null;
    setGesture(null);
    if (kind === 'resize') persistSize(150);
  };

  const onPointerMove = (e: PointerEvent) => {
    const kind = gestureRef.current;
    if (!kind) return;
    // The button-up can be lost while the window moves under the cursor; never keep following it.
    if ((e.buttons & 1) === 0) {
      endGesture();
      return;
    }
    const s = start.current;
    const dx = e.screenX - s.screenX;
    const dy = e.screenY - s.screenY;
    if (kind === 'move') {
      schedule(() => api.moveCamera(s.winX + dx, s.winY + dy));
    } else {
      // Dragging the bottom-right handle: grow by whichever direction moved further.
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      schedule(() => applySize(s.diameter + delta, 'top-left'));
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (gestureRef.current || e.deltaY === 0) return;
    applySize(diameter.current + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP), 'center');
    persistSize();
  };

  const step = (direction: 1 | -1) => {
    applySize(diameter.current + direction * BUTTON_STEP, 'center');
    persistSize(0);
  };

  return (
    <div
      className={`camera-root ${gesture ? `is-${gesture}` : ''}`}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      onWheel={onWheel}
    >
      <div
        className="camera-bubble"
        title="Drag to move · Scroll to resize"
        onPointerDown={(e) => beginGesture(e, 'move')}
      >
        <video ref={videoRef} autoPlay muted playsInline className={settings?.cameraMirror ? 'is-mirrored' : ''} />
        {error && (
          <div className="camera-error" role="alert">
            <CameraOffIcon size={28} />
            <span>{error}</span>
          </div>
        )}
        <div className="camera-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => step(-1)} aria-label="Make camera smaller" title="Smaller">
            −
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Make camera bigger" title="Bigger">
            +
          </button>
        </div>
      </div>
      <div
        className="camera-grip"
        title="Drag to resize"
        aria-label="Resize camera"
        role="separator"
        onPointerDown={(e) => beginGesture(e, 'resize')}
      />
    </div>
  );
}
