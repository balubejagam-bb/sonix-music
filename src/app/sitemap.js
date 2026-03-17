export default function sitemap() {
  const now = new Date();

  return [
    {
      url: 'https://sonix-music.vercel.app',
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
  ];
}
