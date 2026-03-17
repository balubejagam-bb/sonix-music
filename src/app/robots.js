export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: 'https://sonix-music.vercel.app/sitemap.xml',
    host: 'https://sonix-music.vercel.app',
  };
}
