// These regression cases are authored before implementation; execution is deferred.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = [new URL('../', import.meta.url).pathname, new URL('../public/', import.meta.url).pathname]
  .find(p => fs.existsSync(path.join(p, 'lib/app-lock-state.js')));
const { createLockStore, appIdForURL, APP_LOCKS } = await import(pathToFileURL(path.join(root, 'lib/app-lock-state.js')));
function memory() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
}
test('eleven independent app identities include child routes', () => {
  assert.equal(APP_LOCKS.length, 11);
  for (const [url, id] of [['/', 'making-words'], ['/pencil/', 'pencil'], ['/%70encil/index.html', 'pencil'], ['/board/?recipe=%21', 'board'], ['/board/', 'board'],
    ['/board/?recipe=songs&board=one', 'music'], ['/board/?recipe=movies', 'movies'],
    ['/board/?recipe=this-week', 'this-week'], ['/play/?w=week', 'this-week'], ['/watch/?id=one', 'this-week'],
    ['/reader/#book=one', 'reader'], ['/drawing/', 'drawing'], ['/math/', 'math'], ['/games/', 'games'], ['/chat/', 'chat']])
    assert.equal(appIdForURL(new URL(url, 'http://localhost')), id, url);
  assert.equal(appIdForURL(new URL('http://localhost/settings/')), null);
  assert.equal(appIdForURL(new URL('http://localhost/board/?recipe=unknown')), null);
});
test('independent expiry and indefinite locks; unlocking one leaves the other', () => {
  let now = 1000;
  const store = createLockStore(memory(), () => now);
  store.lock('music', 1); store.lock('pencil', 0);
  assert.equal(store.read('movies'), null);
  now += 60001;
  assert.equal(store.read('music'), null);
  assert.deepEqual(store.read('pencil'), { until: 0 });
  store.unlock('music');
  assert.deepEqual(store.read('pencil'), { until: 0 });
});
test('different app writers and fresh sessions retain both locks', () => {
  const storage = memory();
  createLockStore(storage).lock('music', 0);
  createLockStore(storage).lock('math', 0);
  const reloaded = createLockStore(storage);
  assert.deepEqual(reloaded.read('music'), { until: 0 });
  assert.deepEqual(reloaded.read('math'), { until: 0 });
});
test('legacy coupled lock migrates without weakening a newer indefinite lock', () => {
  const storage = memory();
  storage.setItem('era.lock', JSON.stringify({ until: 5000 }));
  const store = createLockStore(storage, () => 1000);
  store.lock('music', 0);
  store.migrate();
  assert.deepEqual(store.read('music'), { until: 0 });
  for (const id of ['movies', 'this-week']) assert.deepEqual(store.read(id), { until: 5000 });
  assert.equal(storage.getItem('era.lock'), null);
});
test('failed persistence keeps the in-page lock and leaves legacy migration retryable', () => {
  const storage = memory();
  storage.setItem('era.lock', JSON.stringify({ until: 0 }));
  storage.setItem = () => { throw new Error('unavailable'); };
  const store = createLockStore(storage);
  assert.equal(store.migrate(), false);
  assert.notEqual(storage.getItem('era.lock'), null);
  assert.deepEqual(store.read('music'), { until: 0 });
  assert.equal(store.lock('pencil', 0).persisted, false);
  assert.deepEqual(store.read('pencil'), { until: 0 });
});
test('malformed records do not invent a lock and unknown IDs cannot write', () => {
  const storage = memory(), store = createLockStore(storage);
  storage.setItem(store.key('math'), '{');
  assert.equal(store.read('math'), null);
  assert.throws(() => store.lock('unknown', 0));
});
