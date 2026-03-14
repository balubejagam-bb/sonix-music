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
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
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

function parseDuration(dur) {
  if (!dur) return 0;
  const parts = dur.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(dur) || 0;
}

async function seedGaana() {
  console.log('🎵 Seeding Gaana Songs...');
  
  const filePath = path.join(__dirname, '..', '..', 'gaanasongs.csv');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  const headers = parseCSVLine(lines[0]);
  console.log('Headers:', headers);
  
  const songs = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const name = values[0] || '';
    const singer = (values[1] || '').split('|')[0].trim(); // Take first singer
    const allSingers = values[1] || '';
    const duration = parseDuration(values[3]);
    const link = values[4] || '';
    const language = values[5] || 'Hindi';
    
    songs.push({
      songId: `gaana_${i}`,
      title: name.replace(/^"|"$/g, ''),
      album: 'Gaana Music',
      year: 0,
      image: '',
      artist: singer.replace(/^"|"$/g, ''),
      allArtists: allSingers,
      url: link ? `https://gaana.com${link}` : '',
      duration: duration,
      source: 'gaana',
      popularity: Math.floor(Math.random() * 80) + 20,
      lang: language,
      genre: categorizeGenre(name, singer),
    });
  }
  
  console.log(`   Parsed ${songs.length} Gaana songs`);
  
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('sonix_music');
    
    // Drop existing gaana collection if any
    try { await db.dropCollection('gaana_songs'); } catch(e) {}
    
    // Insert in batches
    const batchSize = 5000;
    for (let i = 0; i < songs.length; i += batchSize) {
      const batch = songs.slice(i, i + batchSize);
      await db.collection('gaana_songs').insertMany(batch);
      console.log(`   Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(songs.length/batchSize)}`);
    }
    
    // Create indexes
    await db.collection('gaana_songs').createIndex(
      { title: 'text', artist: 'text' },
      { default_language: 'none', language_override: 'nonexistent_field' }
    );
    await db.collection('gaana_songs').createIndex({ popularity: -1 });
    await db.collection('gaana_songs').createIndex({ lang: 1 });
    await db.collection('gaana_songs').createIndex({ genre: 1 });
    console.log('✅ Indexes created');
    
    const count = await db.collection('gaana_songs').countDocuments();
    console.log(`\n🎉 Done! ${count} Gaana songs added to database`);
    
    // Get total counts
    const sc = await db.collection('songs').countDocuments();
    const stc = await db.collection('spotify_tracks').countDocuments();
    const gc = count;
    console.log(`📊 Total library: ${sc + stc + gc} songs (JioSaavn: ${sc}, Spotify: ${stc}, Gaana: ${gc})`);
    
  } finally {
    await client.close();
  }
}

function categorizeGenre(title, artist) {
  const combined = `${title} ${artist}`.toLowerCase();
  if (combined.includes('qawwal') || combined.includes('sabri') || combined.includes('nusrat')) return 'Qawwali';
  if (combined.includes('nabi') || combined.includes('allah') || combined.includes('khwaja') || combined.includes('dua') || combined.includes('mohammad') || combined.includes('maula')) return 'Devotional';
  if (combined.includes('ghazal') || combined.includes('mehdi') || combined.includes('ghulam ali') || combined.includes('begum')) return 'Ghazal';
  if (combined.includes('rafi') || combined.includes('lata') || combined.includes('kishore')) return 'Classic';
  if (combined.includes('love') || combined.includes('pyar') || combined.includes('mohabbat') || combined.includes('dil')) return 'Romance';
  if (combined.includes('sad') || combined.includes('gham') || combined.includes('dard')) return 'Emotional';
  return 'Melody';
}

seedGaana();
