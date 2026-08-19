/** @type {import('next').NextConfig} */
const nextConfig = {
  // officeparser declares a top-level "browser" field pointing at a browser-targeted
  // bundle; Turbopack's Route Handler bundling picks that condition up even in the
  // Node.js server runtime, which resolves `OfficeParser` to undefined at runtime.
  // Opting it out of bundling makes Next.js use native `require()` instead, which
  // resolves the package's Node ("require"/"import") export condition correctly.
  serverExternalPackages: ["officeparser"],
};

export default nextConfig;
