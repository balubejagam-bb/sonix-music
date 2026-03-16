import './globals.css';
import { AuthProvider } from '@/lib/authContext';

export const metadata = {
  title: 'Sonix Music – Ad-Free Music Streaming',
  description: 'Premium ad-free music player with 85,000+ songs. Background playback, offline caching, smart playlists.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎵</text></svg>" />
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
