import clientPromise from '@/lib/mongodb';
import { NextResponse } from 'next/server';

const CACHE_TTL_MS = 3 * 60 * 1000;
const songsApiCache = globalThis.__SONIX_SONGS_API_CACHE || new Map();
if (!globalThis.__SONIX_SONGS_API_CACHE) {
  globalThis.__SONIX_SONGS_API_CACHE = songsApiCache;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const search = searchParams.get('search') || '';
    const genre = searchParams.get('genre') || '';
    const sort = searchParams.get('sort') || 'popularity';
    const source = searchParams.get('source') || 'all';
    const year = searchParams.get('year') || '';
    const language = searchParams.get('language') || '';
    const all = searchParams.get('all') === 'true';

    const cacheKey = JSON.stringify({ page, limit, search, genre, sort, source, year, language, all });
    const now = Date.now();
    const cached = songsApiCache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload);
    }

    const client = await clientPromise;
    const db = client.db('sonix_music');

    let query = {};
    if (search) {
      query.$text = { $search: search };
    }
    if (genre) {
      query.genre = genre;
    }
    if (year) {
      query.year = parseInt(year);
    }
    if (language) {
      query.lang = language;
    }

    const sortObj = sort === 'year' ? { year: -1 } : sort === 'title' ? { title: 1 } : { popularity: -1 };
    const collections = source === 'spotify' ? ['spotify_tracks'] : source === 'jiosaavn' ? ['songs'] : ['songs', 'spotify_tracks'];

    const skip = (page - 1) * limit;
    const collectionResults = await Promise.all(
      collections.map(async (col) => {
        const collection = db.collection(col);
        const [count, docs] = await Promise.all([
          collection.countDocuments(query),
          all
            ? collection.find(query).sort(sortObj).toArray()
            : collection.find(query).sort(sortObj).skip(skip).limit(limit).toArray(),
        ]);
        return { count, docs };
      })
    );

    let results = collectionResults.flatMap((item) => item.docs);
    const total = collectionResults.reduce((sum, item) => sum + item.count, 0);

    // Clean _id for JSON
    results = results.map(r => ({ ...r, _id: r._id.toString() }));

    if (!all) {
      results = results.slice(0, limit);
    }

    const payload = {
      songs: results,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };

    songsApiCache.set(cacheKey, { ts: now, payload });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch songs' }, { status: 500 });
  }
}
