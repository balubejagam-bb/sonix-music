import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

export async function POST(request) {
  try {
    const data = await request.json();
    const client = await clientPromise;
    const db = client.db('sonix_music');
    const collection = db.collection('songs');

    const songs = Array.isArray(data) ? data : [data];
    
    // Basic validation and formatting
    const formattedSongs = songs.map(s => ({
      title: s.title || 'Unknown Title',
      artist: s.artist || 'Unknown Artist',
      album: s.album || 'Uploads',
      source: 'upload',
      createdAt: new Date(),
      // Add a unique ID if not present
      songId: s.songId || Math.random().toString(36).substring(7)
    }));

    const result = await collection.insertMany(formattedSongs);
    
    return NextResponse.json({ 
      success: true, 
      count: result.insertedCount,
      message: `${result.insertedCount} songs successfully indexed in Global Library.` 
    });
  } catch (e) {
    console.error('Upload API error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
