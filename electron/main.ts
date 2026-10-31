import { app, BrowserWindow, dialog, globalShortcut, nativeTheme, session } from 'electron';
import type { AppNotice, AppSettings, RecorderCommand, RecorderState } from '../shared/types';
import { runCameraSelfTest } from './cameraSelfTest';
import { registerIpc } from './ipc';
import { log } from './services/logger';
import { closeAllSessions, hasActiveSessions } from './services/sessions';
import { getSettings } from './services/settings';
import {
  createMainWindow,
  getCameraWindow,
  getMainWindow,
  getToolbarWindow,
  hideCamera,
  hideToolbar,
  isTrustedUrl,
  showCamera,
  showToolbar,
  titleBarColors,
} from './windows';

const SHORTCUTS: Array<{ accelerator: string; command: RecorderCommand }> = [
  { accelerator: 'CommandOrControl+Shift+R', command: 'start' },
  { accelerator: 'CommandOrControl+Shift+P', command: 'toggle-pause' },
  { accelerator: 'CommandOrControl+Shift+S', command: 'stop' },
];

let recorderState: RecorderState = { status: 'idle', elapsedMs: 0 };
let pendingCapture: { id: string; name: string; systemAudio: boolean } | null = null;
let shortcutStatus = { global: false, failed: [] as string[] };
let minimizedByUs = false;
let quitRequested = false;
let allowQuit = false;

// Optional isolated profile (used by the self-test and for troubleshooting).
if (process.env.SCP_USER_DATA) app.setPath('userData', process.env.SCP_USER_DATA);

process.on('uncaughtException', (err) => log.error('Uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err));

function isRecorderBusy(): boolean {
  return recorderState.status !== 'idle' || hasActiveSessions();
}

function sendCommand(command: RecorderCommand): void {
  getMainWindow()?.webContents.send('recorder:command', command);
}

function sendNotice(notice: AppNotice): void {
  getMainWindow()?.webContents.send('app:notice', notice);
}

/** Reacts to recorder status changes coming from the renderer: toolbar, window visibility, capture exclusion. */
function onRecorderState(next: RecorderState): void {
  const prev = recorderState.status;
  recorderState = next;
  const settings = getSettings();
  const main = getMainWindow();

  if (prev === 'idle' && next.status !== 'idle') {
    // Protect before the first frame is captured.
    main?.setContentProtection(settings.hideAppFromCapture);
  }
  if (prev === 'starting' && next.status === 'recording') {
    showToolbar(settings.hideAppFromCapture);
    if (settings.minimizeOnRecord && main && !main.isMinimized()) {
      main.minimize();
      minimizedByUs = true;
    }
  }
  if (next.status === 'idle' && prev !== 'idle') {
    hideToolbar();
    main?.setContentProtection(false);
    if (minimizedByUs && main) {
      main.restore();
      main.focus();
    }
    minimizedByUs = false;
    if (quitRequested || process.env.SCP_SELFTEST === '1') {
      allowQuit = true;
      setTimeout(() => app.quit(), 500);
    }
  }
  getToolbarWindow()?.webContents.send('recorder:state', next);
  selfTestOnState?.(next);
}

function applyShortcuts(settings: AppSettings): void {
  globalShortcut.unregisterAll();
  shortcutStatus = { global: settings.globalShortcuts, failed: [] };
  if (!settings.globalShortcuts) return;
  for (const { accelerator, command } of SHORTCUTS) {
    const ok = globalShortcut.register(accelerator, () => sendCommand(command));
    if (!ok) {
      shortcutStatus.failed.push(accelerator.replace('CommandOrControl', 'Ctrl'));
      log.warn(`Global shortcut ${accelerator} is in use by another application`);
    }
  }
}

function applyTheme(settings: AppSettings): void {
  nativeTheme.themeSource = settings.theme;
}

function applyCamera(settings: AppSettings): void {
  if (settings.camera) showCamera(settings.cameraDiameter);
  else hideCamera();
}

function onSettingsChanged(settings: AppSettings): void {
  applyTheme(settings);
  applyShortcuts(settings);
  applyCamera(settings);
  getMainWindow()?.webContents.send('settings:changed', settings);
  getCameraWindow()?.webContents.send('settings:changed', settings);
}

function configureSession(): void {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed.has(permission) && isTrustedUrl(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return allowed.has(permission) && isTrustedUrl(requestingOrigin.endsWith('/') ? requestingOrigin : `${requestingOrigin}/`);
  });

  // getDisplayMedia() in the renderer is answered with the source the user picked in our own UI.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const capture = pendingCapture;
    pendingCapture = null;
    if (!capture || !isTrustedUrl(request.frame?.url)) {
      log.warn('Rejected display media request (no pending capture or untrusted frame)');
      callback({});
      return;
    }
    log.info(`Granting capture of "${capture.name}" (${capture.id}), system audio: ${capture.systemAudio}`);
    callback(
      capture.systemAudio
        ? { video: { id: capture.id, name: capture.name }, audio: 'loopback' }
        : { video: { id: capture.id, name: capture.name } },
    );
  });
}

