import clientPromise from '@/lib/mongodb';
import { NextResponse } from 'next/server';

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

    let results = [];
    let total = 0;

    for (const col of collections) {
      const count = await db.collection(col).countDocuments(query);
      total += count;

      if (all) {
        const docs = await db.collection(col).find(query).sort(sortObj).toArray();
        results.push(...docs);
      } else {
        const skip = (page - 1) * limit;
        const docs = await db.collection(col).find(query).sort(sortObj).skip(skip).limit(limit).toArray();
        results.push(...docs);
      }
    }

    // Clean _id for JSON
    results = results.map(r => ({ ...r, _id: r._id.toString() }));

    if (!all) {
      results = results.slice(0, limit);
    }

    return NextResponse.json({
      songs: results,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch songs' }, { status: 500 });
  }
}
