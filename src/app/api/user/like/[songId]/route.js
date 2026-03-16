import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import User from '@/models/User';
import { requireAuth } from '@/lib/auth';

// POST /api/user/like/:songId
export async function POST(request, { params }) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const { songId } = params;

  await User.findByIdAndUpdate(decoded.userId, {
    $addToSet: { likedSongs: songId },
  });

  return NextResponse.json({ success: true, liked: true });
}

// DELETE /api/user/like/:songId
export async function DELETE(request, { params }) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const { songId } = params;

  await User.findByIdAndUpdate(decoded.userId, {
    $pull: { likedSongs: songId },
  });

  return NextResponse.json({ success: true, liked: false });
}
