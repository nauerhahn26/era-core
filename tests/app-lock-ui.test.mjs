// Shared adult lock UI and input interception. Authored; execution deferred.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, '..'), path.resolve(here, '../public')].find(p => fs.existsSync(path.join(p, 'lib/app-lock.js')));
let server, browser, base, passcode = '';
const fixture = `<!doctype html><link rel="stylesheet" href="/lib/doorbar.css"><div id="app"><button id="activity" class="dwell">Do activity</button></div><script type="module">
import { mountDoorBar } from '/lib/doorbar.js';
window.actions=0; window.stopped=0; window.unlocked=0;
document.getElementById('activity').onclick=()=>window.actions++;
window.bar=mountDoorBar(document.getElementById('app'), {onLock(){window.stopped++},onUnlock(){window.unlocked++}});
window.bar.setPause(true);window.fixtureReady=true;
</script>`;
before(async () => {
  server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://fixture.invalid').pathname;
    if (p === '/settings') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ lockMinutes: 0, lockPasscodeHash: passcode })); return; }
    if (p.startsWith('/kiosk/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ action: 'closed' })); return; }
    if (p.startsWith('/lib/') && !p.includes('..')) {
      try { res.setHeader('Content-Type', p.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(path.join(root, p))); }
      catch { res.writeHead(404).end(); } return;
    }
    res.setHeader('Content-Type', 'text/html'); res.end(fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch();
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function hold(page, duration = 1700, pointerType = 'touch') {
  const button = page.locator('.app-lock-control');
  await button.dispatchEvent('pointerdown', { pointerType, pointerId: 1 });
  await page.waitForTimeout(duration);
  await button.dispatchEvent('pointerup', { pointerType, pointerId: 1 });
}
test('all eleven app routes get an independent shared control and keep both doors', async () => {
  for (const route of ['/', '/pencil/', '/board/', '/board/?recipe=songs', '/board/?recipe=movies', '/board/?recipe=this-week', '/reader/', '/drawing/', '/math/', '/games/', '/chat/']) {
    const context = await browser.newContext({ hasTouch: true });
    try {
      const page = await context.newPage(); await page.goto(base + route); await page.waitForFunction(() => window.fixtureReady);
      await hold(page); await page.waitForFunction(() => window.AppLock.isLocked());
      assert.equal(await page.locator('.app-lock-curtain').isVisible(), true, route);
      assert.equal(await page.locator('#barDoor').isVisible(), true); assert.equal(await page.locator('#barTalk').isVisible(), true);
      await page.evaluate(() => document.getElementById('activity').click());
      assert.equal(await page.evaluate(() => window.actions), 0);
      await page.reload(); await page.waitForFunction(() => window.fixtureReady);
      assert.equal(await page.evaluate(() => window.AppLock.isLocked()), true);
      await hold(page); await page.waitForFunction(() => !window.AppLock.isLocked());
      assert.equal(await page.evaluate(() => window.actions), 0, 'unlock does not perform an action');
    } finally { await context.close(); }
  }
});
test('tap, mouse hold and canceled touch cannot toggle a lock', async () => {
  const context = await browser.newContext({ hasTouch: true });
  try {
    const page = await context.newPage(); await page.goto(base + '/math/'); await page.waitForFunction(() => window.fixtureReady);
    await hold(page, 100); await hold(page, 1700, 'mouse');
    assert.equal(await page.evaluate(() => window.AppLock.isLocked()), false);
  } finally { await context.close(); }
});
test('cross-tab lock stops an already mounted app and leaves other apps available', async () => {
  const context = await browser.newContext({ hasTouch: true });
  try {
    const a = await context.newPage(), b = await context.newPage(), c = await context.newPage();
    await a.goto(base + '/math/'); await b.goto(base + '/math/'); await c.goto(base + '/pencil/');
    for (const page of [a,b,c]) await page.waitForFunction(() => window.fixtureReady);
    await hold(a); await b.waitForFunction(() => window.AppLock.isLocked());
    assert.equal(await b.evaluate(() => window.stopped), 1); assert.equal(await c.evaluate(() => window.AppLock.isLocked()), false);
    await hold(b); await a.waitForFunction(() => !window.AppLock.isLocked());
  } finally { await context.close(); }
});
test('shared four-digit keypad refuses a wrong code, cancel keeps lock, right code unlocks', async () => {
  passcode = createHash('sha256').update('2468').digest('hex');
  const context = await browser.newContext({ hasTouch: true });
  try {
    const page = await context.newPage(); await page.goto(base + '/math/'); await page.waitForFunction(() => window.fixtureReady);
    await hold(page); await page.waitForFunction(() => window.AppLock.isLocked());
    await hold(page); await page.locator('#lockPad').waitFor();
    await page.keyboard.type('1111'); await page.waitForFunction(() => document.querySelector('#lockPad h2').textContent.includes('again'));
    assert.equal(await page.evaluate(() => window.AppLock.isLocked()), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#lockPad').count(), 0);
    await hold(page); await page.locator('#lockPad').waitFor();
    await page.keyboard.type('2468'); await page.waitForFunction(() => !window.AppLock.isLocked());
  } finally { passcode = ''; await context.close(); }
});
test('interrupted transitions wait for an explicit Continue after unlocking', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(base + '/math/'); await page.waitForFunction(() => window.fixtureReady);
    await page.evaluate(async () => {
      const lock = window.AppLock.get('math'); await lock.lock();
      lock.deferResume(() => { window.actions++; });
      await lock.requestUnlock();
    });
    assert.equal(await page.evaluate(() => window.actions), 0);
    await page.locator('.app-lock-resume button').click();
    assert.equal(await page.evaluate(() => window.actions), 1);
  } finally { await context.close(); }
});
