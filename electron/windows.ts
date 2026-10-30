import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Rect } from '../shared/types';
import { log } from './services/logger';

const DEV_URL = process.env.VITE_DEV_SERVER_URL?.replace(/\/$/, '');
const INDEX_HTML = path.join(__dirname, '../../dist/renderer/index.html');
const PRELOAD = path.join(__dirname, 'preload.js');
const ICON = path.join(app.getAppPath(), 'build', 'icon.png');

const TOOLBAR_SIZE = { width: 340, height: 56 };
const TOOLBAR_COMPACT = { width: 150, height: 44 };

export type Route = 'main' | 'toolbar' | 'region';

let mainWindow: BrowserWindow | null = null;
let toolbarWindow: BrowserWindow | null = null;
let regionWindow: BrowserWindow | null = null;
let regionResolver: ((rect: Rect | null) => void) | null = null;

/** Only our own bundled pages (or the Vite dev server in development) may call IPC or navigate. */
export function isTrustedUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (DEV_URL) return url === DEV_URL || url.startsWith(`${DEV_URL}/`);
  const bare = url.split('#')[0].split('?')[0];
  return bare.toLowerCase() === pathToFileURL(INDEX_HTML).href.toLowerCase();
}

function secureWebPreferences(extra: Electron.WebPreferences = {}): Electron.WebPreferences {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    ...extra,
  };
}

function harden(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function load(win: BrowserWindow, route: Route): void {
  const promise = DEV_URL ? win.loadURL(`${DEV_URL}/#${route}`) : win.loadFile(INDEX_HTML, { hash: route });
  promise.catch((err) => log.error(`Failed to load ${route} window`, err));
}

export function titleBarColors(): Electron.TitleBarOverlay {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#202024' : '#f3f3f5', symbolColor: dark ? '#f2f2f2' : '#1a1a1a', height: 44 };
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function getToolbarWindow(): BrowserWindow | null {
  return toolbarWindow && !toolbarWindow.isDestroyed() ? toolbarWindow : null;
}

export function createMainWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 660,
    show: false,
    title: 'ScreenCapture Pro',
    icon: ICON,
    backgroundColor: dark ? '#202024' : '#f3f3f5',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(),
    webPreferences: secureWebPreferences({
      // Keep the timer and MediaRecorder running while minimized.
      backgroundThrottling: false,
    }),
  });
  harden(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  load(mainWindow, 'main');
  return mainWindow;
}

export function showToolbar(hideFromCapture: boolean): void {
  if (getToolbarWindow()) {
    toolbarWindow!.setContentProtection(hideFromCapture);
    toolbarWindow!.showInactive();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  toolbarWindow = new BrowserWindow({
    ...TOOLBAR_SIZE,
    x: Math.round(area.x + (area.width - TOOLBAR_SIZE.width) / 2),
    y: area.y + 16,
    frame: false,
    // Opaque window; Windows 11 rounds the corners of frameless windows itself.
    transparent: false,
    backgroundColor: '#1c1c20',
    roundedCorners: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    focusable: true,
    title: 'ScreenCapture Pro — Recording',
    icon: ICON,
    webPreferences: secureWebPreferences(),
  });
  harden(toolbarWindow);
  toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
  toolbarWindow.setVisibleOnAllWorkspaces(true);
  // Exclude the toolbar from the captured video (Windows 10 2004+; older builds show it black).
  toolbarWindow.setContentProtection(hideFromCapture);
  // Display affinity can be reset when a window is (re)shown, so apply it again after every show.
  toolbarWindow.on('show', () => toolbarWindow?.setContentProtection(hideFromCapture));
  toolbarWindow.once('ready-to-show', () => toolbarWindow?.showInactive());
  toolbarWindow.on('closed', () => {
    toolbarWindow = null;
  });
  load(toolbarWindow, 'toolbar');
}

export function hideToolbar(): void {
  const win = getToolbarWindow();
  if (win) win.close();
}

export function setToolbarCompact(compact: boolean): void {
  const win = getToolbarWindow();
  if (!win) return;
  const size = compact ? TOOLBAR_COMPACT : TOOLBAR_SIZE;
  const [x, y] = win.getPosition();
  const [w] = win.getSize();
  // Keep the toolbar's centre where the user left it.
  win.setBounds({ x: Math.round(x + (w - size.width) / 2), y, ...size });
}

/** Opens a transparent overlay on a display and lets the user drag a rectangle. Resolves in display-relative DIPs. */
export function selectRegion(displayId: string): Promise<Rect | null> {
  const display = screen.getAllDisplays().find((d) => String(d.id) === displayId);
  if (!display) return Promise.resolve(null);
  if (regionResolver) submitRegion(null);

  const main = getMainWindow();
  const wasVisible = main?.isVisible() && !main.isMinimized();
  main?.minimize();

  const bounds: Rectangle = display.bounds;
  regionWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: secureWebPreferences(),
  });
  harden(regionWindow);
  regionWindow.setAlwaysOnTop(true, 'screen-saver');
  // Re-apply bounds after creation: Windows may adjust them for per-monitor DPI.
  regionWindow.setBounds(bounds);
  regionWindow.once('ready-to-show', () => {
    regionWindow?.show();
    regionWindow?.focus();
  });
  load(regionWindow, 'region');

  return new Promise((resolve) => {
    regionResolver = (rect) => {
      regionResolver = null;
      const win = regionWindow;
      regionWindow = null;
      if (win && !win.isDestroyed()) win.close();
      if (wasVisible) {
        main?.restore();
        main?.focus();
      }
      resolve(rect);
    };
    regionWindow!.on('closed', () => regionResolver?.(null));
  });
}

export function submitRegion(rect: unknown): void {
  if (!regionResolver) return;
  const r = rect as Rect | null;
  const valid =
    r && [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n)) && r.width >= 16 && r.height >= 16;
  regionResolver(valid ? { x: r.x, y: r.y, width: r.width, height: r.height } : null);
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of [getMainWindow(), getToolbarWindow()]) {
    if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args);
  }
}
