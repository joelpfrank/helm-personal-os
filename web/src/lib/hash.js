// Tiny helper so multiple top-level sections (tasks, habits, …) can
// each park their own state in the URL hash without stepping on
// each other.

export function readHashParams() {
  const raw = (typeof window === 'undefined' ? '' : window.location.hash).replace(/^#/, '');
  return new URLSearchParams(raw);
}

export function writeHashParams(updates) {
  const params = readHashParams();
  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === '') params.delete(k);
    else params.set(k, String(v));
  }
  const s = params.toString();
  window.location.hash = s ? s : '';
}

export function getHashParam(key) {
  return readHashParams().get(key);
}

export function onHashChange(cb) {
  const handler = () => cb(readHashParams());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