function setupMainWindow(): void {
  const win = createMainWindow();

  win.on('close', (event) => {
    if (allowQuit || !isRecorderBusy()) return;
    event.preventDefault();
    if (quitRequested) return;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'Recording in progress',
        message: 'A recording is in progress.',
        detail: 'Stop the recording and save it before closing ScreenCapture Pro?',
        buttons: ['Stop, save and close', 'Keep recording'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          quitRequested = true;
          sendCommand('stop');
        }
      });
  });

  // The camera bubble is a separate window; closing the main window must still quit the app.
  win.on('closed', () => app.quit());

  win.webContents.on('render-process-gone', async (_event, details) => {
    log.error('Main renderer process gone', details);
    // Close capture files so they can be recovered on reload.
    await closeAllSessions();
    onRecorderState({ status: 'idle', elapsedMs: 0 });
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload();
  });

  nativeTheme.on('updated', () => {
    const main = getMainWindow();
    if (main) main.setTitleBarOverlay(titleBarColors());
  });
}

/**
 * `SCP_SELFTEST=1`: drives a real start → pause → resume → stop cycle through the normal command
 * path (same as the toolbar and shortcuts), then quits once the file is saved.
 */
function runSelfTest(): void {
  log.info('Self-test enabled');
  const step = (command: RecorderCommand) => {
    log.info(`Self-test: ${command} (status ${recorderState.status})`);
    sendCommand(command);
  };
  let started = false;
  selfTestOnState = (state) => {
    if (state.status !== 'recording' || started) return;
    started = true;
    setTimeout(() => step('pause'), 3000);
    setTimeout(() => step('resume'), 4500);
    setTimeout(() => step('stop'), 7000);
  };
  getMainWindow()?.webContents.once('did-finish-load', () => setTimeout(() => step('start'), 2000));
}
let selfTestOnState: ((state: RecorderState) => void) | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.screencapturepro.app');

  app.on('second-instance', () => {
    // Launching the app again (desktop icon, Start menu) brings the existing window to the front.
    const main = getMainWindow();
    if (main) {
      if (!main.isVisible()) main.show();
      if (main.isMinimized()) main.restore();
      main.focus();
    } else {
      setupMainWindow();
    }
  });

  app.whenReady().then(() => {
    log.info(`ScreenCapture Pro ${app.getVersion()} starting (Electron ${process.versions.electron})`);
    const settings = getSettings();
    applyTheme(settings);
    configureSession();
    registerIpc({
      getRecorderState: () => recorderState,
      onRecorderState,
      sendCommand,
      setPendingCapture: (capture) => {
        pendingCapture = capture;
      },
      onSettingsChanged,
      getShortcutStatus: () => shortcutStatus,
      onCameraError: (message) => sendNotice({ level: 'warning', message }),
    });
    setupMainWindow();
    applyShortcuts(settings);
    applyCamera(settings);
    if (process.env.SCP_SELFTEST === '1') runSelfTest();
    if (process.env.SCP_SELFTEST === 'camera') void runCameraSelfTest(getCameraWindow);
  });

  app.on('before-quit', (event) => {
    if (allowQuit || !isRecorderBusy()) return;
    event.preventDefault();
    if (!quitRequested) {
      quitRequested = true;
      log.info('Quit requested during recording; stopping and saving first');
      sendNotice({ level: 'info', message: 'Saving your recording before closing…' });
      sendCommand('stop');
    }
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.on('window-all-closed', () => app.quit());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) setupMainWindow();
  });
}
