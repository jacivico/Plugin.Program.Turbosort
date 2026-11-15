'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bookableDates, todayISO, addDays } = require('../lib/dates');
const { validateBooking } = require('../lib/booking');

const config = {
  rules: { firstDayOffset: 1, bookableDays: 15, blockedDates: [], maxGroupSize: 10 },
  pricing: { currency: 'eur', adultCents: 8900, childCents: 5900, childMinAge: 3, childMaxAge: 11 },
  slots: ['any', 'morning', 'afternoon'],
};
const now = new Date('2026-11-14T12:00:00Z');
const base = (over = {}) => ({
  date: '2026-11-15',
  slot: 'morning',
  lang: 'es',
  contact: { email: 'Ana@Example.com', phone: '+34 600 000 000' },
  visitors: [{ name: 'Ana Pérez', passport: 'xa1234567', age: 34, nationality: 'es' }],
  acceptTerms: true,
  ...over,
});

test('ventana: de mañana a mañana+14 (15 días)', () => {
  const d = bookableDates(config.rules, now);
  assert.equal(d.length, 15);
  assert.equal(d[0], '2026-11-15');
  assert.equal(d[14], '2026-11-29');
});

test('el día se calcula en hora de Granada, no en UTC', () => {
  // 23:30 UTC del 14 = 00:30 del 15 en Madrid → mañana es el 16
  assert.equal(todayISO(new Date('2026-11-14T23:30:00Z')), '2026-11-15');
  assert.equal(bookableDates(config.rules, new Date('2026-11-14T23:30:00Z'))[0], '2026-11-16');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('fechas bloqueadas se excluyen', () => {
  const rules = { ...config.rules, blockedDates: ['2026-11-16'] };
  assert.ok(!bookableDates(rules, now).includes('2026-11-16'));
});

test('rechaza hoy, día 16º y fechas inválidas', () => {
  for (const date of ['2026-11-14', '2026-11-30', '2027-01-01', 'nope', undefined]) {
    const r = validateBooking(base({ date }), config, now);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('date'));
  }
});

test('normaliza datos y calcula el importe en el servidor', () => {
  const r = validateBooking(
    base({
      amount: 1,
      visitors: [
        { name: ' Ana  Pérez ', passport: 'xa1234567', age: 34, nationality: 'es' },
        { name: 'Leo Pérez', passport: 'XB7654321', age: 8, nationality: 'ES' },
        { name: 'Eva Pérez', passport: 'XC1112223', age: 1, nationality: 'ES' },
      ],
    }),
    config,
    now
  );
  assert.equal(r.ok, true);
  assert.equal(r.data.amount, 8900 + 5900 + 0);
  assert.equal(r.data.email, 'ana@example.com');
  assert.deepEqual(r.data.visitors[0], { name: 'Ana Pérez', passport: 'XA1234567', age: 34, nationality: 'ES' });
});

test('errores de validación por campo', () => {
  const r = validateBooking(
    base({ contact: { email: 'x', phone: '1' }, acceptTerms: false, visitors: [{ name: 'A', passport: '!', age: 200, nationality: 'Spain' }] }),
    config,
    now
  );
  assert.equal(r.ok, false);
  for (const f of ['email', 'phone', 'terms', 'visitors.0.name', 'visitors.0.passport', 'visitors.0.age']) assert.ok(r.errors.includes(f), f);
});

test('exige al menos un adulto y respeta el tamaño máximo de grupo', () => {
  const kid = { name: 'Leo Pérez', passport: 'XB7654321', age: 8, nationality: 'ES' };
  assert.ok(validateBooking(base({ visitors: [kid] }), config, now).errors.includes('adult'));
  const many = Array.from({ length: 11 }, () => base().visitors[0]);
  assert.ok(validateBooking(base({ visitors: many }), config, now).errors.includes('visitors'));
  assert.ok(validateBooking(base({ visitors: [] }), config, now).errors.includes('visitors'));
});
