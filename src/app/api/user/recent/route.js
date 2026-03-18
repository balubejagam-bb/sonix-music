export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import User from '@/models/User';
import { requireAuth } from '@/lib/auth';

export async function GET(request) {
  try {
    const decoded = requireAuth(request);
    if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await connectDB();
    const user = await User.findById(decoded.userId).select('recentlyPlayed recentSongObjects');

    // Prefer full song objects; fall back to ID list
    const songs = user?.recentSongObjects?.length
      ? user.recentSongObjects
      : [];

    return NextResponse.json({
      recentlyPlayed: user?.recentlyPlayed || [],
      songs,
    });
  } catch (error) {
    console.error('Recent history fetch failed:', error);
    return NextResponse.json({ recentlyPlayed: [], songs: [] });
  }
}
