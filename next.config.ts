import type { NextConfig } from 'next';

// No server: the app is exported as static files and all data lives in the browser.
const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
