/* Banglar Tesla — offline cache so the installed PWA runs without a network. */
const CACHE = 'banglar-tesla-v7';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './fonts/HindSiliguri-Regular.ttf',
  './fonts/HindSiliguri-SemiBold.ttf',
  './fonts/HindSiliguri-Bold.ttf',
  './audio/music/menu-dhaka-sondhya.wav',
  './audio/music/drive-asad-groove.wav',
  './audio/music/drive-brishti-dusk.wav',
  './audio/ambience/dhaka-street-bed.wav',
  './audio/ambience/bazaar-crowd-loop.wav',
  './audio/ambience/tea-stall-clink.wav',
  './audio/ambience/hawker-call-1.wav',
  './audio/ambience/hawker-call-2.wav',
  './audio/ambience/construction-tap.wav',
  './audio/sfx/rickshaw-chain-loop.wav',
  './audio/sfx/tan-boost.wav',
  './audio/sfx/turbo-ignite.wav',
  './audio/sfx/turbo-loop.wav',
  './audio/sfx/turbo-release.wav',
  './audio/sfx/police-siren-loop.wav',
  './audio/sfx/crash-heavy.wav',
  './audio/sfx/lamp-crash.wav',
  './audio/sfx/stall-crash.wav',
  './audio/dialogue/roadrage-driver-cue.wav',
  './audio/dialogue/roadrage-driver-en.wav',
  './audio/dialogue/roadrage-player-cue.wav',
  './audio/dialogue/roadrage-player-en.wav',
  './audio/dialogue/rival-taunt-bn.wav',
  './audio/dialogue/rival-taunt-en.wav',
  './audio/dialogue/police-alert-bn.wav',
  './audio/dialogue/police-alert-en.wav',
  // vNext: Blacklist-critical Bangla lines + stings + weather beds (offline-first)
  './audio/dialogue/intro-league-1-bn.wav',
  './audio/dialogue/intro-league-2-bn.wav',
  './audio/dialogue/rival-raju-intro-bn.wav',
  './audio/dialogue/rival-raju-taunt-bn.wav',
  './audio/dialogue/rival-sumon-intro-bn.wav',
  './audio/dialogue/rival-sumon-taunt-bn.wav',
  './audio/dialogue/rival-tarek-intro-bn.wav',
  './audio/dialogue/rival-tarek-taunt-bn.wav',
  './audio/dialogue/rival-nabila-intro-bn.wav',
  './audio/dialogue/rival-nabila-taunt-bn.wav',
  './audio/dialogue/rival-halim-intro-bn.wav',
  './audio/dialogue/rival-halim-taunt-bn.wav',
  './audio/dialogue/rival-faisal-intro-bn.wav',
  './audio/dialogue/rival-faisal-taunt-bn.wav',
  './audio/dialogue/rival-badol-intro-bn.wav',
  './audio/dialogue/rival-badol-taunt-bn.wav',
  './audio/dialogue/rival-sakib-intro-bn.wav',
  './audio/dialogue/rival-sakib-taunt-bn.wav',
  './audio/dialogue/rival-ranga-intro-bn.wav',
  './audio/dialogue/rival-ranga-taunt-bn.wav',
  './audio/dialogue/rival-samrat-intro-bn.wav',
  './audio/dialogue/rival-samrat-taunt-bn.wav',
  './audio/music/sting-raju.wav',
  './audio/music/sting-sumon.wav',
  './audio/music/sting-tarek.wav',
  './audio/music/sting-nabila.wav',
  './audio/music/sting-halim.wav',
  './audio/music/sting-faisal.wav',
  './audio/music/sting-badol.wav',
  './audio/music/sting-sakib.wav',
  './audio/music/sting-ranga.wav',
  './audio/music/sting-samrat.wav',
  './audio/ambience/wind-gust-loop.wav',
  './audio/sfx/thunder-rumble-1.wav',
  './audio/sfx/thunder-rumble-2.wav',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first so an update lands, cache fallback when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Static assets: cache-first (hashed filenames make this safe).
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => hit || Response.error());
    }),
  );
});
