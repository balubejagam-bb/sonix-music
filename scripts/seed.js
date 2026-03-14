const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const uri = 'mongodb+srv://warehouse:warehouse123@warehouse.tyeqodb.mongodb.net/?appName=warehouse';

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    rows.push(obj);
  }
  return rows;
}

async function seed() {
  console.log('🎵 Sonix Music - Database Seeder');
  console.log('================================');
  
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('sonix_music');
    
    // Drop all existing collections
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.dropCollection(col.name);
      console.log(`🗑️  Dropped collection: ${col.name}`);
    }
    
    // Parse songs.csv
    const songsPath = path.join(__dirname, '..', '..', 'songs.csv');
    console.log('\n📄 Parsing songs.csv...');
    const songsRaw = parseCSV(songsPath);
    
    const songs = songsRaw.map((s, i) => ({
      songId: s.id || `song_${i}`,
      title: s.title || 'Unknown',
      album: s.album || 'Unknown',
      year: parseInt(s.year) || 0,
      image: s.image || '',
      artist: s.artist || 'Unknown',
      url: s.url || '',
      duration: parseInt(s.duration) || 0,
      source: 'jiosaavn',
      popularity: Math.floor(Math.random() * 100),
      genre: categorizeGenre(s.title, s.artist, s.album),
    }));
    
    console.log(`   Found ${songs.length} songs`);
    
    // Parse spotify_tracks.csv
    const spotifyPath = path.join(__dirname, '..', '..', 'spotify_tracks.csv');
    console.log('📄 Parsing spotify_tracks.csv...');
    const spotifyRaw = parseCSV(spotifyPath);
    
    const spotifyTracks = spotifyRaw.map((s, i) => ({
      songId: s.track_id || `spotify_${i}`,
      title: (s.track_name || 'Unknown').replace(/^"|"$/g, ''),
      album: (s.album_name || 'Unknown').replace(/^"|"$/g, ''),
      year: parseInt(s.year) || 0,
      image: s.artwork_url || '',
      artist: (s.artist_name || 'Unknown').replace(/^"|"$/g, ''),
      url: s.track_url || '',
      duration: Math.round((parseFloat(s.duration_ms) || 0) / 1000),
      source: 'spotify',
      popularity: parseInt(s.popularity) || 0,
      danceability: parseFloat(s.danceability) || 0,
      energy: parseFloat(s.energy) || 0,
      valence: parseFloat(s.valence) || 0,
      tempo: parseFloat(s.tempo) || 0,
      language: s.language || 'Unknown',
      genre: categorizeGenre(
        (s.track_name || '').replace(/^"|"$/g, ''),
        (s.artist_name || '').replace(/^"|"$/g, ''),
        (s.album_name || '').replace(/^"|"$/g, '')
      ),
    }));
    
    console.log(`   Found ${spotifyTracks.length} tracks`);
    
    // Insert songs
    console.log('\n💾 Inserting songs into MongoDB...');
    if (songs.length > 0) {
      const batchSize = 5000;
      for (let i = 0; i < songs.length; i += batchSize) {
        const batch = songs.slice(i, i + batchSize);
        await db.collection('songs').insertMany(batch);
        console.log(`   Inserted songs batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(songs.length/batchSize)}`);
      }
    }
    
    // Insert spotify tracks
    console.log('💾 Inserting Spotify tracks into MongoDB...');
    if (spotifyTracks.length > 0) {
      const batchSize = 5000;
      for (let i = 0; i < spotifyTracks.length; i += batchSize) {
        const batch = spotifyTracks.slice(i, i + batchSize);
        await db.collection('spotify_tracks').insertMany(batch);
        console.log(`   Inserted Spotify batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(spotifyTracks.length/batchSize)}`);
      }
    }
    
    // Create indexes
    console.log('\n🔍 Creating indexes...');
    await db.collection('songs').createIndex({ title: 'text', artist: 'text', album: 'text' });
    await db.collection('songs').createIndex({ popularity: -1 });
    await db.collection('songs').createIndex({ year: -1 });
    await db.collection('songs').createIndex({ genre: 1 });
    
    await db.collection('spotify_tracks').createIndex({ title: 'text', artist: 'text', album: 'text' });
    await db.collection('spotify_tracks').createIndex({ popularity: -1 });
    await db.collection('spotify_tracks').createIndex({ year: -1 });
    await db.collection('spotify_tracks').createIndex({ language: 1 });
    await db.collection('spotify_tracks').createIndex({ genre: 1 });
    
    console.log('✅ Indexes created');
    
    // Create playlists
    console.log('\n🎶 Creating smart playlists...');
    const topSongs = songs.slice().sort((a, b) => b.popularity - a.popularity).slice(0, 50);
    const recentSongs = songs.filter(s => s.year >= 2022).sort((a, b) => b.year - a.year).slice(0, 50);
    const classicSongs = songs.filter(s => s.year <= 2005 && s.year > 0).sort((a, b) => b.popularity - a.popularity).slice(0, 50);
    
    const topSpotify = spotifyTracks.filter(s => s.popularity > 50).sort((a, b) => b.popularity - a.popularity).slice(0, 50);
    const energyHits = spotifyTracks.filter(s => s.energy > 0.8).sort((a, b) => b.popularity - a.popularity).slice(0, 50);
    const chillVibes = spotifyTracks.filter(s => s.energy < 0.4 && s.valence > 0.3).sort((a, b) => b.popularity - a.popularity).slice(0, 50);
    
    const playlists = [
      { name: '🔥 Trending Now', description: 'Most popular tracks right now', songIds: topSongs.map(s => s.songId), collection: 'songs', cover: topSongs[0]?.image || '', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
      { name: '✨ Fresh Releases', description: 'Latest hits from 2022-2024', songIds: recentSongs.map(s => s.songId), collection: 'songs', cover: recentSongs[0]?.image || '', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
      { name: '👑 Timeless Classics', description: 'Evergreen hits that never fade', songIds: classicSongs.map(s => s.songId), collection: 'songs', cover: classicSongs[0]?.image || '', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
      { name: '🎧 Spotify Hot 50', description: 'Top tracks from Spotify', songIds: topSpotify.map(s => s.songId), collection: 'spotify_tracks', cover: topSpotify[0]?.image || '', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
      { name: '⚡ High Energy', description: 'Pump up the adrenaline', songIds: energyHits.map(s => s.songId), collection: 'spotify_tracks', cover: energyHits[0]?.image || '', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
      { name: '🌙 Chill Vibes', description: 'Relax and unwind', songIds: chillVibes.map(s => s.songId), collection: 'spotify_tracks', cover: chillVibes[0]?.image || '', gradient: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
    ];
    
    await db.collection('playlists').insertMany(playlists);
    console.log(`✅ Created ${playlists.length} playlists`);
    
    // Summary
    const songCount = await db.collection('songs').countDocuments();
    const spotifyCount = await db.collection('spotify_tracks').countDocuments();
    console.log('\n=============================');
    console.log('🎉 Seeding Complete!');
    console.log(`   Songs: ${songCount}`);
    console.log(`   Spotify Tracks: ${spotifyCount}`);
    console.log(`   Playlists: ${playlists.length}`);
    console.log('=============================');
    
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.close();
  }
}

function categorizeGenre(title, artist, album) {
  const combined = `${title} ${artist} ${album}`.toLowerCase();
  if (combined.includes('dj') || combined.includes('remix') || combined.includes('party') || combined.includes('dance')) return 'Party';
  if (combined.includes('love') || combined.includes('prema') || combined.includes('kadhal') || combined.includes('romance')) return 'Romance';
  if (combined.includes('sad') || combined.includes('pain') || combined.includes('heart')) return 'Emotional';
  if (combined.includes('devotional') || combined.includes('god') || combined.includes('temple') || combined.includes('shiva') || combined.includes('rama') || combined.includes('krishna') || combined.includes('hanuman') || combined.includes('govinda')) return 'Devotional';
  if (combined.includes('folk') || combined.includes('village')) return 'Folk';
  if (combined.includes('mass') || combined.includes('intro') || combined.includes('theme') || combined.includes('action')) return 'Mass';
  return 'Melody';
}

seed();
