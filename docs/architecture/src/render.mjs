// Rasterise the SVGs to PNG with headless Chrome.
//
// Chrome is the renderer rather than a library because it is already on every
// machine that runs this, and because it is the same engine that will show the
// SVG if anyone opens the file directly — so what the PNG shows is what a
// reader sees.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome or Edge found. Set CHROME to the executable and re-run.');
  process.exit(1);
}

const at = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

for (const name of ['tish-aws-future', 'tish-aws-current']) {
  const svg = at(`${name}.svg`);
  // the window has to match the drawing exactly or Chrome pads or crops it
  const [, w, h] = readFileSync(svg, 'utf8').match(/width="(\d+)" height="(\d+)"/);
  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--screenshot=${at(`${name}.png`)}`,
    `--window-size=${w},${h}`,
    pathToFileURL(svg).href,
  ], { stdio: 'ignore' });
  console.log(`${name}.png  ${w}x${h}`);
}
