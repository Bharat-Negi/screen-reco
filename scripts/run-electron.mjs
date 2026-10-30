// Launches Electron with a clean environment. Some hosts (e.g. VS Code extensions/terminals) export
// ELECTRON_RUN_AS_NODE=1, which would make Electron run as plain Node and exit without opening a window.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false });
child.on('close', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
