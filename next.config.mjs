/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the production Docker image slim and lets us run
  // `node server.js` on any container host (not Vercel-only).
  output: "standalone",
  // pg ships native/optional deps that must not be bundled by Next's tracer.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
