/** @type {import('next').NextConfig} */
const isAndroidStaticExport = process.env.ANDROID_STATIC_EXPORT === '1';

const nextConfig = {
  ...(isAndroidStaticExport ? { output: 'export' } : {}),
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'c.saavncdn.com' },
      { protocol: 'https', hostname: 'i.scdn.co' },
    ],
  },
};

module.exports = nextConfig;
