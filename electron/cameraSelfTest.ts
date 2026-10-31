import { app, type BrowserWindow } from 'electron';
import { log } from './services/logger';
import { getSettings } from './services/settings';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `SCP_SELFTEST=camera`: drives the camera bubble with synthetic mouse input sent straight to its
 * window (the real cursor is untouched), logs the window bounds after each gesture, then quits.
 */
export async function runCameraSelfTest(getWindow: () => BrowserWindow | null): Promise<void> {
  log.info('Camera self-test enabled');
  let win: BrowserWindow | null = null;
  for (let i = 0; i < 50 && !win?.isVisible(); i++) {
    await wait(200);
    win = getWindow();
  }
  if (!win) {
    log.error('Camera self-test: no camera window');
    app.quit();
    return;
  }
  await wait(1500);
  const wc = win.webContents;
  const report = (label: string) => log.info(`Camera self-test: ${label}`, win!.getBounds(), `saved=${getSettings().cameraDiameter}`);

  const drag = async (fromX: number, fromY: number, dx: number, dy: number) => {
    const origin = win!.getBounds();
    wc.sendInputEvent({ type: 'mouseMove', x: fromX, y: fromY, globalX: origin.x + fromX, globalY: origin.y + fromY });
    await wait(80);
    wc.sendInputEvent({ type: 'mouseDown', x: fromX, y: fromY, globalX: origin.x + fromX, globalY: origin.y + fromY, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      await wait(40);
      // Like a real pointer, the event position is relative to the window's *current* location.
      const now = win!.getBounds();
      const gx = origin.x + fromX + (dx * i) / 10;
      const gy = origin.y + fromY + (dy * i) / 10;
      wc.sendInputEvent({ type: 'mouseMove', x: gx - now.x, y: gy - now.y, globalX: gx, globalY: gy, modifiers: ['leftButtonDown'] });
    }
    await wait(80);
    const end = win!.getBounds();
    const gx = origin.x + fromX + dx;
    const gy = origin.y + fromY + dy;
    wc.sendInputEvent({ type: 'mouseUp', x: gx - end.x, y: gy - end.y, globalX: gx, globalY: gy, button: 'left', clickCount: 1 });
    await wait(600);
  };
  const wheel = async (ticks: number) => {
    const b = win!.getBounds();
    for (let i = 0; i < Math.abs(ticks); i++) {
      wc.sendInputEvent({ type: 'mouseWheel', x: b.width / 2, y: b.height / 2, deltaX: 0, deltaY: Math.sign(ticks) * 120, wheelTicksY: Math.sign(ticks), canScroll: true });
      await wait(100);
    }
    await wait(900);
  };

  report('initial');
  await wheel(3);
  report('after wheel up x3 (expect +60)');
  await wheel(-1);
  report('after wheel down x1 (expect -20)');
  const b = win.getBounds();
  await drag(b.width / 2, b.height / 2, -200, -120);
  report('after move drag (-200,-120), same size');
  // Hover-free mouse move afterwards must not drag the bubble any further.
  wc.sendInputEvent({ type: 'mouseMove', x: 20, y: 20, globalX: win.getBounds().x + 20, globalY: win.getBounds().y + 20 });
  await wait(400);
  report('after button-up move (no change)');
  const c = win.getBounds();
  await drag(c.width - 13, c.height - 13, 80, 80);
  report('after corner-handle drag +80 (top-left fixed)');
  for (let i = 0; i < 5; i++) await drag(win.getBounds().width / 2, win.getBounds().height / 2, 30, 0);
  report('after 5 small moves (size must not drift)');
  app.quit();
}
