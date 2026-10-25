// Exercise the production speech path with controlled audio and delayed clip requests.
// No live hub, credentials or network service is needed. The gate copies this file
// into the hub, so resolve the selected core worktree rather than an assembled copy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sibling = path.join(path.dirname(parent), 'era-core' + (process.env.ERA_WT_SUFFIX || ''));
const core = fs.existsSync(path.join(parent, 'speech.js')) ? parent
  : fs.existsSync(sibling) ? sibling : path.join(path.dirname(parent), 'era-core');
const source = fs.readFileSync(path.join(core, 'speech.js'), 'utf8');
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); });

async function speechPage() {
  const page = await browser.newPage();
  await page.evaluate(() => {
    window.events = [];
    const response = text => ({ ok: true, blob: async () => ({ clipText: text }) });
    window.fetch = async (url, options) => {
      if (url === '/voices') return { json: async () => ({ enabled: true, voices: [] }) };
      const text = JSON.parse(options.body).text;
      events.push({ event: 'fetch', text });
      if (text === 'seven') return new Promise((resolve, reject) => {
        window.releaseOld = () => resolve(response(text));
        window.rejectOld = () => reject(new Error('clip unavailable'));
      });
      if (text === 'fallback') throw new Error('clip unavailable');
      return response(text);
    };
    URL.createObjectURL = blob => 'clip:' + blob.clipText;
    window.Audio = class {
      constructor(url) { this.src = url; this.muted = false; }
      play() {
        events.push({ event: 'play', text: this.src, muted: this.muted });
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause() { events.push({ event: 'pause', text: this.src }); }
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [],
      cancel: () => events.push({ event: 'cancel-local' }),
      speak: utterance => {
        events.push({ event: 'local', text: utterance.text });
        queueMicrotask(() => { utterance.onstart?.(); utterance.onend?.(); });
      },
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  });
  await page.addScriptTag({ content: source });
  await page.evaluate(() => Speech.init('Math'));
  assert.equal(await page.evaluate(() => !!window.__testHooks), false, 'production playback path is exercised');
  const boot = await page.evaluate(() => events.filter(e => e.event === 'play'));
  assert.deepEqual(boot, [{ event: 'play', text: 'clip:Math', muted: true }], 'boot self-test remains silent');
  await page.evaluate(() => { events.length = 0; window.oldSpeech = Speech.say('seven', 'long'); });
  await page.waitForFunction(() => typeof window.releaseOld === 'function');
  return page;
}

test('a stopped number fetch cannot play after the new number has spoken', async () => {
  const page = await speechPage();
  try {
    await page.evaluate(() => { Speech.stop(); window.newSpeech = Speech.say('eight', 'long'); });
    await page.waitForFunction(() => events.some(e => e.event === 'play' && e.text === 'clip:eight'));
    await page.evaluate(() => { window.releaseOld(); });
    await page.evaluate(() => Promise.all([window.oldSpeech, window.newSpeech]));
    assert.deepEqual(await page.evaluate(() => events.filter(e => e.event === 'play').map(e => e.text)), ['clip:eight']);
    assert.deepEqual(await page.evaluate(() => events.filter(e => e.event === 'local')), []);
  } finally { await page.close(); }
});

test('stop alone silences a clip that is still downloading', async () => {
  const page = await speechPage();
  try {
    await page.evaluate(() => { Speech.stop(); window.releaseOld(); });
    await page.evaluate(() => window.oldSpeech);
    assert.deepEqual(await page.evaluate(() => events.filter(e => ['play', 'local'].includes(e.event))), []);
  } finally { await page.close(); }
});

test('a rejected stale fetch does not start local fallback', async () => {
  const page = await speechPage();
  try {
    await page.evaluate(() => { Speech.stop(); window.newSpeech = Speech.say('eight', 'long'); });
    await page.waitForFunction(() => events.some(e => e.event === 'play' && e.text === 'clip:eight'));
    await page.evaluate(() => { window.rejectOld(); });
    await page.evaluate(() => Promise.all([window.oldSpeech, window.newSpeech]));
    assert.deepEqual(await page.evaluate(() => events.filter(e => e.event === 'local')), []);
    assert.deepEqual(await page.evaluate(() => events.filter(e => e.event === 'play').map(e => e.text)), ['clip:eight']);
  } finally { await page.close(); }
});

test('an active request still falls back to the local voice on a clip error', async () => {
  const page = await speechPage();
  try {
    await page.evaluate(() => { Speech.stop(); window.rejectOld(); });
    await page.evaluate(() => window.oldSpeech);
    await page.evaluate(() => Speech.say('fallback', 'long'));
    assert.deepEqual(await page.evaluate(() => events.filter(e => e.event === 'local').map(e => e.text)), ['fallback']);
  } finally { await page.close(); }
});
