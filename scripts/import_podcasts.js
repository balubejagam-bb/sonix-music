const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { parse } = require('csv-parse/sync');

const MONGODB_URI = 'mongodb+srv://warehouse:warehouse123@warehouse.tyeqodb.mongodb.net/?appName=warehouse';
const DB_NAME = 'sonix_music';

async function importPodcasts() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db(DB_NAME);
    const collection = db.collection('podcasts');

    // Clear existing podcasts if needed (optional)
    // await collection.deleteMany({});

    const baseDir = 'c:/Users/balub/Downloads/archive/music-app/all-podcasts-dataset-master';
    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.tsv'));

    let totalImported = 0;

    for (const file of files) {
      console.log(`Processing ${file}...`);
      const filePath = path.join(baseDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      const records = parse(content, {
        delimiter: '\t',
        columns: ['slug', 'name', 'image_url', 'feed_url', 'website_url', 'itunes_owner_name', 'itunes_owner_email', 'managing_editor_name', 'managing_editor_email', 'explicit', 'description', 'itunes_summary'],
        skip_empty_lines: true,
        relax_column_count: true
      });

      const formatted = records.map(r => ({
        title: r.name || 'Unknown Podcast',
        artist: r.itunes_owner_name || 'Unknown Author',
        image: r.image_url || '',
        thumbnail: r.image_url || '',
        url: r.feed_url || '',
        website: r.website_url || '',
        description: r.description || r.itunes_summary || '',
        source: 'podcast',
        type: 'podcast',
        explicit: r.explicit === 'true',
        createdAt: new Date()
      })).filter(r => r.title && r.url);

      if (formatted.length > 0) {
        // Chunk records to prevent total timeout on huge datasets
        const CHUNK_SIZE = 500;
        for (let i = 0; i < formatted.length; i += CHUNK_SIZE) {
          const chunk = formatted.slice(i, i + CHUNK_SIZE);
          const ops = chunk.map(doc => ({
            updateOne: {
              filter: { url: doc.url },
              update: { $set: doc },
              upsert: true
            }
          }));
          
          try {
            await collection.bulkWrite(ops, { ordered: false });
            totalImported += chunk.length;
            if (totalImported % 5000 === 0) {
              console.log(`Imported ${totalImported} podcasts total...`);
            }
          } catch (writeErr) {
            console.warn(`Bulk write partial failure in ${file}:`, writeErr.message);
          }
        }
        console.log(`Finished ${file}. Total imported so far: ${totalImported}`);
      }
    }

    console.log(`DONE! Total podcasts in DB: ${totalImported}`);

    // Create indexes
    await collection.createIndex({ title: 'text', artist: 'text' });
    console.log('Indexes created.');

  } catch (err) {
    console.error('Import error:', err);
  } finally {
    await client.close();
  }
}

importPodcasts();
