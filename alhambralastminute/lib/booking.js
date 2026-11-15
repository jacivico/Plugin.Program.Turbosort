'use strict';
const { bookableDates } = require('./dates');

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function priceFor(age, pricing) {
  if (age < pricing.childMinAge) return 0;
  if (age <= pricing.childMaxAge) return pricing.childCents;
  return pricing.adultCents;
}

/**
 * Valida y normaliza una solicitud de reserva. El importe se calcula SIEMPRE aquí,
 * nunca se acepta el del navegador.
 * @returns {{ok:true,data:object}|{ok:false,errors:string[]}}
 */
function validateBooking(body, config, now = new Date()) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const visitDate = clean(b.date, 10);
  if (!bookableDates(config.rules, now).includes(visitDate)) errors.push('date');

  const slot = config.slots.includes(b.slot) ? b.slot : 'any';
  const lang = b.lang === 'en' ? 'en' : 'es';

  const c = b.contact && typeof b.contact === 'object' ? b.contact : {};
  const email = clean(c.email, 200).toLowerCase();
  const phone = clean(c.phone, 30);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push('email');
  if (!/^\+?[\d\s().-]{6,30}$/.test(phone)) errors.push('phone');

  const raw = Array.isArray(b.visitors) ? b.visitors : [];
  if (raw.length < 1 || raw.length > config.rules.maxGroupSize) errors.push('visitors');

  const visitors = raw.slice(0, config.rules.maxGroupSize).map((v, i) => {
    const o = v && typeof v === 'object' ? v : {};
    const name = clean(o.name, 120);
    const passport = clean(o.passport, 30).toUpperCase();
    const age = typeof o.age === 'number' ? o.age : Number.parseInt(o.age, 10);
    const nationality = clean(o.nationality, 2).toUpperCase();
    if (name.length < 3) errors.push(`visitors.${i}.name`);
    if (!/^[A-Z0-9][A-Z0-9 -]{3,29}$/.test(passport)) errors.push(`visitors.${i}.passport`);
    if (!Number.isInteger(age) || age < 0 || age > 120) errors.push(`visitors.${i}.age`);
    if (!/^[A-Z]{2}$/.test(nationality)) errors.push(`visitors.${i}.nationality`);
    return { name, passport, age, nationality };
  });

  if (visitors.length && !visitors.some((v) => v.age >= 18)) errors.push('adult');
  if (b.acceptTerms !== true) errors.push('terms');
  if (errors.length) return { ok: false, errors };

  const amount = visitors.reduce((sum, v) => sum + priceFor(v.age, config.pricing), 0);
  if (amount <= 0) return { ok: false, errors: ['amount'] };

  return { ok: true, data: { visitDate, slot, lang, email, phone, visitors, amount, currency: config.pricing.currency } };
}

module.exports = { validateBooking, priceFor };
