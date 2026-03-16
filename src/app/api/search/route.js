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

  const [songs, spotifyTracks] = await Promise.all([
    db.collection('songs').find(filter).limit(limit).toArray(),
    db.collection('spotify_tracks').find(filter).limit(limit).toArray(),
  ]);

  return [...songs, ...spotifyTracks]
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

    // 1. Search MongoDB first
    const dbResults = await searchDB(db, q);

    if (dbResults.length >= 5) {
      // Enough DB results — skip YouTube entirely
      return NextResponse.json({ songs: dbResults, source: 'db', ytResults: [] });
    }

    // 2. Check cache for YouTube results
    const cached = await getCached(q);
    if (cached) {
      return NextResponse.json({ songs: dbResults, source: 'hybrid', ytResults: cached });
    }

    // 3. YouTube Data API v3 (quota-tracked)
    let ytResults = await searchYouTubeAPI(q, 8);

    // 4. Fallback: Piped + Invidious in parallel
    if (!ytResults?.length) {
      const [pipedRes, invRes] = await Promise.allSettled([
        searchWithPipedDirect(q, true),
        searchWithInvidiousDirect(q, true),
      ]);

      const merged = [], seen = new Set();
      for (const r of [pipedRes, invRes]) {
        if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
        for (const v of r.value) {
          if (!v?.videoId || seen.has(v.videoId)) continue;
          seen.add(v.videoId);
          merged.push(v);
        }
      }
      ytResults = merged.slice(0, 10);
    }

    if (ytResults?.length) await setCached(q, ytResults);

    return NextResponse.json({
      songs: dbResults,
      source: dbResults.length ? 'hybrid' : 'youtube',
      ytResults: ytResults || [],
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
