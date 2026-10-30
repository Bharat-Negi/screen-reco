# ScreenCapture Pro

A screen recorder for Windows 10 and Windows 11, built with Electron, React, TypeScript and FFmpeg.

- Record the **entire screen**, a single **application window**, a **selected monitor**, or a **custom region**
- **System audio** and **microphone**, mixed into one synchronized track
- **720p / 1080p / native** quality at **30 or 60 FPS**, saved as **MP4 (H.264 + AAC)**
- **Pause and resume** in a single file, live **HH:MM:SS** timer, always-on-top **recording toolbar**
- The app's own windows are **hidden from the recording**
- **Recordings history** with Play / Open folder, **crash recovery**, **disk-space protection**
- Light/dark themes, keyboard shortcuts, notifications. Recordings never leave your PC.

---

## 1. Install dependencies

Requirements: **Windows 10 (version 1903 or later) or Windows 11**, **Node.js 18+** (20 or 22 LTS recommended), and an internet connection for the first install.

```powershell
cd "I:\Bharat-Negi\windows software\screen-reco"
npm install
```

`npm install` also downloads a bundled FFmpeg binary (the `ffmpeg-static` package). If that download fails, the app falls back to an `ffmpeg.exe` on your `PATH`, or to one you choose in **Settings → Video encoder**.

## 2. Run locally

```powershell
npm run dev        # Vite dev server + TypeScript watch + Electron, with hot reload of the UI
```

Or run the production build without packaging it:

```powershell
npm run build
npm start
```

Automated end-to-end check: this records about 5 seconds of your screen (with a pause), saves an MP4, then exits.

```powershell
npm run selftest   # the result is in your output folder; details in %APPDATA%\ScreenCapture Pro\logs\main.log
```

## 3. Build the Windows installer

```powershell
npm run dist
```

Output: `release\ScreenCapture-Pro-Setup-1.0.0.exe` (an NSIS installer, x64). `npm run dist:dir` builds only the unpacked app in `release\win-unpacked\`.

> **"Cannot create symbolic link: A required privilege is not held by the client"**
> This is a known electron-builder issue on Windows: its code-signing tools archive contains macOS symlinks. Either enable
> **Settings → System → For developers → Developer Mode**, or extract the archive once without the macOS files:
>
> ```powershell
> $cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
> $archive = Get-ChildItem "$cache\*.7z" | Select-Object -First 1
> & .\node_modules\7zip-bin\win\x64\7za.exe x -y "-o$cache\winCodeSign-2.6.0" $archive.FullName "-xr!darwin"
> npm run dist
> ```

The installer is **not code-signed**. Windows SmartScreen will show "Windows protected your PC". Click **More info → Run anyway**. To sign it, set `CSC_LINK` / `CSC_KEY_PASSWORD` before running `npm run dist` (see the electron-builder code-signing docs).

## 4. Install the application

1. Run `release\ScreenCapture-Pro-Setup-1.0.0.exe`.
2. Choose "Only for me" (the default; no admin rights needed) and the install folder.
3. Start **ScreenCapture Pro** from the Start menu or the desktop shortcut.

To uninstall, use **Settings → Apps → Installed apps → ScreenCapture Pro → Uninstall**. Your recordings and settings are kept.

## 5. Using it

1. Pick a source: **Entire Screen**, **Application Window**, **Selected Monitor**, or **Custom Region** (drag a rectangle, then press Enter).
2. Choose audio, quality and frame rate.
3. Press the red **Start Recording** button (or **Ctrl + Shift + R**).
4. Use the floating toolbar or the shortcuts: **Ctrl + Shift + P** pauses/resumes, **Ctrl + Shift + S** stops.
5. When you stop, the MP4 is encoded and saved as `ScreenCapture_YYYY-MM-DD_HH-MM-SS.mp4`. A notification and the "Recording saved" card show where it is.

Default output folder: `%USERPROFILE%\Videos\ScreenCapture Pro`. Change it in the main window or in Settings.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **Running `electron`/`npm start` opens no window** | Some terminals (notably inside VS Code extensions) set `ELECTRON_RUN_AS_NODE=1`. The npm scripts already clear it through `scripts/run-electron.mjs`. If you launch Electron another way, run `Remove-Item Env:ELECTRON_RUN_AS_NODE` first. |
| **No system audio in the video** | Make sure something is actually playing, and that the default output device in **Settings → System → Sound** is the one you listen on. System audio is captured from the default playback device (loopback). |
| **Microphone not recorded / "Microphone access is blocked"** | **Windows Settings → Privacy & security → Microphone**: turn on *Microphone access* and *Let desktop apps access your microphone*. Then pick the device again in the Audio card. Recording continues without the mic if it fails. |
| **Microphone list shows "Microphone 1, 2…"** | Device names appear after access is granted once. Toggle the microphone off and on. |
| **Window recording is black** | The window may be minimized (restore it), or the app uses DRM/protected content (Netflix, some browsers' protected video), which Windows deliberately blocks from capture. |
| **A yellow border appears around the captured window (Windows 10)** | That is Windows' own privacy indicator for window capture. It is not recorded, and Windows 10 doesn't allow apps to turn it off. |
| **The app's window shows up black in a recording** | Hiding the app from recordings needs Windows 10 version 2004 or newer. Older versions show the window black instead. You can turn this off in Settings. |
| **Saved as .webm/.mkv instead of .mp4** | FFmpeg wasn't found. Run `npm install` again, or install FFmpeg (`winget install Gyan.FFmpeg`), or pick `ffmpeg.exe` in **Settings → Video encoder**. |
| **"Unfinished recording found" banner** | The app or PC closed during a recording. Click **Recover** to encode the footage up to that point into an MP4. |
| **Shortcut doesn't work in other apps** | Another app already uses that key combination (Settings shows which one). The shortcut still works while ScreenCapture Pro is focused. |
| **Recording stopped by itself: disk space** | Recording stops and saves when free space drops below 500 MB. Free up space or choose another output folder. |
| **Anything else** | Settings → **Open log folder** (`%APPDATA%\ScreenCapture Pro\logs\main.log`). FFmpeg errors are logged there in full. |

---

## How it works

```
Renderer (React, sandboxed)                      Main process (Node)
──────────────────────────                       ───────────────────
getDisplayMedia ──(source picked in our UI)──►   setDisplayMediaRequestHandler → desktopCapturer source
                                                  + audio: 'loopback' (system audio)
