const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://warehouse:warehouse123@warehouse.tyeqodb.mongodb.net/?appName=warehouse';

async function fixIndexes() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('sonix_music');
    
    // Rename 'language' field to 'lang' in spotify_tracks to avoid MongoDB text index conflict
    console.log('🔧 Renaming language field to lang in spotify_tracks...');
    await db.collection('spotify_tracks').updateMany({}, { $rename: { language: 'lang' } });
    console.log('✅ Field renamed');
    
    // Drop any existing text indexes
    try { await db.collection('spotify_tracks').dropIndex('title_text_artist_text_album_text'); } catch(e) {}
    
    // Create text index with language_override set to a non-existent field
    await db.collection('spotify_tracks').createIndex(
      { title: 'text', artist: 'text', album: 'text' },
      { default_language: 'none', language_override: 'nonexistent_field' }
    );
    console.log('✅ Spotify text index created');
    
    await db.collection('spotify_tracks').createIndex({ popularity: -1 });
    await db.collection('spotify_tracks').createIndex({ year: -1 });
    await db.collection('spotify_tracks').createIndex({ lang: 1 });
    await db.collection('spotify_tracks').createIndex({ genre: 1 });
    console.log('✅ Spotify other indexes created');
    
    // Verify
    const sc = await db.collection('songs').countDocuments();
    const stc = await db.collection('spotify_tracks').countDocuments();
    const pc = await db.collection('playlists').countDocuments();
    console.log(`\n📊 Database: ${sc} songs, ${stc} spotify tracks, ${pc} playlists`);
    console.log('🎉 All indexes fixed!');
    
  } finally {
    await client.close();
  }
}

fixIndexes();
