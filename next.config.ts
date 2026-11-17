import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.AIRE_LEAD_PREVIEW === '1' ? '.next-lead-preview' : '.next',
  serverExternalPackages: ['@electric-sql/pglite'],
  outputFileTracingIncludes: {
    '/api/ai-sales/contact-research': ['./tests/fixtures/option1-apollo-replay.json'],
  },
};
export default nextConfig;
