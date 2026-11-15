(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k === 'class' ? (n.className = v) : k === 'text' ? (n.textContent = v) : n.setAttribute(k, v);
    n.append(...children);
    return n;
  };
  const STATUS = { rejected: 'Tarjeta no admitida', pending: 'Sin pago', authorized: 'Preautorizada', captured: 'Cobrada', released: 'Liberada' };
  const SLOT = { any: 'Indiferente', morning: 'Mañana', afternoon: 'Tarde' };
  let password = '';
  try { password = sessionStorage.getItem('admin') || ''; } catch { /* sin almacenamiento */ }

  const error = (msg) => { $('#error').textContent = msg || ''; $('#error').hidden = !msg; };

  async function api(path, method = 'GET') {
    const res = await fetch(`/api/admin${path}`, { method, headers: { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`admin:${password}`)))}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'error'), { status: res.status });
    return data;
  }

  const money = (cents, cur) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);
  const day = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00Z`));
  const when = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  async function act(b, action, question) {
    if (!confirm(question)) return;
    error('');
    try { await api(`/bookings/${b.id}/${action}`, 'POST'); } catch (e) { error(`No se pudo completar: ${e.message}`); }
    load();
  }

  function card(b) {
    const rows = b.visitors.map((v) => el('tr', {}, el('td', { text: v.name }), el('td', { text: v.passport }), el('td', { text: String(v.age) }), el('td', { text: v.nationality })));
    const node = el('article', { class: 'booking' },
      el('div', { class: 'booking-head' },
        el('strong', { text: `${day(b.visit_date)} · ${SLOT[b.slot] || b.slot}` }),
        el('span', { class: `badge ${b.status}`, text: STATUS[b.status] || b.status })),
      el('p', { class: 'meta', text: `${money(b.amount, b.currency)} · ${b.visitors.length} pax · ${b.email} · ${b.phone} · idioma ${b.lang} · ref. ${b.id.slice(0, 8).toUpperCase()} · recibida ${when(b.created_at)}` }),
      el('div', { class: 'scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, ...['Nombre', 'Pasaporte / doc.', 'Edad', 'Nac.'].map((h) => el('th', { text: h })))),
        el('tbody', {}, ...rows))));
    if (b.card_brand) {
      // Aviso si la retención caduca antes del día de la visita.
      const expiresEarly = b.status === 'authorized' && b.capture_before && b.capture_before.slice(0, 10) <= b.visit_date;
      node.insertBefore(
        el('p', { class: `meta${expiresEarly ? ' warn' : ''}`, text: `Tarjeta: ${b.card_brand}${b.capture_before ? ` · la retención caduca el ${when(b.capture_before)}` : ''}${expiresEarly ? ' · CADUCA ANTES DE LA VISITA: cobra o libera antes de esa fecha' : ''}` }),
        node.children[2]);
    }
    if (b.status === 'authorized') {
      const capture = el('button', { class: 'btn btn-gold btn-sm', type: 'button', text: 'Confirmar y cobrar' });
      const release = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Liberar retención' });
      capture.addEventListener('click', () => act(b, 'capture', `¿Cobrar ${money(b.amount, b.currency)} a ${b.email}? Esta acción no se puede deshacer desde aquí.`));
      release.addEventListener('click', () => act(b, 'release', `¿Liberar la retención de ${money(b.amount, b.currency)}? El cliente no pagará nada y la solicitud quedará cerrada.`));
      node.append(el('div', { class: 'actions' }, release, capture));
    }
    return node;
  }

  async function load() {
    error('');
    try {
      const data = await api(`/bookings${$('#show-all').checked ? '?all=1' : ''}`);
      $('#login').hidden = true;
      $('#content').hidden = false;
      $('#mode').textContent = data.demo ? 'MODO DEMO: Stripe no está configurado; cobrar y liberar solo cambian el estado.' : 'Conectado a Stripe.';
      $('#list').replaceChildren(...(data.bookings.length ? data.bookings.map(card) : [el('p', { class: 'hint', text: 'No hay reservas todavía.' })]));
      try { sessionStorage.setItem('admin', password); } catch { /* sin almacenamiento */ }
    } catch (e) {
      $('#login').hidden = false;
      $('#content').hidden = true;
      if (e.status === 401) error(password ? 'Contraseña incorrecta.' : '');
      else if (e.status === 503) error('El panel está desactivado: define ADMIN_PASSWORD en el servidor.');
      else error('No se pudieron cargar las reservas.');
    }
  }

  $('#login').addEventListener('submit', (ev) => { ev.preventDefault(); password = $('#password').value; load(); });
  $('#reload').addEventListener('click', load);
  $('#show-all').addEventListener('change', load);
  $('#logout').addEventListener('click', () => { password = ''; try { sessionStorage.removeItem('admin'); } catch { /* nada */ } $('#password').value = ''; load(); });
  if (password) load();
})();
