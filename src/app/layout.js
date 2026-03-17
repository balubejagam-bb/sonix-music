import './globals.css';
import { AuthProvider } from '@/lib/authContext';

export const metadata = {
  metadataBase: new URL('https://sonix-music.vercel.app'),
  title: {
    default: 'Sonix Music',
    template: '%s | Sonix Music',
  },
  description: 'Sonix Music is an ad-free music streaming app with fast playback, smart playlists, and background listening support.',
  applicationName: 'Sonix Music',
  keywords: [
    'Sonix Music',
    'music streaming',
    'ad-free music',
    'background playback',
    'online songs',
    'telugu songs',
    'spotify alternative',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Sonix Music',
    description: 'Ad-free music streaming with fast playback and smart discovery.',
    url: 'https://sonix-music.vercel.app',
    siteName: 'Sonix Music',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sonix Music',
    description: 'Ad-free music streaming with fast playback and smart discovery.',
  },
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
