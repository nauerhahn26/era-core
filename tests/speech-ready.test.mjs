// A sentence waits for the voice probe (2026-10-26). init() picks the voice by an
// async probe (/voices, then one muted clip); a page that calls init() and say()
// in the same tick used to speak before the probe answered and fell to the local
// voice — the question before a video did it on every cold start. Drives the
// production path (no __testHooks) with stubbed fetch / Audio / speechSynthesis,
// in the mould of speech-barge-in.test.mjs. No live hub, credentials or network.
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

// voices: 'delay' answers {enabled:true} after 300 ms; 'never' never answers;
// 'manual' answers when the page calls window.releaseVoices().
async function speechPage(voices, { clock = false } = {}) {
  const page = await browser.newPage();
  if (clock) await page.clock.install();
  await page.evaluate((voices) => {
    window.events = [];
    const answer = () => ({ json: async () => ({ enabled: true, voices: [] }) });
    window.fetch = async (url, options) => {
      if (url === '/voices') {
        events.push({ event: 'voices' });
        if (voices === 'never') return new Promise(() => {});
        if (voices === 'manual') return new Promise(res => { window.releaseVoices = () => res(answer()); });
        return new Promise(res => setTimeout(() => res(answer()), 300));
      }
      const text = JSON.parse(options.body).text;
      events.push({ event: 'fetch', text });
      return { ok: true, blob: async () => ({ clipText: text }) };
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
  }, voices);
  await page.addScriptTag({ content: source });
  assert.equal(await page.evaluate(() => !!window.__testHooks), false, 'production playback path is exercised');
  return page;
}
const evts = (page, kinds) => page.evaluate(k => events.filter(e => k.includes(e.event)), kinds);

test('a sentence said 10 ms after init() waits for the probe and plays the clip voice', async () => {
  const page = await speechPage('delay');
  try {
    await page.evaluate(async () => {
      window.booted = Speech.init('Boot');
      await new Promise(r => setTimeout(r, 10));
      await Speech.say('Q');
      await window.booted;
    });
    assert.equal(await page.evaluate(() => Speech.mode()), 'eleven');
    assert.deepEqual(await evts(page, ['local']), [], 'the question never falls to the local voice');
    assert.deepEqual((await evts(page, ['fetch'])).filter(e => e.text === 'Q'), [{ event: 'fetch', text: 'Q' }],
      'one /tts request for the question');
    assert.deepEqual((await evts(page, ['play'])).filter(e => e.text === 'clip:Q'),
      [{ event: 'play', text: 'clip:Q', muted: false }], 'the question plays aloud through the clip voice');
  } finally { await page.close(); }
});

test('a probe that never answers holds the sentence for the 4 s cap, then it plays locally', async () => {
  const page = await speechPage('never', { clock: true });
  try {
    await page.evaluate(() => { Speech.init('Boot'); window.spoken = Speech.say('Q'); });
    await page.clock.runFor(3990);
    assert.deepEqual(await evts(page, ['local', 'play']), [], 'nothing speaks before the cap');
    await page.clock.runFor(20);
    await page.evaluate(() => window.spoken);
    assert.deepEqual(await evts(page, ['local']), [{ event: 'local', text: 'Q' }], 'after the cap the local voice says it');
    assert.deepEqual(await evts(page, ['fetch']), [], 'no clip is fetched for an unknown voice');
  } finally { await page.close(); }
});

test('with no init() ever called, say() speaks at once as before', async () => {
  const page = await speechPage('never', { clock: true });
  try {
    await page.evaluate(() => { window.spoken = Speech.say('Q'); });
    await page.clock.runFor(1);
    await page.evaluate(() => window.spoken);
    assert.deepEqual(await evts(page, ['local']), [{ event: 'local', text: 'Q' }]);
    assert.deepEqual(await evts(page, ['voices', 'fetch']), [], 'say() alone never probes');
  } finally { await page.close(); }
});

test('stop() during the wait drops the sentence and leaves the probe intact', async () => {
  const page = await speechPage('manual');
  try {
    await page.evaluate(async () => {
      window.booted = Speech.init('Boot');
      window.dropped = Speech.say('Q');
      await new Promise(r => setTimeout(r, 50));
      Speech.stop();
      window.next = Speech.say('R');
      await new Promise(r => setTimeout(r, 50));
    });
    assert.deepEqual(await evts(page, ['local', 'play']), [], 'nothing speaks while the probe is pending');
    await page.evaluate(async () => {
      window.releaseVoices();
      await Promise.all([window.booted, window.dropped, window.next]);
    });
    assert.equal(await page.evaluate(() => Speech.mode()), 'eleven', 'the probe finished after stop()');
    assert.deepEqual(await evts(page, ['local']), [], 'no local voice');
    assert.deepEqual((await evts(page, ['play'])).map(e => e.text), ['clip:Boot', 'clip:R'],
      'the stopped sentence never plays; the next one plays through the clip voice');
  } finally { await page.close(); }
});
