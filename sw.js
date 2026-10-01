// Service worker OEPRE : fonctionnement hors ligne (pages, icônes, polices, audio)
const STATIC = 'oepre-static-v22', AUDIO = 'oepre-audio-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const TAILWIND = 'https://cdn.tailwindcss.com';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap';
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(STATIC);
  await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
  await fetch(TAILWIND, { mode: 'no-cors' }).then(r => c.put(TAILWIND, r)).catch(() => {});
  try {
    const r = await fetch(FONTS); const css = await r.clone().text(); await c.put(FONTS, r);
    await Promise.all([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => fetch(m[1]).then(x => c.put(m[1], x)).catch(() => {})));
  } catch (_) {}
  self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('oepre-static-') && k !== STATIC) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url), same = url.origin === location.origin;
  if (same && url.pathname.endsWith('.mp3')) return e.respondWith(audio(req));
  if (req.mode === 'navigate' || (same && url.pathname.endsWith('/audio/manifest.json'))) return e.respondWith(networkFirst(req));
  if (same || CDN_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const c = await caches.open(STATIC);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(no, 4000))]);
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (_) {
    return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && ((await c.match('index.html')) || (await c.match('./')))) || Response.error();
  }
}
async function cacheFirst(req) {
  const c = await caches.open(STATIC), hit = await c.match(req);
  if (hit) return hit;
  try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; } catch (_) { return Response.error(); }
}
// Audio : depuis le cache, avec prise en charge des requêtes "Range" (nécessaire à Safari/iOS)
async function audio(req) {
  const c = await caches.open(AUDIO); let res = await c.match(req.url);
  if (!res) {
    try { res = await fetch(req.url); if (!res.ok) return res; c.put(req.url, res.clone()); } catch (_) { return Response.error(); }
  }
  const range = req.headers.get('range'); if (!range) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength, m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (!m[1] && m[2]) { start = Math.max(0, size - +m[2]); end = size - 1; }
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(end - start + 1), 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes' } });
}
