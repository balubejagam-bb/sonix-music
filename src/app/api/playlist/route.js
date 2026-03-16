import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import Playlist from '@/models/Playlist';
import User from '@/models/User';
import { requireAuth } from '@/lib/auth';

// GET /api/playlist — get user's playlists
export async function GET(request) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const playlists = await Playlist.find({ userId: decoded.userId });
  return NextResponse.json({ playlists });
}

// POST /api/playlist — create playlist
export async function POST(request) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, isPublic } = await request.json();
  if (!name) return NextResponse.json({ error: 'Playlist name required' }, { status: 400 });

  await connectDB();
  const playlist = await Playlist.create({ name, userId: decoded.userId, isPublic: !!isPublic });

  // Link to user
  await User.findByIdAndUpdate(decoded.userId, { $push: { playlists: playlist._id } });

  return NextResponse.json({ success: true, playlist }, { status: 201 });
}
