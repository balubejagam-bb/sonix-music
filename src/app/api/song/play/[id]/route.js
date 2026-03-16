/**
 * POST /api/song/play/:id
 * Increments play count. Also accepts YouTube song data to persist into DB.
 */

import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { persistYouTubeSong } from '@/lib/searchCache';

export async function POST(request, { params }) {
  try {
    const { id } = params;
    const body = await request.json().catch(() => ({}));

    // If this is a YouTube song being played for the first time, persist it
    if (body?.source === 'youtube' && body?.videoId) {
      await persistYouTubeSong({
        videoId: body.videoId,
        title: body.title || '',
        artist: body.artist || '',
        thumbnail: body.thumbnail || `https://img.youtube.com/vi/${body.videoId}/mqdefault.jpg`,
        source: 'youtube',
        plays: 1,
      });
      return NextResponse.json({ success: true, persisted: true });
    }

    // Increment play count for internal song
    const client = await clientPromise;
    const db = client.db('sonix_music');

    // Try both collections
    const [r1, r2] = await Promise.all([
      db.collection('songs').updateOne({ _id: id }, { $inc: { plays: 1 } }),
      db.collection('spotify_tracks').updateOne({ _id: id }, { $inc: { plays: 1 } }),
    ]);

    return NextResponse.json({ success: true, updated: (r1.modifiedCount + r2.modifiedCount) > 0 });
  } catch (error) {
    console.error('Play count error:', error);
    return NextResponse.json({ error: 'Failed to update play count' }, { status: 500 });
  }
}
