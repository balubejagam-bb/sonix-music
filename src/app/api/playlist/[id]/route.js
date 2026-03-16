import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import Playlist from '@/models/Playlist';
import { requireAuth } from '@/lib/auth';

// GET /api/playlist/:id
export async function GET(request, { params }) {
  await connectDB();
  const playlist = await Playlist.findById(params.id);
  if (!playlist) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ playlist });
}

// PUT /api/playlist/:id — add/remove song
export async function PUT(request, { params }) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const playlist = await Playlist.findById(params.id);
  if (!playlist) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (playlist.userId.toString() !== decoded.userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action, songId } = await request.json();
  if (action === 'add') {
    await Playlist.findByIdAndUpdate(params.id, { $addToSet: { songs: songId } });
  } else if (action === 'remove') {
    await Playlist.findByIdAndUpdate(params.id, { $pull: { songs: songId } });
  }
  return NextResponse.json({ success: true });
}

// DELETE /api/playlist/:id
export async function DELETE(request, { params }) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const playlist = await Playlist.findById(params.id);
  if (!playlist) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (playlist.userId.toString() !== decoded.userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await playlist.deleteOne();
  return NextResponse.json({ success: true });
}
