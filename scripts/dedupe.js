const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://warehouse:warehouse123@warehouse.tyeqodb.mongodb.net/?appName=warehouse';

async function deduplicate() {
  console.log('🧹 Starting database deduplication...');
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db('sonix_music');
    const collections = ['songs', 'spotify_tracks', 'gaana_songs'];
    
    for (const collName of collections) {
      console.log(`\nProcessing collection: ${collName}`);
      const coll = db.collection(collName);
      
      // We will identify duplicates by a combination of lowercase title and artist
      const cursor = coll.find({});
      const seen = new Set();
      const duplicates = [];
      
      let count = 0;
      for await (const doc of cursor) {
        count++;
        // Normalize title and artist for comparison
        const title = (doc.title || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        const artist = (doc.artist || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        const key = `${title}-${artist}`;
        
        if (key && key !== '-') {
          if (seen.has(key)) {
            duplicates.push(doc._id);
          } else {
            seen.add(key);
          }
        }
      }
      
      console.log(`Found ${duplicates.length} duplicates out of ${count} total documents.`);
      
      if (duplicates.length > 0) {
        // Delete duplicates in batches
        const batchSize = 1000;
        for (let i = 0; i < duplicates.length; i += batchSize) {
          const batch = duplicates.slice(i, i + batchSize);
          await coll.deleteMany({ _id: { $in: batch } });
          console.log(`Deleted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(duplicates.length/batchSize)}`);
        }
        console.log(`✅ Removed ${duplicates.length} duplicate songs from ${collName}.`);
      }
    }
    
    console.log('\n🎉 Deduplication complete!');
  } finally {
    await client.close();
  }
}

deduplicate();
