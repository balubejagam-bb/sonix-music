import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import clientPromise from '@/lib/mongodb';
import { signToken } from '@/lib/auth';

export async function POST(request) {
  try {
    const { name, email, password } = await request.json();
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedName = (name || '').trim();

    if (!normalizedName || !normalizedEmail || !password)
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });

    if (password.length < 6)
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

    const client = await clientPromise;
    const db = client.db('sonix_music');
    const users = db.collection('users');

    const existing = await users.findOne({ email: normalizedEmail });
    if (existing)
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });

    const hashedPassword = await bcrypt.hash(password, 12);
    const userDoc = {
      name: normalizedName,
      email: normalizedEmail,
      password: hashedPassword,
      profileImage: '',
      likedSongs: [],
      recentlyPlayed: [],
      recentSongObjects: [],
      library: [],
      playlists: [],
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const inserted = await users.insertOne(userDoc);
    const user = { ...userDoc, _id: inserted.insertedId };

    const token = signToken({ userId: user._id.toString(), email: user.email });

    const response = NextResponse.json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, profileImage: user.profileImage },
    }, { status: 201 });

    response.cookies.set('sonix_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
