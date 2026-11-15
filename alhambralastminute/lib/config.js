'use strict';
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const int = (name, def) => {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
};

const config = {
  port: int('PORT', 3000),
  trustProxy: int('TRUST_PROXY', 0),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bookings.db'),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  rules: {
    firstDayOffset: int('FIRST_DAY_OFFSET', 1),
    bookableDays: int('BOOKABLE_DAYS', 15),
    blockedDates: (process.env.BLOCKED_DATES || '').split(',').map((s) => s.trim()).filter(Boolean),
    maxGroupSize: int('MAX_GROUP_SIZE', 10),
  },
  pricing: {
    currency: (process.env.CURRENCY || 'eur').toLowerCase(),
    adultCents: int('PRICE_ADULT_CENTS', 8900),
    childCents: int('PRICE_CHILD_CENTS', 5900),
    childMinAge: int('CHILD_MIN_AGE', 3),
    childMaxAge: int('CHILD_MAX_AGE', 11),
  },
  slots: ['any', 'morning', 'afternoon'],
};
config.demo = !config.stripeSecretKey || !config.stripePublishableKey;

module.exports = config;
