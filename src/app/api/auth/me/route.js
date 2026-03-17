import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise from '@/lib/mongodb';
import { requireAuth } from '@/lib/auth';

export async function GET(request) {
  try {
    const decoded = requireAuth(request);
    if (!decoded)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const client = await clientPromise;
    const db = client.db('sonix_music');
    const users = db.collection('users');

    let objectId;
    try {
      objectId = new ObjectId(decoded.userId);
    } catch {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = await users.findOne(
      { _id: objectId },
      { projection: { password: 0 } }
    );
    if (!user)
      return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 });
  }
}
