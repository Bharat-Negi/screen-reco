import type { ScpApi } from '../shared/types';

declare global {
  interface Window {
    scp: ScpApi;
  }
}

export const api: ScpApi = window.scp;

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}
