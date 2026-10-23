'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./lib/config');
const dbm = require('./lib/db');
const limits = require('./lib/limits');
const { auth: adminAuth, router: adminApi } = require('./routes/admin');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render / Railway / Fly / Nginx sit in front of the app

  app.use(helmet({
    // The website uses inline scripts/handlers, Google Fonts, the Google Maps embed and blob: uploads.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
        'script-src-attr': ["'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:', 'data:'],
        'frame-src': ['https://maps.google.com', 'https://www.google.com'],
        'connect-src': ["'self'", 'https://formspree.io'],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false
  }));
  app.use(compression());

  if (config.corsOrigin.length) {
    app.use('/api', (req, res, next) => {
      const o = req.headers.origin;
      if (o && config.corsOrigin.includes(o)) {
        res.set({ 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  // Stripe webhook first: it needs the raw request body.
  app.use('/api/webhooks', require('./routes/webhooks'));

  app.use('/api', express.json({ limit: '100kb' }), limits.api);
  app.get('/api/health', (req, res) => {
    try { dbm.get().prepare('SELECT 1').get(); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false }); }
  });
  app.use('/api/availability', require('./routes/availability'));
  app.use('/api/checkout', require('./routes/checkout'));
  app.use('/api/bookings', require('./routes/bookings'));
  app.use('/api/members', require('./routes/members'));
  app.use('/api/reviews', require('./routes/reviews'));
  app.use('/api/chat', require('./routes/chat'));
  app.use('/api/media', require('./routes/media'));
  app.use('/api/admin', adminApi);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Admin dashboard (HTTP Basic auth)
  app.use('/admin', limits.adminAuth, adminAuth, express.static(path.join(__dirname, 'admin'), { index: 'index.html' }));

  // Owner-uploaded photos/videos (random file names; supports video seeking via Range requests)
  require('./lib/media').ensureDir();
  app.use('/media', express.static(require('./lib/media').dir(), { index: false, dotfiles: 'deny', maxAge: '30d', immutable: true }));

  // The website
  const pub = path.join(__dirname, 'public');
  app.use(express.static(pub, { index: 'index.html', maxAge: '1h', setHeaders: (res, f) => { if (f.endsWith('.html')) res.set('Cache-Control', 'no-cache'); } }));
  // Single-page site: ?page=... deep links and extensionless paths get the app; missing files are real 404s.
  app.get('*', (req, res) => {
    if (path.extname(req.path) || /\/\./.test(req.path)) return res.status(404).type('text').send('Not found');
    res.sendFile(path.join(pub, 'index.html'));
  });

  // Errors -> JSON the website understands ({error: "..."})
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status === 500) console.error('[error]', req.method, req.originalUrl, err);
    res.status(status).json({ error: status >= 500 && status !== 503 && status !== 502 ? 'Something went wrong. Please try again.' : err.message });
  });
  return app;
}

function start() {
  const problems = config.validate();
  if (problems.length) {
    console.error('Refusing to start:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  dbm.open();
  const orders = require('./lib/orders');
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`Kidz Nest running on ${config.baseUrl} (port ${config.port})`));

  const timers = [
    setInterval(() => orders.sweep().catch(e => console.error('[sweep]', e.message)), 5 * 60 * 1000),
    setInterval(() => dbm.backup().catch(e => console.error('[backup]', e.message)), 24 * 60 * 60 * 1000)
  ];
  timers.forEach(t => t.unref());
  dbm.backup().catch(e => console.error('[backup]', e.message));

  const stop = () => { server.close(() => { dbm.close(); process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (require.main === module) start();
module.exports = { createApp, start };
