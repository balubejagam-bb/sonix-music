export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import clientPromise from '@/lib/mongodb';
import { signToken } from '@/lib/auth';

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !password)
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });

    const client = await clientPromise;
    const db = client.db('sonix_music');
    const users = db.collection('users');

    const user = await users.findOne({ email: normalizedEmail });
    if (!user)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

    const token = signToken({ userId: user._id.toString(), email: user.email });

    const response = NextResponse.json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage, isAdmin: user.isAdmin },
    });

    response.cookies.set('sonix_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
