const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { parse } = require('csv-parse');

const MONGODB_URI = 'mongodb+srv://warehouse:warehouse123@warehouse.tyeqodb.mongodb.net/?appName=warehouse';
const DB_NAME = 'sonix_music';

async function importSongs() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db(DB_NAME);
    const collection = db.collection('songs');
    const spotifyCollection = db.collection('spotify_tracks');

    const songsDir = 'c:/Users/balub/Downloads/archive/music-app/songs';

    // 1. Import spotify_tracks.csv (relatively small, 20MB)
    console.log('Importing spotify_tracks.csv...');
    const spotifyPath = path.join(songsDir, 'spotify_tracks.csv');
    if (fs.existsSync(spotifyPath)) {
      const parser = fs.createReadStream(spotifyPath).pipe(parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
      }));

      let count = 0;
      let batch = [];
      for await (const record of parser) {
        batch.push({
          updateOne: {
            filter: { songId: record.track_id },
            update: {
              $set: {
                songId: record.track_id,
                title: record.track_name,
                artist: record.artist_name,
                year: parseInt(record.year) || 0,
                popularity: parseInt(record.popularity) || 0,
                image: record.artwork_url,
                thumbnail: record.artwork_url,
                album: record.album_name,
                duration: (parseInt(record.duration_ms) / 1000) || 0,
                url: record.track_url,
                lang: record.language,
                source: 'spotify',
                type: 'song',
                updatedAt: new Date()
              }
            },
            upsert: true
          }
        });

        if (batch.length >= 1000) {
          await spotifyCollection.bulkWrite(batch);
          count += batch.length;
          console.log(`Imported ${count} tracks from spotify_tracks.csv`);
          batch = [];
        }
      }
      if (batch.length > 0) {
        await spotifyCollection.bulkWrite(batch);
        count += batch.length;
      }
      console.log(`Finished spotify_tracks.csv: ${count} total.`);
    }

    // 2. Import songs_with_attributes_and_lyrics.csv (HUGE, 1.5GB)
    console.log('Importing songs_with_attributes_and_lyrics.csv (this may take a while)...');
    const hugePath = path.join(songsDir, 'songs_with_attributes_and_lyrics.csv');
    if (fs.existsSync(hugePath)) {
      const parser = fs.createReadStream(hugePath).pipe(parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        quote: '"',
        escape: '"'
      }));

      let count = 0;
      let batch = [];
      for await (const record of parser) {
        // Clean artist string - sometimes it's like ["Artist Name"]
        let artist = record.artists || 'Unknown Artist';
        if (artist.startsWith('[') && artist.endsWith(']')) {
           try {
             const arr = JSON.parse(artist.replace(/'/g, '"'));
             artist = Array.isArray(arr) ? arr.join(', ') : artist;
           } catch (e) {}
        }

        batch.push({
          updateOne: {
            filter: { songId: record.id },
            update: {
              $set: {
                songId: record.id,
                title: record.name,
                artist: artist,
                album: record.album_name,
                lyrics: record.lyrics,
                duration: (parseInt(record.duration_ms) / 1000) || 0,
                source: 'generic',
                type: 'song',
                popularity: parseInt(record.popularity) || 50,
                updatedAt: new Date()
              }
            },
            upsert: true
          }
        });

        if (batch.length >= 2000) {
          await collection.bulkWrite(batch);
          count += batch.length;
          if (count % 10000 === 0) console.log(`Imported ${count} songs from huge set...`);
          batch = [];
        }
      }
      if (batch.length > 0) {
        await collection.bulkWrite(batch);
        count += batch.length;
      }
      console.log(`Finished huge CSV: ${count} total.`);
    }

    // Create Indexes
    await collection.createIndex({ title: 'text', artist: 'text', album: 'text' });
    await spotifyCollection.createIndex({ title: 'text', artist: 'text', album: 'text' });
    console.log('Indexes updated.');

  } catch (err) {
    console.error('Songs Import error:', err);
  } finally {
    await client.close();
  }
}

importSongs();
