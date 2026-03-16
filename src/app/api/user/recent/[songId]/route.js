import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import User from '@/models/User';
import { requireAuth } from '@/lib/auth';

// POST /api/user/recent/:songId — record a play
export async function POST(request, { params }) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const { songId } = params;

  // Remove if already exists, then push to front, keep last 20
  await User.findByIdAndUpdate(decoded.userId, {
    $pull: { recentlyPlayed: songId },
  });
  await User.findByIdAndUpdate(decoded.userId, {
    $push: { recentlyPlayed: { $each: [songId], $position: 0, $slice: 20 } },
  });

  return NextResponse.json({ success: true });
}
