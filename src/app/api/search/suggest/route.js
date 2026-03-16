/**
 * Instant suggest endpoint — fires on every keystroke (debounced on frontend).
 * Only hits MongoDB, never YouTube. Ultra-fast.
 */

import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json({ songs: [], artists: [] });

  try {
    const client = await clientPromise;
    const db = client.db('sonix_music');
    const regex = new RegExp('^' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const [songs, artists] = await Promise.all([
      db.collection('songs').find(
        { $or: [{ title: regex }, { artist: regex }] },
        { projection: { title: 1, artist: 1, thumbnail: 1, videoId: 1, source: 1 } }
      ).limit(8).toArray(),
      db.collection('artists').find(
        { name: regex },
        { projection: { name: 1, image: 1 } }
      ).limit(4).toArray(),
    ]);

    return NextResponse.json({
      songs: songs.map(s => ({ ...s, _id: s._id.toString() })),
      artists: artists.map(a => ({ ...a, _id: a._id.toString() })),
    });
  } catch {
    return NextResponse.json({ songs: [], artists: [] });
  }
}
