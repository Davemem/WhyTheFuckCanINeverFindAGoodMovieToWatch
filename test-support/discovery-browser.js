"use strict";
const { browser, json, tick } = require('./browser');

async function discoveryBrowser(t, fetcher) {
  const app = browser(); t.after(app.close);
  app.window.IntersectionObserver = class { observe() {} unobserve() {} };
  app.window.fetch = fetcher || (async () => json({ items: [], results: [], movies: [] }));
  app.load('saved-data-client.js'); app.load('movie-results.js'); app.load('discovery-filters.js'); app.load('app.js');
  await app.evaluate('Promise.all([...discoveryState.rows.values()].map(row => row.request))');
  await tick();
  return app;
}
module.exports = { discoveryBrowser };
