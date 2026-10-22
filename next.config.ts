import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/ai-sales/contact-research': ['./tests/fixtures/option1-apollo-replay.json'],
  },
};
export default nextConfig;
