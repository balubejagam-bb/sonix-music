/**
 * GET /api/songs/trending
 * Trending score = plays + (likes * 2) + recency bonus
 */

import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

const CACHE_TTL = 5 * 60 * 1000; // 5 min
let trendingCache = null;
let trendingCacheTs = 0;

export async function GET() {
  try {
    if (trendingCache && Date.now() - trendingCacheTs < CACHE_TTL) {
      return NextResponse.json({ songs: trendingCache });
    }

    const client = await clientPromise;
    const db = client.db('sonix_music');

    const songs = await db.collection('songs')
      .find({ plays: { $gt: 0 } })
      .sort({ plays: -1 })
      .limit(20)
      .toArray();

    const result = songs.map(s => ({ ...s, _id: s._id.toString() }));
    trendingCache = result;
    trendingCacheTs = Date.now();

    return NextResponse.json({ songs: result });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch trending' }, { status: 500 });
  }
}
