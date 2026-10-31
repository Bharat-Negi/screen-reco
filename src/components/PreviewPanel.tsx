import { useEffect, useState } from 'react';
import type { Rect, SourceKind } from '../../shared/types';
import { api } from '../api';
import { MonitorsIcon, RegionIcon, ScreenIcon, WindowIcon } from './icons';
import type { SelectionSummary } from './SourceSelector';

const REFRESH_MS = 3000;

interface Props {
  kind: SourceKind;
  summary: SelectionSummary;
  /** Screen/window to preview; undefined when nothing is selected yet. */
  sourceId?: string;
  /** Custom region, drawn on top of the display preview. */
  region?: { rect: Rect; displayBounds: Rect };
  recording: boolean;
  disabled: boolean;
  onChoose(): void;
}

const KIND_ICON = { screen: ScreenIcon, window: WindowIcon, monitor: MonitorsIcon, region: RegionIcon };

/** Large still preview of what will be recorded, refreshed every few seconds while idle. */
export function PreviewPanel({ kind, summary, sourceId, region, recording, disabled, onChoose }: Props) {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    setImage(null);
    if (!sourceId) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .getSourceThumbnail(sourceId)
        .then((img) => {
          if (!cancelled && img) setImage(img);
        })
        .catch(() => undefined);
    };
    load();
    // No refreshing while recording: the window is usually minimized, and capture work should go to the recording.
    const id = recording ? undefined : window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      if (id) window.clearInterval(id);
    };
  }, [sourceId, recording]);

  const KindIcon = KIND_ICON[kind];

  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-stage">
        {image ? (
          <div className="preview-media">
            <img src={image} alt={`Preview of ${summary.title}`} draggable={false} />
            {region && (
              <>
                <div
                  className="preview-region"
                  style={{
                    left: `${(region.rect.x / region.displayBounds.width) * 100}%`,
                    top: `${(region.rect.y / region.displayBounds.height) * 100}%`,
                    width: `${(region.rect.width / region.displayBounds.width) * 100}%`,
                    height: `${(region.rect.height / region.displayBounds.height) * 100}%`,
                  }}
                />
              </>
            )}
          </div>
        ) : (
          <div className="preview-empty">
            <span className="preview-empty-icon">
              <KindIcon size={30} />
            </span>
            <p>{summary.needsChoice ? summary.title : 'Loading preview…'}</p>
            {summary.needsChoice && (
              <>
                <span>{summary.detail}</span>
                <button type="button" className="btn btn-primary" onClick={onChoose} disabled={disabled}>
                  {kind === 'window' ? 'Choose window' : kind === 'monitor' ? 'Choose monitor' : 'Select area'}
                </button>
              </>
            )}
          </div>
        )}

        <span className={`preview-chip ${recording ? 'is-rec' : ''}`}>
          <span className="preview-chip-dot" aria-hidden="true" />
          {recording ? 'Recording' : 'Live preview'}
        </span>
      </div>

      <div className="preview-footer">
        <span className="preview-footer-icon" aria-hidden="true">
          {summary.icon ? <img src={summary.icon} alt="" /> : <KindIcon size={18} />}
        </span>
        <div className="preview-footer-text">
          <span className="preview-footer-title" title={summary.title}>
            {summary.title}
          </span>
          {summary.detail && <span className="preview-footer-detail">{summary.detail}</span>}
        </div>
        {kind !== 'screen' && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onChoose} disabled={disabled}>
            {summary.needsChoice ? 'Choose…' : kind === 'region' ? 'Reselect area…' : 'Change…'}
          </button>
        )}
      </div>
    </section>
  );
}
