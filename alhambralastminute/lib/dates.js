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

/** Días reservables: desde hoy+firstDayOffset, `bookableDays` días seguidos, menos los bloqueados. */
function bookableDates(rules, now = new Date()) {
  const today = todayISO(now);
  const out = [];
  for (let i = 0; i < rules.bookableDays; i++) {
    const day = addDays(today, rules.firstDayOffset + i);
    if (!rules.blockedDates.includes(day)) out.push(day);
  }
  return out;
}

module.exports = { TZ, todayISO, addDays, bookableDates };
