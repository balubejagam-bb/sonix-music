import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import User from '@/models/User';
import { requireAuth } from '@/lib/auth';

// POST /api/user/recent/:songId — record a play with full song object
export async function POST(request, { params }) {
  try {
    const decoded = requireAuth(request);
    if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const songId = params?.songId;
    if (!songId || typeof songId !== 'string') {
      return NextResponse.json({ success: true });
    }

    await connectDB();

    // Parse full song object from body (optional — graceful fallback to ID only)
    let songObj = null;
    try {
      const body = await request.json();
      if (body && body.title) songObj = body;
    } catch {}

    // Always update the ID list
    await User.findByIdAndUpdate(decoded.userId, {
      $pull: { recentlyPlayed: songId },
    });
    await User.findByIdAndUpdate(decoded.userId, {
      $push: { recentlyPlayed: { $each: [songId], $position: 0, $slice: 20 } },
    });

    // Also update the full song objects array if we have one
    if (songObj) {
      const snapshot = {
        songId: songObj.songId || songObj.videoId || songId,
        title: songObj.title || '',
        artist: songObj.artist || '',
        album: songObj.album || '',
        image: songObj.image || songObj.thumbnail || '',
        videoId: songObj.videoId || null,
        duration: songObj.duration || 0,
        source: songObj.source || 'internal',
      };

      // Remove existing entry with same ID, then push to front
      await User.findByIdAndUpdate(decoded.userId, {
        $pull: { recentSongObjects: { songId: snapshot.songId } },
      });
      await User.findByIdAndUpdate(decoded.userId, {
        $push: { recentSongObjects: { $each: [snapshot], $position: 0, $slice: 20 } },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Recent track update failed:', error);
    // Non-critical endpoint: avoid surfacing 500s that break playback UX.
    return NextResponse.json({ success: true });
  }
}
