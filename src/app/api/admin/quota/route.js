export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getQuotaStatus } from '@/lib/youtubeApi';
import { requireAuth } from '@/lib/auth';
import { connectDB } from '@/lib/mongoose';
import User from '@/models/User';

export async function GET(request) {
  const decoded = requireAuth(request);
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const user = await User.findById(decoded.userId).select('isAdmin');
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json(getQuotaStatus());
}
