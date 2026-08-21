/* Studio Batim — service worker.
 *
 * Its ONLY jobs are to make the app installable and to keep repeat loads
 * fast. It is deliberately not an offline app: this origin serves
 * per-project client data and staff data, and serving any of that from a
 * cache would be a correctness and privacy problem, not a feature.
 *
 * ── WHAT IS AND ISN'T CACHED ──────────────────────────────────────────
 *   /assets/*  → cache-first. Vite content-hashes these filenames, so a
 *                given URL's bytes can never change. Caching them is
 *                therefore incapable of serving a stale version — a new
 *                deploy simply requests different filenames.
 *   navigations → NETWORK-FIRST, falling back to /offline.html only when
 *                the network actually fails. The HTML is what points at
 *                the current asset hashes, so keeping it fresh is what
 *                makes the whole strategy safe.
 *   /api/*      → never touched. Not cached, not intercepted.
 *   Supabase and every other cross-origin request → never touched;
 *                handled entirely by the browser as if no SW existed.
 *
 * ── WHY THERE IS NO "STUCK ON AN OLD VERSION" CASE ───────────────────
 * No HTML and no application code is ever served from cache while the
 * network is up. Combined with skipWaiting + clients.claim, a deploy is
 * live on the very next navigation. This matters because production is
 * deployed several times a day.
 */

const VERSION     = 'sb-v1'
const SHELL_CACHE  = `sb-shell-${VERSION}`
const ASSET_CACHE  = `sb-assets-${VERSION}`

/* Only truly static, non-user-specific files. Nothing here depends on
   who is logged in. */
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      /* Added ONE BY ONE and tolerant of failure, deliberately.
         cache.addAll() is atomic: a single 404 rejects the whole call,
         install never completes, the new worker never activates — and
         the previous worker stays in control FOREVER. That is the only
         way a bad service worker can become unfixable by deploying,
         so it must not be possible. A missing icon costs us that icon,
         not the ability to ship a fix. */
      .then(cache => Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[sw] precache skipped:', url, err)
          })
        )
      ))
      /* Take over immediately rather than waiting for every tab to
         close — otherwise a fix could sit unused for days. */
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

/* Let the page tell a waiting worker to activate at once. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  /* Never interfere with writes. */
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  /* Cross-origin (Supabase, Google APIs, fonts) — hands off entirely. */
  if (url.origin !== self.location.origin) return

  /* The serverless functions must never be cached or replayed. */
  if (url.pathname.startsWith('/api/')) return

  /* ── Navigations: network-first, offline page as the fallback ── */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/offline.html', { cacheName: SHELL_CACHE })
          .then(res => res || Response.error())
      )
    )
    return
  }

  /* ── Hashed build assets: cache-first, safe by construction ── */
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req, { cacheName: ASSET_CACHE }).then(hit => {
        if (hit) return hit
        return fetch(req).then(res => {
          /* Only store complete, successful, same-origin responses —
             an opaque or partial response would poison the cache. */
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(ASSET_CACHE).then(c => c.put(req, copy))
          }
          return res
        })
      })
    )
    return
  }

  /* ── Precached static files ── */
  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req, { cacheName: SHELL_CACHE }).then(hit => hit || fetch(req))
    )
    return
  }

  /* Everything else falls through to the network untouched. */
})
