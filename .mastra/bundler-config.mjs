const bundler = {
  // A few dependencies are not properly picked up by
  // the bundler if they are not added directly to the
  // entrypoint.
  externals: ["@slack/web-api", "inngest", "inngest/hono", "hono", "hono/streaming"],
  // sourcemaps are good for debugging.
  sourcemap: true
};

export { bundler };
