/** @type {import('next').NextConfig} */
const nextConfig = {
  // officeparser declares a top-level "browser" field pointing at a browser-targeted
  // bundle; Turbopack's Route Handler bundling picks that condition up even in the
  // Node.js server runtime, which resolves `OfficeParser` to undefined at runtime.
  // Opting it out of bundling makes Next.js use native `require()` instead, which
  // resolves the package's Node ("require"/"import") export condition correctly.
  //
  // pdf-parse's transitive dependency pdfjs-dist tries to polyfill browser-only
  // globals (DOMMatrix, ImageData, Path2D) via the optional native package
  // @napi-rs/canvas when it's bundled by Turbopack for the serverless runtime;
  // that optional dependency isn't available there, so the polyfill silently
  // fails and a later reference to DOMMatrix throws at module-evaluation time —
  // crashing every /api/upload request (any file type) on Vercel even though
  // this worked locally. Externalizing both packages makes Next.js resolve them
  // via real Node `require()` at runtime instead, which pdfjs-dist's own
  // fallback path handles correctly.
  serverExternalPackages: ["officeparser", "pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],

  // Vercel's output file tracer only bundles a dependency into the deployed
  // serverless function if it can statically see the require() — pdfjs-dist
  // loads @napi-rs/canvas inside its own try/catch polyfill fallback, which
  // the tracer misses, so the package (and its platform-specific native
  // binary sub-package, e.g. @napi-rs/canvas-linux-x64-gnu) never made it
  // into /var/task even though `npm install` resolved it during the build.
  // Forcing inclusion here is the documented fix for tracer-missed optional
  // native dependencies.
  outputFileTracingIncludes: {
    "/api/upload": ["./node_modules/@napi-rs/canvas*/**/*"],
  },
};

export default nextConfig;
