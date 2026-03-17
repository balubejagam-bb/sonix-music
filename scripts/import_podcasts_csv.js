const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { parse } = require('csv-parse/sync');

const MONGODB_URI = 'mongodb+srv://warehouse:warehouse123@warehouse.tyeqodb.mongodb.net/?appName=warehouse';
const DB_NAME = 'sonix_music';

async function importCsvPodcasts() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db(DB_NAME);
    const collection = db.collection('podcasts');

    const csvPath = 'c:/Users/balub/Downloads/archive/music-app/best_podcast_train.csv';
    console.log(`Processing ${csvPath}...`);
    
    const content = fs.readFileSync(csvPath, 'utf-8');
    
    // Header: Episode_Length_minutes,Host_Popularity_percentage,Guest_Popularity_percentage,Number_of_Ads,Episode_Sentiment,mean_time,median_time,std_time,iqr1_time,iqr2_time,LE_podcast,LE_genre,LE_week,LE_time,sin_LE_week,cos_LE_week,sin_LE_time,cos_LE_time,mean_Genre,median_Genre,mean_Publication_Day,median_Publication_Day,mean_Publication_Time,median_Publication_Time,Podcast_Name,Episode_Title,Genre,Publication_Day,Publication_Time,LE_episode,Listening_Time_minutes
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true
    });

    const formatted = records.map(r => ({
      title: r.Episode_Title || 'Unknown Episode',
      artist: r.Podcast_Name || 'Unknown Podcast',
      genre: r.Genre || '',
      source: 'podcast_csv',
      type: 'podcast',
      duration: parseFloat(r.Episode_Length_minutes) * 60 || 0,
      createdAt: new Date()
    })).filter(r => r.title && r.artist);

    if (formatted.length > 0) {
      // Import in chunks of 500
      const chunkSize = 500;
      for (let i = 0; i < formatted.length; i += chunkSize) {
        const chunk = formatted.slice(i, i + chunkSize);
        const ops = chunk.map(doc => ({
          updateOne: {
            filter: { title: doc.title, artist: doc.artist },
            update: { $set: doc },
            upsert: true
          }
        }));
        await collection.bulkWrite(ops);
        console.log(`Imported ${i + chunk.length} / ${formatted.length}`);
      }
    }

    console.log(`DONE! Total CSV records processed: ${formatted.length}`);

  } catch (err) {
    console.error('Import error:', err);
  } finally {
    await client.close();
  }
}

importCsvPodcasts();
