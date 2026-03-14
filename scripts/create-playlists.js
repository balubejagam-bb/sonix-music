const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://warehouse:warehouse123@warehouse.tyeqodb.mongodb.net/?appName=warehouse';

async function createPlaylists() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('sonix_music');
    
    try { await db.dropCollection('playlists'); } catch(e) {}
    
    const topSongs = await db.collection('songs').find({}).sort({ popularity: -1 }).limit(50).toArray();
    const recentSongs = await db.collection('songs').find({ year: { $gte: 2022 } }).sort({ year: -1 }).limit(50).toArray();
    const classicSongs = await db.collection('songs').find({ year: { $lte: 2005, $gt: 0 } }).sort({ popularity: -1 }).limit(50).toArray();
    const topSpotify = await db.collection('spotify_tracks').find({ popularity: { $gt: 50 } }).sort({ popularity: -1 }).limit(50).toArray();
    const energyHits = await db.collection('spotify_tracks').find({ energy: { $gt: 0.8 } }).sort({ popularity: -1 }).limit(50).toArray();
    const chillVibes = await db.collection('spotify_tracks').find({ energy: { $lt: 0.4 }, valence: { $gt: 0.3 } }).sort({ popularity: -1 }).limit(50).toArray();
    const devotional = await db.collection('songs').find({ genre: 'Devotional' }).sort({ popularity: -1 }).limit(50).toArray();
    const party = await db.collection('songs').find({ genre: 'Party' }).sort({ popularity: -1 }).limit(50).toArray();
    
    const playlists = [
      { name: '🔥 Trending Now', description: 'Most popular tracks right now', songIds: topSongs.map(s => s.songId), collection: 'songs', cover: topSongs[0]?.image || '', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
      { name: '✨ Fresh Releases', description: 'Latest hits from 2022-2024', songIds: recentSongs.map(s => s.songId), collection: 'songs', cover: recentSongs[0]?.image || '', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
      { name: '👑 Timeless Classics', description: 'Evergreen hits that never fade', songIds: classicSongs.map(s => s.songId), collection: 'songs', cover: classicSongs[0]?.image || '', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
      { name: '🎧 Spotify Hot 50', description: 'Top tracks from Spotify', songIds: topSpotify.map(s => s.songId), collection: 'spotify_tracks', cover: topSpotify[0]?.image || '', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
      { name: '⚡ High Energy', description: 'Pump up the adrenaline', songIds: energyHits.map(s => s.songId), collection: 'spotify_tracks', cover: energyHits[0]?.image || '', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
      { name: '🌙 Chill Vibes', description: 'Relax and unwind', songIds: chillVibes.map(s => s.songId), collection: 'spotify_tracks', cover: chillVibes[0]?.image || '', gradient: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
      { name: '🙏 Devotional', description: 'Spiritual and devotional songs', songIds: devotional.map(s => s.songId), collection: 'songs', cover: devotional[0]?.image || '', gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
      { name: '🎉 Party Mix', description: 'Dance floor bangers', songIds: party.map(s => s.songId), collection: 'songs', cover: party[0]?.image || '', gradient: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)' },
    ];
    
    await db.collection('playlists').insertMany(playlists);
    console.log(`✅ Created ${playlists.length} playlists`);
  } finally {
    await client.close();
  }
}

createPlaylists();