getUserMedia (mic) ─┐
                    ├─ Web Audio mix ─┐
MediaRecorder (H.264/VP9 + Opus) ◄────┘
   │  1-second chunks over IPC  ───────────────►  append to %APPDATA%\…\recordings-temp\<id>.capture
   │                                              (crash-safe: survives app crash / power loss)
Stop ──────────────────────────────────────────►  FFmpeg: crop (region) → scale (720p/1080p) → CFR fps
                                                  → libx264 + AAC, aresample=async (A/V sync)
                                                  → <output>\ScreenCapture_<date>_<time>.mp4 (-n: never overwrite)
```

- **Pause/resume** uses `MediaRecorder.pause()/resume()`, so the result is one file with the paused time removed.
- **Hiding the app from recordings** uses `BrowserWindow.setContentProtection` (Win32 `WDA_EXCLUDEFROMCAPTURE`).
- **Custom region** records the display, and FFmpeg crops to the region when the file is saved, using the exact pixel coordinates (including display scaling).

### Project structure

```
electron/
  main.ts              app lifecycle, recorder state, shortcuts, permissions, display-media handler
  preload.ts           contextBridge API (window.scp), the only bridge to the renderer
  ipc.ts               IPC handlers with sender validation and input checks
  windows.ts           main window, recording toolbar, region overlay
  services/            settings, history, sessions (temp file + finalize + recovery), ffmpeg, disk, logger
shared/types.ts        types shared by main, preload and renderer
src/
  recorder/engine.ts   capture streams, audio mixing, MediaRecorder
  recorder/useRecorder.ts  state machine, timer, pause/resume, disk watchdog, commands
  views/               MainView (dashboard), ToolbarView, RegionView
  components/          RecordButton, SourceSelector, SourcePicker, Options, HistoryList, SettingsDialog, Toasts
scripts/               make-icon.mjs (generates build/icon.*), run-electron.mjs
electron-builder.yml   installer configuration
```

### Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in every window. A strict Content-Security-Policy, and navigation and new windows are blocked.
- Every IPC call checks that it comes from the app's own page. All inputs are validated in the main process, and file actions (play, show, delete) accept only IDs from the app's own history, never raw paths.
- Permissions (screen capture, microphone) are granted only to the app's own page. Screen capture is granted only for the source picked in the app's own UI, and only once per request.
- There is no network access. Recordings are never uploaded.

### Icons

`build/icon.png` and `build/icon.ico` are generated by `npm run icons` (`scripts/make-icon.mjs`). To use your own artwork, replace both files (ICO with 256/48/32/16 px sizes) and rebuild.

---

## Known limitations

- **"Entire Screen" records the primary display.** Chromium captures one display at a time, so recording several monitors in one video isn't supported. Use **Selected Monitor** to choose another display.
- **System audio is the whole PC's audio** (Windows loopback), even when recording a single window. Capturing one app's audio isn't available through Electron.
- **Encoding happens when you stop.** A long recording takes some time to save, with a progress bar in the app and the toolbar. Expect roughly 10–40% of the recording's length on a typical PC with the `veryfast` preset. Raw footage is safe on disk the whole time.
- The **custom region** is fixed once recording starts, and must stay on a single display.
- The **toolbar has square corners on Windows 10.** Windows 11 rounds them.
