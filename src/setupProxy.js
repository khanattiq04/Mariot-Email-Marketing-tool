const { createProxyMiddleware } = require("http-proxy-middleware");

/**
 * The API lives in ./api as Vercel serverless functions, which the CRA dev
 * server does not serve. `npm run dev` starts a local runner for them
 * (scripts/dev.js) and this forwards /api/* requests to it.
 *
 * Only picked up by the dev server; it does not affect the production build.
 */
module.exports = function setupProxy(app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target:
        process.env.API_URL ||
        "http://127.0.0.1:" + (process.env.API_PORT || 3001),
      changeOrigin: true,
    })
  );
};