import clientPromise from '@/lib/mongodb';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db('sonix_music');
    const playlists = await db.collection('playlists').find({}).toArray();
    return NextResponse.json({
      playlists: playlists.map(p => ({ ...p, _id: p._id.toString() })),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch playlists' }, { status: 500 });
  }
}
