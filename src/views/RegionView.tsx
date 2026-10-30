import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Rect } from '../../shared/types';
import { api } from '../api';

const MIN_SIZE = 64;

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Full-screen transparent overlay for dragging out a capture region. Coordinates are display-relative DIPs. */
export function RegionView() {
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const confirm = useCallback(() => {
    if (rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) api.submitRegion(rect);
  }, [rect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.submitRegion(null);
      if (e.key === 'Enter') confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (dragging && origin.current) setRect(normalize(origin.current, { x: e.clientX, y: e.clientY }));
  };
  const onPointerUp = () => {
    setDragging(false);
    origin.current = null;
  };

  const valid = rect !== null && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
  const scale = window.devicePixelRatio || 1;

  return (
    <div
      className="region-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={confirm}
    >
      {rect ? (
        <div className="region-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="region-size">
            {Math.round(rect.width * scale)} × {Math.round(rect.height * scale)}
          </span>
          {!dragging && valid && (
            <div
              className="region-actions"
              style={rect.y + rect.height + 52 > window.innerHeight ? { top: 8, bottom: 'auto' } : undefined}
            >
              <button type="button" className="btn btn-primary btn-sm" onClick={confirm}>
                Record this area
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRect(null)}>
                Redraw
              </button>
              <button type="button" className="btn btn-ghost btn-sm region-cancel" onClick={() => api.submitRegion(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="region-dim" />
      )}
      <div className="region-hint" role="status">
        {valid && !dragging
          ? 'Press Enter or double-click to confirm · Esc to cancel'
          : `Drag to select the area to record (min ${MIN_SIZE}×${MIN_SIZE}) · Esc to cancel`}
      </div>
    </div>
  );
}
