/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'c.saavncdn.com' },
      { protocol: 'https', hostname: 'i.scdn.co' },
    ],
  },
};

module.exports = nextConfig;
