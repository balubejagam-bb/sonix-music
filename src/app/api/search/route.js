export const dynamic = 'force-dynamic';

/**
 * Hybrid Search API
 * Flow: MongoDB → YouTube Data API v3 → Piped/Invidious (direct, no self-call)
 */

import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { searchYouTubeAPI } from '@/lib/youtubeApi';
import { getCached, setCached } from '@/lib/searchCache';
import { searchWithPipedDirect, searchWithInvidiousDirect } from '@/lib/pipedSearch';

// Rate limiter: 60 req/min per IP
const rateLimitMap = globalThis.__sonix_rl || new Map();
if (!globalThis.__sonix_rl) globalThis.__sonix_rl = rateLimitMap;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 60_000) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= 60) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

function escapeRegex(str) {
  return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, (c) => '\\' + c);
}

async function searchDB(db, query, limit = 10) {
  const regex = new RegExp(escapeRegex(query), 'i');
  const filter = { $or: [{ title: regex }, { artist: regex }, { album: regex }] };

  const [songs, spotifyTracks, gaanaSongs] = await Promise.all([
    db.collection('songs').find(filter).limit(limit).toArray(),
    db.collection('spotify_tracks').find(filter).limit(limit).toArray(),
    db.collection('gaana_songs').find(filter).limit(limit).toArray(),
  ]);

  return [...songs, ...spotifyTracks, ...gaanaSongs]
    .slice(0, limit)
    .map(s => ({ ...s, _id: s._id.toString(), source: s.source || 'internal' }));
}

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ songs: [], source: 'db', ytResults: [] });

  try {
    const client = await clientPromise;
    const db = client.db('sonix_music');

    // Run DB search and YT search in parallel — always
    const [dbResults, ytFromPiped, ytFromInvidious] = await Promise.allSettled([
      searchDB(db, q),
      searchWithPipedDirect(q, true),
      searchWithInvidiousDirect(q, true),
    ]);

    const songs = dbResults.status === 'fulfilled' ? (dbResults.value || []) : [];

    // Check cache for YT results
    let ytResults = await getCached(q);

    if (!ytResults?.length) {
      // Merge Piped + Invidious results
      const merged = [], seen = new Set();
      for (const r of [ytFromPiped, ytFromInvidious]) {
        if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
        for (const v of r.value) {
          if (!v?.videoId || seen.has(v.videoId)) continue;
          seen.add(v.videoId);
          merged.push(v);
        }
      }
      ytResults = merged.slice(0, 12);
      if (ytResults.length) await setCached(q, ytResults);
    }

    return NextResponse.json({
      songs,
      source: songs.length ? 'hybrid' : 'youtube',
      ytResults: ytResults || [],
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
