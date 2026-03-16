import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import User from '@/models/User';
import { requireAuth } from '@/lib/auth';

// GET /api/user/library
export async function GET(request) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const user = await User.findById(decoded.userId).select('library');
  return NextResponse.json({ library: user?.library || [] });
}

// POST /api/user/library — save album or playlist
export async function POST(request) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { itemId } = await request.json();
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });

  await connectDB();
  await User.findByIdAndUpdate(decoded.userId, { $addToSet: { library: itemId } });
  return NextResponse.json({ success: true });
}

// DELETE /api/user/library — remove from library
export async function DELETE(request) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { itemId } = await request.json();
  await connectDB();
  await User.findByIdAndUpdate(decoded.userId, { $pull: { library: itemId } });
  return NextResponse.json({ success: true });
}
