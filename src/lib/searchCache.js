/**
 * Two-level cache for search results:
 * L1 — in-memory Map (fast, lost on restart)
 * L2 — MongoDB yt_cache collection (persistent)
 */

import clientPromise from './mongodb';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const memCache = globalThis.__sonix_search_cache || new Map();
if (!globalThis.__sonix_search_cache) globalThis.__sonix_search_cache = memCache;

function cacheKey(query) {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function getCached(query) {
  const key = cacheKey(query);

  // L1
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.ts < TTL_MS) return mem.data;

  // L2
  try {
    const client = await clientPromise;
    const db = client.db('sonix_music');
    const doc = await db.collection('yt_cache').findOne({ key });
    if (doc && Date.now() - doc.ts < TTL_MS) {
      memCache.set(key, { data: doc.data, ts: doc.ts });
      return doc.data;
    }
  } catch {}

  return null;
}

export async function setCached(query, data) {
  const key = cacheKey(query);
  const ts = Date.now();
  memCache.set(key, { data, ts });

  try {
    const client = await clientPromise;
    const db = client.db('sonix_music');
    await db.collection('yt_cache').updateOne(
      { key },
      { $set: { key, data, ts } },
      { upsert: true }
    );
  } catch {}
}

/**
 * Persist a YouTube song into the songs collection so future searches
 * hit the DB instead of calling YouTube API.
 */
export async function persistYouTubeSong(songData) {
  try {
    const client = await clientPromise;
    const db = client.db('sonix_music');
    await db.collection('songs').updateOne(
      { videoId: songData.videoId },
      { $set: { ...songData, source: 'youtube', updatedAt: new Date() }, $setOnInsert: { plays: 0, createdAt: new Date() } },
      { upsert: true }
    );
  } catch {}
}
