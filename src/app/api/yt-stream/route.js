/**
 * /api/yt-stream?videoId=xxx
 * Resolves a YouTube videoId to a direct audio stream URL.
 * Tries all Invidious + Piped instances in parallel, returns first success.
 * Server-side cache: 25 minutes (stream URLs expire ~6h but we refresh early).
 */
import { NextResponse } from 'next/server';

const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://invidious.protokolla.fi',
  'https://yt.artemislena.eu',
  'https://invidious.perennialte.ch',
  'https://iv.datura.network',
  'https://invidious.fdn.fr',
  'https://invidious.lunar.icu',
  'https://invidious.reallyaweso.me',
  'https://invidious.snopyta.org',
  'https://invidious.weblibre.org',
  'https://invidious.tiekoetter.com',
  'https://invidious.0011.lt',
  'https://invidious.ggc-project.de',
  'https://invidious.hub.ne.kr',
  'https://invidious.private.coffee',
  'https://invidious.esmailelbob.xyz',
  'https://invidious.projectsegfau.lt',
  'https://yewtu.be',
  'https://inv.tux.pizza',
  'https://invidious.flokinet.to',
];

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://watchapi.whatever.social',
  'https://pipedapi.in.projectsegfau.lt',
  'https://api.piped.yt',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://pipedapi.qdi.fi',
  'https://pipedapi.drgns.space',
  'https://pipedapi.astartes.nl',
];

// Server-side stream cache: videoId → { url, ts }
const streamCache = globalThis.__sonix_stream_cache || new Map();
if (!globalThis.__sonix_stream_cache) globalThis.__sonix_stream_cache = streamCache;
const CACHE_TTL = 25 * 60 * 1000; // 25 min

// In-flight dedup: videoId → Promise<string|null>
const inFlight = globalThis.__sonix_stream_inflight || new Map();
if (!globalThis.__sonix_stream_inflight) globalThis.__sonix_stream_inflight = inFlight;

function getCachedStream(videoId) {
  const e = streamCache.get(videoId);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { streamCache.delete(videoId); return null; }
  return e.url;
}

function setCachedStream(videoId, url) {
  streamCache.set(videoId, { url, ts: Date.now() });
  if (streamCache.size > 500) {
    const oldest = [...streamCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    streamCache.delete(oldest[0]);
  }
}

async function tryInvidious(instance, videoId) {
  const res = await fetch(
    `${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams`,
    { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } }
  );
  if (!res.ok) return null;
  const data = await res.json();

  // Prefer adaptive audio-only formats (higher quality)
  const adaptive = (data.adaptiveFormats || [])
    .filter(f => f.type?.includes('audio') && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (adaptive.length) return adaptive[0].url;

  // Fallback: combined format streams
  const combined = (data.formatStreams || []).filter(f => f.url);
  if (combined.length) return combined[0].url;

  return null;
}

async function tryPiped(instance, videoId) {
  const res = await fetch(
    `${instance}/streams/${videoId}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.audioStreams?.length) {
    const best = [...data.audioStreams].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    return best.url || null;
  }
  return null;
}

async function resolveStream(videoId) {
  // Check cache first
  const cached = getCachedStream(videoId);
  if (cached) return cached;

  // Dedup concurrent requests for same videoId
  if (inFlight.has(videoId)) return inFlight.get(videoId);

  const promise = (async () => {
    try {
      // Race all instances in parallel — first non-null wins
      const tasks = [
        ...INVIDIOUS.map(inst => tryInvidious(inst, videoId).catch(() => null)),
        ...PIPED.map(inst => tryPiped(inst, videoId).catch(() => null)),
      ];

      // Use a manual race that resolves on first truthy value
      const url = await new Promise((resolve) => {
        let settled = 0;
        const total = tasks.length;
        tasks.forEach(p =>
          p.then(result => {
            if (result) resolve(result);
            else if (++settled === total) resolve(null);
          }).catch(() => { if (++settled === total) resolve(null); })
        );
      });

      if (url) setCachedStream(videoId, url);
      return url;
    } finally {
      inFlight.delete(videoId);
    }
  })();

  inFlight.set(videoId, promise);
  return promise;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId')?.trim();

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid videoId' }, { status: 400 });
  }

  const url = await resolveStream(videoId);
  if (!url) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
  }

  return NextResponse.json({ videoId, streamUrl: url });
}
