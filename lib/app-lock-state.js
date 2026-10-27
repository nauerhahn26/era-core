// Device/browser-local app lock state. No app runtime or DOM dependencies.
export const APP_LOCKS = Object.freeze([
  ['making-words', 'Making Words'], ['pencil', 'The Pencil'], ['board', 'Clothing Picker'],
  ['music', 'Music'], ['movies', 'Movies'], ['this-week', 'This week'], ['reader', 'Book Reader'],
  ['drawing', 'Drawing'], ['math', 'Math'], ['games', 'Games'], ['chat', 'Chat'],
].map(([id, title]) => Object.freeze({ id, title })));
const IDS = new Set(APP_LOCKS.map(a => a.id));
export const LOCK_PREFIX = 'era.app-lock.v1.';
export function appIdForURL(url) {
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { return null; }
  const p = decoded.replace(/\/+/g, '/').replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  if (p === '/') return 'making-words';
  if (p === '/board') {
    const raw = url.searchParams.get('recipe') || 'today';
    // Match the board's own sanitization, including its malformed-name fallback.
    const recipe = /^[a-z0-9-]{1,32}$/.test(raw) ? raw : 'today';
    return ({ today: 'board', songs: 'music', movies: 'movies', 'this-week': 'this-week' })[recipe] || null;
  }
  if (p === '/play' || p === '/watch') return 'this-week';
  return ['pencil', 'reader', 'drawing', 'math', 'games', 'chat'].find(id => p === '/' + id) || null;
}
export function createLockStore(storage, now = Date.now) {
  // Only failed writes live here; successful writes are always read afresh so
  // another tab's unlock cannot be masked by a cached copy.
  const fallback = new Map();
  function key(id) {
    if (!IDS.has(id)) throw new Error('Unknown app lock');
    return LOCK_PREFIX + id;
  }
  function parse(raw) {
    try {
      const value = JSON.parse(raw);
      return value && Number.isSafeInteger(value.until) && value.until >= 0 &&
        (value.until === 0 || value.until > now()) ? { until: value.until } : null;
    } catch { return null; }
  }
  function read(id) {
    key(id);
    if (fallback.has(id)) return parse(JSON.stringify(fallback.get(id)));
    try { return parse(storage.getItem(key(id))); } catch { return null; }
  }
  function write(id, value) {
    fallback.set(id, value);
    try {
      if (value === null) storage.removeItem(key(id));
      else storage.setItem(key(id), JSON.stringify(value));
      fallback.delete(id);
      return { persisted: true };
    } catch { return { persisted: false }; }
  }
  function lock(id, minutes = 45) {
    key(id);
    const m = Number.isFinite(minutes) ? Math.max(0, Math.min(1440, Math.round(minutes))) : 45;
    return write(id, { until: m === 0 ? 0 : now() + m * 60000 });
  }
  function unlock(id) { key(id); return write(id, null); }
  function migrate() {
    let legacy;
    try { legacy = parse(storage.getItem('era.lock')); } catch { return false; }
    if (!legacy) return true;
    let persisted = true;
    for (const id of ['music', 'movies', 'this-week']) {
      const current = read(id);
      const strongest = current && (current.until === 0 || legacy.until !== 0 && current.until > legacy.until) ? current : legacy;
      if (!write(id, strongest).persisted) persisted = false;
    }
    if (persisted) {
      try { storage.removeItem('era.lock'); } catch { return false; }
    }
    return persisted;
  }
  return { key, read, lock, unlock, migrate };
}
