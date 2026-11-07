// Drive the Archify viewer's own "Export -> PNG" menu item in headless Chrome via CDP.
// Archify has no CLI command for PNG export; this reproduces the viewer's export without manual clicks.
// Usage: node docs/diagrams/export-png.mjs docs/diagrams/html/<name>.html docs/diagrams/png/<name>.png
// Set CHROME_PATH when Chrome is not at the default macOS location.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , inputHtml, outputPng] = process.argv;
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profileDir = mkdtempSync(path.join(tmpdir(), 'archify-png-profile-'));
const downloadDir = mkdtempSync(path.join(tmpdir(), 'archify-png-dl-'));
const port = 9300 + Math.floor(Math.random() * 500);

const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,1200', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

async function main() {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
  await send('Page.navigate', { url: pathToFileURL(path.resolve(inputHtml)).href });
  await sleep(3000);
  const res = await send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('button[data-format="png"]'); if (!b) return 'no-button'; b.click(); return 'clicked'; })()`,
    returnByValue: true, userGesture: true,
  });
  if (res.result.value !== 'clicked') throw new Error(`export button: ${res.result.value}`);

  for (let i = 0; i < 150; i++) {
    const files = readdirSync(downloadDir).filter((f) => f.endsWith('.png'));
    if (files.length) {
      const src = path.join(downloadDir, files[0]);
      await sleep(500);
      renameSync(src, path.resolve(outputPng));
      console.log(`wrote ${outputPng} (${statSync(path.resolve(outputPng)).size} bytes) from ${files[0]}`);
      ws.close();
      return;
    }
    await sleep(200);
  }
  throw new Error('no PNG download observed');
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => { rmSync(profileDir, { recursive: true, force: true }); rmSync(downloadDir, { recursive: true, force: true }); }, 500); });
