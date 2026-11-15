'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      slot TEXT NOT NULL,
      lang TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      visitors TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      payment_intent_id TEXT
    );
    CREATE INDEX IF NOT EXISTS bookings_visit_date ON bookings (visit_date);
    CREATE INDEX IF NOT EXISTS bookings_pi ON bookings (payment_intent_id);
  `);

  // Migración: columnas añadidas después de la primera versión.
  const cols = db.prepare('PRAGMA table_info(bookings)').all().map((c) => c.name);
  if (!cols.includes('card_brand')) db.exec('ALTER TABLE bookings ADD COLUMN card_brand TEXT');
  if (!cols.includes('capture_before')) db.exec('ALTER TABLE bookings ADD COLUMN capture_before TEXT');

  const row = (r) => (r ? { ...r, visitors: JSON.parse(r.visitors) } : null);

  return {
    insert(b) {
      db.prepare(
        `INSERT INTO bookings (id, created_at, visit_date, slot, lang, email, phone, visitors, amount, currency, status, payment_intent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(b.id, b.createdAt, b.visitDate, b.slot, b.lang, b.email, b.phone, JSON.stringify(b.visitors), b.amount, b.currency, b.status, b.paymentIntentId ?? null);
    },
    get: (id) => row(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)),
    getByPaymentIntent: (pi) => row(db.prepare('SELECT * FROM bookings WHERE payment_intent_id = ?').get(pi)),
    setStatus: (id, status) => db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id),
    setCard: (id, brand, captureBefore) => db.prepare('UPDATE bookings SET card_brand = ?, capture_before = ? WHERE id = ?').run(brand, captureBefore, id),
    // Las solicitudes "pending" (pago nunca completado) no se muestran salvo que se pidan.
    list: (includePending) =>
      db
        .prepare(`SELECT * FROM bookings ${includePending ? '' : "WHERE status NOT IN ('pending', 'rejected')"} ORDER BY visit_date ASC, created_at ASC`)
        .all()
        .map(row),
  };
}

module.exports = { open };
