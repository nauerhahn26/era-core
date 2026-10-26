// One lock controller and adult interaction for every app. Apps own cancellation.
import { APP_LOCKS, LOCK_PREFIX, appIdForURL, createLockStore } from './app-lock-state.js';
export { APP_LOCKS, appIdForURL } from './app-lock-state.js';
export const HOLD_MS = 1600;
const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
let store, configuration = null, settingsRequest = null, settingsGeneration = 0;
const controllers = new Map();
const CONFIG_KEY = 'era.app-lock.settings.v1';
const allowed = '#barDoor, #barTalk, [data-app-lock-ui]';
function storage() {
  try { return window.localStorage; } catch {
    return { getItem() { throw new Error('Storage unavailable'); }, setItem() { throw new Error('Storage unavailable'); }, removeItem() { throw new Error('Storage unavailable'); } };
  }
}
function ensureStore() {
  if (!store) {
    const local = storage(); store = createLockStore(local); store.migrate();
    try {
      const saved = JSON.parse(local.getItem(CONFIG_KEY));
      if (!configuration && saved && Number.isFinite(saved.lockMinutes) && (saved.lockPasscodeHash === '' || /^[0-9a-f]{64}$/.test(saved.lockPasscodeHash))) configureLock(saved, false);
    } catch { /* Fresh profiles acquire configuration from Settings. */ }
  }
  return store;
}
function addStyles() {
  if (document.querySelector('link[data-app-lock-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/lib/app-lock.css'; link.dataset.appLockStyle = '';
  document.head.append(link);
}
export async function refreshLockSettings() {
  if (settingsRequest) return settingsRequest;
  const generation = ++settingsGeneration;
  settingsRequest = (async () => {
    const response = await fetch('/settings', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Lock settings could not be loaded. Try again.');
    const value = await response.json();
    if (generation === settingsGeneration) configureLock(value);
    return configuration;
  })().finally(() => { settingsRequest = null; });
  return settingsRequest;
}
export function configureLock(value, persist = true) {
  if (!value || typeof value !== 'object') return;
  settingsGeneration++; // A newer local save invalidates any older pending read.
  configuration = {
    minutes: Number.isFinite(value.lockMinutes) ? Math.max(0, Math.min(1440, Math.round(value.lockMinutes))) : 45,
    hash: typeof value.lockPasscodeHash === 'string' && /^[0-9a-f]{64}$/.test(value.lockPasscodeHash) ? value.lockPasscodeHash : '',
  };
  if (persist && browser) try { storage().setItem(CONFIG_KEY, JSON.stringify({ lockMinutes: configuration.minutes, lockPasscodeHash: configuration.hash })); } catch { /* In-page configuration still works. */ }
}
async function actionSettings() {
  try { return await refreshLockSettings(); }
  catch (error) { if (configuration) return configuration; throw error; }
}
function announce(controller, text) {
  controller.message = text;
  controller.paint();
}
export function getAppLock(id = browser ? appIdForURL(new URL(location.href)) : null) {
  if (!id) return null;
  if (controllers.has(id)) return controllers.get(id);
  const data = ensureStore();
  data.key(id); // validate before registering any listeners
  let last = null, timer = null;
  const listeners = new Set(), controls = new Set();
  const controller = {
    id, message: '', resumeAction: null,
    deferResume(action) { controller.resumeAction = action; controller.paint(); },
    resume() {
      if (controller.isLocked() || !controller.resumeAction) return;
      const action = controller.resumeAction; controller.resumeAction = null; controller.paint();
      Promise.resolve().then(action).catch(error => announce(controller, error.message));
    },
    read: () => data.read(id),
    isLocked: () => !!data.read(id),
    subscribe(listener) {
      listeners.add(listener);
      listener(controller.read());
      return () => listeners.delete(listener);
    },
    sync() {
      const value = controller.read(), stamp = value ? String(value.until) : null;
      clearTimeout(timer);
      if (value && value.until) timer = setTimeout(() => controller.sync(), Math.min(2147483647, Math.max(0, value.until - Date.now()) + 25));
      if (last !== stamp) {
        last = stamp;
        for (const listener of [...listeners]) listener(value);
      }
      controller.paint();
    },
    paint() {
      const locked = controller.isLocked();
      for (const button of controls) {
        button.classList.toggle('locked', locked);
        button.setAttribute('aria-label', (locked ? 'Unlock ' : 'Lock ') + APP_LOCKS.find(a => a.id === id).title);
        button.setAttribute('aria-pressed', String(locked));
      }
      window.dispatchEvent(new CustomEvent('app-lock:status', { detail: { id, lock: controller.read(), message: controller.message } }));
    },
    async lock() {
      try {
        // Fetch before every adult action. A stale/missing passcode must never
        // turn an intended protected unlock into an unprotected one.
        await actionSettings();
        const result = data.lock(id, configuration.minutes);
        controller.message = result.persisted ? '' : 'Locked for this window. Could not save the lock; keep this window open.';
        controller.sync();
        return result.persisted;
      } catch (error) { announce(controller, error.message); return false; }
    },
    async requestUnlock() {
      try {
        await actionSettings();
        if (!controller.isLocked()) return;
        const hash = configuration.hash;
        if (hash && !await requestPasscode(hash)) return;
        // A changed setting while the keypad was open requires a new attempt.
        await actionSettings();
        if (configuration.hash !== hash) { announce(controller, 'Passcode changed. Try unlocking again.'); return; }
        const result = data.unlock(id);
        controller.message = result.persisted ? '' : 'Unlocked for this window. Could not save the change.';
        controller.sync();
        window.Dwell?.suppress(600);
      } catch (error) { announce(controller, error.message); }
    },
    mountControl(strip) {
      addStyles();
      const button = document.createElement('button');
      button.type = 'button'; button.id = 'stripLock'; button.className = 'stripbtn app-lock-control';
      button.dataset.appLockUi = ''; button.textContent = '🔒';
      button.style.setProperty('--hold-ms', HOLD_MS + 'ms');
      controls.add(button); strip.append(button); controller.paint();
      let hold = null, busy = false, pointer = null;
      const cancel = () => { clearTimeout(hold); hold = null; pointer = null; button.classList.remove('holding'); };
      button.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch' || busy || pointer !== null) return;
        event.preventDefault(); cancel(); pointer = event.pointerId;
        try { button.setPointerCapture(event.pointerId); } catch { /* synthetic fixture */ }
        button.classList.add('holding');
        hold = setTimeout(async () => {
          cancel(); busy = true;
          try { if (controller.isLocked()) await controller.requestUnlock(); else await controller.lock(); }
          finally { busy = false; }
        }, HOLD_MS);
      });
      for (const event of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(event, e => { if (e.pointerId === pointer) cancel(); });
      button.addEventListener('contextmenu', event => event.preventDefault());
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
      return { button, dispose() { cancel(); controls.delete(button); button.remove(); } };
    },
  };
  controllers.set(id, controller);
  controller.sync();
  return controller;
}

// Resolves false on dismissal. No entry survives this scope; never log digits.
function requestPasscode(hash) {
  if (document.getElementById('lockPad')) return Promise.resolve(false);
  addStyles();
  return new Promise(resolve => {
    let entry = '', pending = false, closed = false;
    const previous = document.activeElement;
    const pad = document.createElement('div');
    pad.id = 'lockPad'; pad.dataset.appLockUi = ''; pad.className = 'app-lock-pad';
    pad.setAttribute('role', 'dialog'); pad.setAttribute('aria-modal', 'true'); pad.setAttribute('aria-label', 'Grown-up passcode');
    const card = document.createElement('div'); card.className = 'app-lock-card lockpad-card';
    const title = document.createElement('h2'); title.textContent = 'Grown-up passcode';
    const dots = document.createElement('div'); dots.className = 'app-lock-dots'; dots.setAttribute('aria-label', 'Four digits');
    for (let i = 0; i < 4; i++) { const dot = document.createElement('span'); dot.className = 'lockpad-dot'; dots.append(dot); }
    const grid = document.createElement('div'); grid.className = 'app-lock-grid';
    function close(ok) {
      if (closed) return;
      closed = true; entry = ''; pad.remove(); document.removeEventListener('keydown', keyboard, true);
      previous?.focus?.(); resolve(ok);
    }
    function paint() { [...dots.children].forEach((dot, index) => { dot.classList.toggle('on', index < entry.length); dot.textContent = index < entry.length ? '●' : '○'; }); }
    async function submit() {
      pending = true;
      try {
        const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry));
        if (closed) return;
        const got = [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (got === hash) { close(true); return; }
        title.textContent = 'Try the passcode again';
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      } catch { if (!closed) title.textContent = 'Passcode could not be checked. Try again.'; }
      if (closed) return;
      entry = ''; pending = false; paint();
    }
    function key(value) {
      if (closed || pending) return;
      if (value === 'del') entry = entry.slice(0, -1);
      else if (entry.length < 4) entry += value;
      paint(); if (entry.length === 4) void submit();
    }
    function keyboard(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(false); }
      else if (/^[0-9]$/.test(event.key) || event.key === 'Backspace') {
        event.preventDefault(); event.stopImmediatePropagation(); key(event.key === 'Backspace' ? 'del' : event.key);
      } else if (event.key === 'Tab') {
        const buttons = [...pad.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
        event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    }
    for (const value of ['1','2','3','4','5','6','7','8','9','','0','del']) {
      const button = document.createElement(value ? 'button' : 'span');
      if (value) {
        button.type = 'button'; button.dataset.key = value; button.textContent = value === 'del' ? '⌫' : value;
        button.addEventListener('click', () => key(value));
      }
      grid.append(button);
    }
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.dataset.key = 'cancel'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => close(false));
    card.append(title, dots, grid, cancel); pad.append(card);
    pad.addEventListener('pointerdown', event => { if (event.target === pad) close(false); });
    document.addEventListener('keydown', keyboard, true);
    document.body.append(pad); paint(); grid.querySelector('button').focus();
  });
}

export function mountAppLock({ bar, id, onLock, onUnlock }) {
  const controller = getAppLock(id);
  if (!controller) return { controller: null, dispose() {} };
  addStyles();
  const control = controller.mountControl(bar);
  const curtain = document.createElement('div');
  curtain.className = 'app-lock-curtain'; curtain.dataset.appLockUi = '';
  curtain.setAttribute('role', 'status'); curtain.setAttribute('aria-live', 'polite');
  curtain.hidden = true; document.body.append(curtain);
  const resume = document.createElement('div'); resume.className = 'app-lock-resume'; resume.hidden = true;
  const continueButton = document.createElement('button'); continueButton.type = 'button';
  continueButton.className = 'dwell'; continueButton.textContent = 'Continue'; continueButton.dataset.dwellSay = 'Continue';
  continueButton.addEventListener('click', () => controller.resume()); resume.append(continueButton); document.body.append(resume);
  let wasLocked = false, disposed = false;
  function paint() {
    if (disposed) return;
    const lock = controller.read();
    resume.hidden = !!lock || !controller.resumeAction;
    curtain.hidden = !lock && !controller.message;
    curtain.classList.toggle('app-lock-error', !lock);
    const name = APP_LOCKS.find(app => app.id === controller.id).title;
    curtain.textContent = (lock ? name + (lock.until ? ' is locked until ' + new Date(lock.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ' is locked') + '. ' : '') + controller.message;
    const height = bar.getBoundingClientRect().bottom;
    curtain.style.top = Math.max(0, height) + 'px';
    document.body.dataset.appLocked = String(!!lock);
  }
  const unsubscribe = controller.subscribe(lock => {
    paint();
    if (lock) { wasLocked = true; onLock?.(); }
    else if (wasLocked) { wasLocked = false; onUnlock?.(); window.Dwell?.suppress(600); }
  });
  const status = event => { if (event.detail.id === controller.id) paint(); };
  const resize = () => requestAnimationFrame(paint);
  window.addEventListener('app-lock:status', status); window.addEventListener('resize', resize);
  void refreshLockSettings().catch(() => {});
  return { controller, dispose() {
    disposed = true; unsubscribe(); control.dispose(); curtain.remove(); resume.remove();
    window.removeEventListener('app-lock:status', status); window.removeEventListener('resize', resize);
  } };
}

if (browser) {
  const current = getAppLock();
  window.AppLock = { isLocked: () => current?.isLocked() || false, get: getAppLock, configure: configureLock };
  function sync() { for (const controller of controllers.values()) controller.sync(); }
  window.addEventListener('storage', event => {
    if (event.key === CONFIG_KEY && event.newValue) { try { configureLock(JSON.parse(event.newValue), false); } catch {} }
    if (event.key === null || event.key === 'era.lock' || typeof event.key === 'string' && event.key.startsWith(LOCK_PREFIX)) { if (event.key === 'era.lock') ensureStore().migrate(); sync(); } });
  window.addEventListener('focus', () => { sync(); void refreshLockSettings().catch(() => {}); });
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', () => { sync(); if (!document.hidden) void refreshLockSettings().catch(() => {}); });
  // Capture guards complement app action guards: neither touch rescue nor a
  // synthetic click, keyboard shortcut, drag or form can bypass a lock.
  const intercept = event => {
    if (!current?.isLocked()) return;
    if (event.target instanceof Element && event.target.closest(allowed)) return;
    if (event.type === 'keydown' && event.key === 'Tab') return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  for (const name of ['click','dblclick','pointerdown','pointerup','pointermove','touchstart','touchend','keydown','keyup','beforeinput','input','change','submit','dragstart','drop','contextmenu']) window.addEventListener(name, intercept, { capture: true, passive: false });
  document.addEventListener('focusin', event => {
    if (current?.isLocked() && event.target instanceof Element && !event.target.closest(allowed)) document.querySelector('.app-lock-control')?.focus();
  });
  document.addEventListener('play', event => { if (current?.isLocked() && typeof event.target.pause === 'function') event.target.pause(); }, true);
}
