export const dynamic = 'force-dynamic';

import clientPromise from '@/lib/mongodb';
import { NextResponse } from 'next/server';

const CACHE_TTL_MS = 5 * 60 * 1000;
const podcastsApiCache = globalThis.__SONIX_PODCASTS_API_CACHE || new Map();
if (!globalThis.__SONIX_PODCASTS_API_CACHE) {
  globalThis.__SONIX_PODCASTS_API_CACHE = podcastsApiCache;
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const search = searchParams.get('search') || '';
    const all = searchParams.get('all') === 'true';

    const cacheKey = JSON.stringify({ page, limit, search, all });
    const now = Date.now();
    const cached = podcastsApiCache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload);
    }

    const client = await clientPromise;
    const db = client.db('sonix_music');
    const collection = db.collection('podcasts');

    let query = {};
    const trimmedSearch = search.trim();
    const hasSearch = trimmedSearch.length > 0;
    if (hasSearch) {
      query.$text = { $search: trimmedSearch };
    }

    const skip = (page - 1) * limit;
    
    let docs;
    let total;

    async function runQuery(activeQuery) {
      if (all) {
        docs = await collection.find(activeQuery).toArray();
        total = docs.length;
      } else {
        [total, docs] = await Promise.all([
          collection.countDocuments(activeQuery),
          collection.find(activeQuery).skip(skip).limit(limit).toArray(),
        ]);
      }
    }

    try {
      await runQuery(query);
    } catch (dbError) {
      // Fallback: if text search/index is unavailable, use a regex OR query.
      if (!hasSearch) throw dbError;

      const safeSearch = escapeRegex(trimmedSearch);
      const fallbackQuery = {
        $or: [
          { title: { $regex: safeSearch, $options: 'i' } },
          { artist: { $regex: safeSearch, $options: 'i' } },
          { description: { $regex: safeSearch, $options: 'i' } },
        ],
      };

      await runQuery(fallbackQuery);
    }

    // Clean _id for JSON
    const results = docs.map((d) => ({
      ...d,
      _id: d?._id ? String(d._id) : undefined,
    }));

    const payload = {
      podcasts: results,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };

    podcastsApiCache.set(cacheKey, { ts: now, payload });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Podcasts API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch podcasts' }, { status: 500 });
  }
}
