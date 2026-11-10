/*
 * Service Worker der Bücherei: von Hand geschrieben, ohne Bibliothek, nur gleiche Herkunft.
 *  - App-Gerüst: wird beim Installieren vorab gespeichert (Dateiliste `sw-dateien.json`, erzeugt von tools/sw-dateien.mjs).
 *  - Bücherliste und Suchindex: Netz zuerst, ohne Netz der zuletzt gesehene Stand.
 *  - Bücher: jedes Buch liegt in einem eigenen Cache `buch-<id>`; die Seite füllt und löscht ihn (core/offline.ts).
 *  - Filme (MP4): gehen am Worker vorbei direkt ans Netz (gross, werden in Teilstücken geladen, nie vorab gespeichert).
 * VERSION wird beim Bauen eingesetzt (tools/sw-dateien.mjs), damit jeder Bau einen neuen Worker ergibt.
 */
'use strict';

const VERSION = 'ece4e4356771';
const GERUEST_PRAEFIX = 'geruest-';
const GERUEST_CACHE = GERUEST_PRAEFIX + VERSION;
const BUCH_PRAEFIX = 'buch-'; // gleich wie CACHE_PRAEFIX in core/offline.ts
const DATEILISTE = 'sw-dateien.json';
const START_SEITE = 'index.html';

const BASIS = new URL('./', self.registration.scope).pathname;
const BUECHER = BASIS + 'buecher/';
const LISTEN = [BUECHER + 'index.json', BUECHER + 'suche.json'];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(geruestSpeichern());
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil(alteGeruesteLoeschen().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  const adresse = new URL(anfrage.url);
  if (anfrage.method !== 'GET' || adresse.origin !== self.location.origin) return;
  if (anfrage.destination === 'video' || adresse.pathname.endsWith('.mp4')) return;
  const istDatei = adresse.pathname.startsWith(BUECHER) && adresse.pathname.endsWith('.json');
  const istStartseite = anfrage.mode === 'navigate' && (adresse.pathname === BASIS || adresse.pathname === BASIS + START_SEITE);
  ereignis.respondWith(istDatei ? netzZuerst(anfrage, adresse) : cacheZuerst(istStartseite ? START_SEITE : anfrage));
});

async function geruestSpeichern() {
  const antwort = await fetch(DATEILISTE, { cache: 'reload' });
  const { dateien } = await antwort.json();
  const cache = await caches.open(GERUEST_CACHE);
  await cache.addAll(dateien.map((datei) => new Request(datei, { cache: 'reload' })));
}

async function alteGeruesteLoeschen() {
  const namen = await caches.keys();
  const veraltet = namen.filter((n) => n.startsWith(GERUEST_PRAEFIX) && n !== GERUEST_CACHE);
  await Promise.all(veraltet.map((n) => caches.delete(n)));
}

/** App-Gerüst, PDFs und alles Übrige: zuerst aus dem Cache, sonst aus dem Netz. Der Aufruf der Startseite liefert die gespeicherte index.html. */
async function cacheZuerst(anfrage) {
  const gespeichert = await caches.match(anfrage);
  return gespeichert ?? fetch(anfrage);
}

/** Bücherliste, Suchindex und Buchdaten: Netz zuerst, damit Änderungen ankommen; die Kopie im Cache wird aufgefrischt. */
async function netzZuerst(anfrage, adresse) {
  try {
    const antwort = await fetch(anfrage, { cache: 'no-cache' });
    if (antwort.ok) await kopieAuffrischen(anfrage, antwort.clone(), adresse);
    return antwort;
  } catch (fehler) {
    const gespeichert = await caches.match(anfrage);
    if (gespeichert) return gespeichert;
    throw fehler;
  }
}

/** Listen kommen ins Gerüst; Buchdaten nur dann in den Buch-Cache, wenn das Buch offline gespeichert wurde. */
async function kopieAuffrischen(anfrage, antwort, adresse) {
  const name = LISTEN.includes(adresse.pathname) ? GERUEST_CACHE : BUCH_PRAEFIX + buchId(adresse.pathname);
  if (name !== GERUEST_CACHE && !(await caches.has(name))) return;
  const cache = await caches.open(name);
  await cache.put(anfrage, antwort);
}

function buchId(pfad) {
  return decodeURIComponent(pfad.slice(BUECHER.length).split('/')[0]);
}
