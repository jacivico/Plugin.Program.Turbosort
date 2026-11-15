'use strict';
// Todas las fechas se calculan en la hora de Granada, no en la del servidor ni la del cliente.
const TZ = 'Europe/Madrid';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function todayISO(now = new Date()) {
  return fmt.format(now);
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const daysBetween = (fromISO, toISO) => Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);

/** Días reservables: de hoy+firstDayOffset a hoy+lastDayOffset, menos los bloqueados. */
function bookableDates(rules, now = new Date()) {
  const today = todayISO(now);
  const out = [];
  for (let i = rules.firstDayOffset; i <= rules.lastDayOffset; i++) {
    const day = addDays(today, i);
    if (!rules.blockedDates.includes(day)) out.push(day);
  }
  return out;
}

/**
 * Marcas de tarjeta admitidas para una fecha de visita, según los días que faltan
 * desde `now` (el momento en que se hace la retención): una retención Visa dura 7 días;
 * una Mastercard puede ampliarse a 30.
 */
function cardsFor(visitDate, rules, now = new Date()) {
  return daysBetween(todayISO(now), visitDate) <= rules.visaMaxOffset ? ['visa', 'mastercard'] : ['mastercard'];
}

module.exports = { TZ, todayISO, addDays, bookableDates, cardsFor };
