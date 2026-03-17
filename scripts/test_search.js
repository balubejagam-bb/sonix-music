const fetch = require('node-fetch');

async function testSearch() {
  const q = 'shannu podcast';
  const url = `http://localhost:3000/api/youtube-search?q=${encodeURIComponent(q)}&multi=true`;
  console.log(`Testing: ${url}`);
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log('Results count:', Array.isArray(data) ? data.length : (data.results?.length || 0));
    if (Array.isArray(data) && data.length > 0) {
      console.log('First result:', data[0].title);
    }
  } catch (e) {
    console.error('Test failed:', e.message);
  }
}

testSearch();
