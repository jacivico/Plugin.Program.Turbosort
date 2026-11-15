'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./lib/config');
const { bookableDates } = require('./lib/dates');
const { validateBooking } = require('./lib/booking');
const db = require('./lib/db').open(config.dbPath);

const stripe = config.demo ? null : require('stripe')(config.stripeSecretKey);
const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// Estado de la reserva a partir del estado del PaymentIntent de Stripe.
const STATUS_FROM_PI = {
  requires_capture: 'authorized', // preautorización retenida en la tarjeta
  succeeded: 'captured', // cobrada
  canceled: 'released', // retención liberada
};
const statusFromPI = (pi) => STATUS_FROM_PI[pi.status] || 'pending';

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://js.stripe.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "connect-src 'self' https://api.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  next();
});

// --- Webhook de Stripe: necesita el cuerpo sin parsear, por eso va antes de express.json() ---
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !config.stripeWebhookSecret) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripeWebhookSecret);
  } catch {
    return res.status(400).send('Bad signature');
  }
  if (event.type.startsWith('payment_intent.')) {
    const pi = event.data.object;
    const booking = db.getByPaymentIntent(pi.id);
    if (booking) {
      const status = statusFromPI(pi);
      // Un evento atrasado nunca devuelve a "pending" una reserva ya autorizada.
      if (status !== 'pending' && status !== booking.status) db.setStatus(booking.id, status);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '50kb' }));

// --- Límite sencillo de solicitudes por IP ---
function rateLimit(max, windowMs) {
  const hits = new Map(); // un contador propio por limitador
  setInterval(() => hits.clear(), 60 * 60 * 1000).unref();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'rate_limited' });
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

const publicView = (b) => ({
  id: b.id,
  status: b.status,
  visitDate: b.visit_date,
  slot: b.slot,
  amount: b.amount,
  currency: b.currency,
  people: b.visitors.length,
});

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    demo: config.demo,
    publishableKey: config.demo ? null : config.stripePublishableKey,
    dates: bookableDates(config.rules),
    slots: config.slots,
    maxGroupSize: config.rules.maxGroupSize,
    pricing: config.pricing,
  });
});

app.post('/api/bookings', rateLimit(10, 10 * 60 * 1000), async (req, res) => {
  const result = validateBooking(req.body, config);
  if (!result.ok) return res.status(422).json({ error: 'validation', fields: result.errors });
  const d = result.data;
  const id = crypto.randomUUID();
  const booking = { id, createdAt: new Date().toISOString(), ...d, status: 'pending', paymentIntentId: null };

  if (config.demo) {
    db.insert(booking);
    return res.status(201).json({ bookingId: id, amount: d.amount, currency: d.currency, demo: true });
  }

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: d.amount,
        currency: d.currency,
        capture_method: 'manual', // solo preautoriza; el cobro se hace al confirmar la visita
        payment_method_types: ['card'],
        receipt_email: d.email,
        description: `Alhambra Last Minute · ${d.visitDate} · ${d.visitors.length} pax`,
        metadata: { booking_id: id, visit_date: d.visitDate, people: String(d.visitors.length) },
      },
      { idempotencyKey: id }
    );
    booking.paymentIntentId = pi.id;
    db.insert(booking);
    res.status(201).json({ bookingId: id, amount: d.amount, currency: d.currency, clientSecret: pi.client_secret });
  } catch (err) {
    console.error('Stripe create PaymentIntent failed:', err.message);
    res.status(502).json({ error: 'payment_provider' });
  }
});

// El navegador llama aquí tras confirmar el pago (o al volver del 3-D Secure).
app.post('/api/bookings/:id/sync', async (req, res) => {
  const booking = db.get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'not_found' });
  if (stripe && booking.payment_intent_id && booking.status === 'pending') {
    try {
      const pi = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
      const status = statusFromPI(pi);
      if (status !== booking.status) {
        db.setStatus(booking.id, status);
        booking.status = status;
      }
    } catch (err) {
      console.error('Stripe retrieve failed:', err.message);
    }
  }
  res.json(publicView(booking));
});

// Solo en modo demo: simula que la tarjeta ha sido preautorizada.
app.post('/api/bookings/:id/demo-authorize', (req, res) => {
  if (!config.demo) return res.status(404).end();
  const booking = db.get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'not_found' });
  if (booking.status === 'pending') db.setStatus(booking.id, 'authorized');
  res.json(publicView(db.get(booking.id)));
});

// --- Administración ---
function requireAdmin(req, res, next) {
  if (!config.adminPassword) return res.status(503).json({ error: 'admin_disabled' });
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  const given = scheme === 'Basic' ? Buffer.from(token || '', 'base64').toString().split(':').slice(1).join(':') : '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
  next();
}
const admin = express.Router();
admin.use(rateLimit(120, 10 * 60 * 1000), requireAdmin);

admin.get('/bookings', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ demo: config.demo, bookings: db.list(req.query.all === '1') });
});

// capture = cobrar la preautorización · release = liberar la retención
for (const [action, piMethod, expected] of [
  ['capture', 'capture', 'captured'],
  ['release', 'cancel', 'released'],
]) {
  admin.post(`/bookings/:id/${action}`, async (req, res) => {
    const booking = db.get(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    if (booking.status !== 'authorized') return res.status(409).json({ error: 'not_authorized', status: booking.status });
    try {
      let status = expected;
      if (stripe) status = statusFromPI(await stripe.paymentIntents[piMethod](booking.payment_intent_id));
      db.setStatus(booking.id, status);
      res.json(db.get(booking.id));
    } catch (err) {
      console.error(`Stripe ${piMethod} failed:`, err.message);
      res.status(502).json({ error: 'payment_provider', message: err.message });
    }
  });
}
app.use('/api/admin', admin);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Alhambra Last Minute en http://localhost:${config.port}${config.demo ? '  [MODO DEMO: sin claves de Stripe, el pago se simula]' : ''}`);
  });
}
module.exports = app;
