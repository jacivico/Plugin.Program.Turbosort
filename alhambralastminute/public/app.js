(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    }
    n.append(...children);
    return n;
  };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  };

  const blankVisitor = () => ({ name: '', passport: '', age: '', nationality: '' });
  const state = {
    lang: store.get('lang') || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en'),
    config: null,
    step: 1,
    date: null,
    slot: 'any',
    visitors: [blankVisitor()],
    email: '',
    phone: '',
    booking: null, // { bookingId, amount, currency, clientSecret?, demo? }
    bookingKey: null, // huella de los datos con los que se creó `booking`
    stripe: null,
    elements: null,
  };

  // ---------- i18n ----------
  const t = (key, vars = {}) => {
    const s = window.I18N[state.lang][key] ?? key;
    return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
  };
  const locale = () => (state.lang === 'es' ? 'es-ES' : 'en-GB');
  const money = (cents) =>
    new Intl.NumberFormat(locale(), { style: 'currency', currency: state.config.pricing.currency.toUpperCase() }).format(cents / 100);
  const dateParts = (iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    const f = (opts) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...opts }).format(d);
    return { dow: f({ weekday: 'short' }), num: f({ day: 'numeric' }), mon: f({ month: 'short' }), long: f({ weekday: 'long', day: 'numeric', month: 'long' }) };
  };

  // ---------- tarjetas admitidas por fecha ----------
  const cardsOf = (iso) => state.config.dates.find((d) => d.date === iso)?.cards || [];
  const BRAND = { visa: 'Visa', mastercard: 'Mastercard' };
  const cardIcons = (cards) =>
    el('span', { class: 'cards', role: 'img', 'aria-label': cards.map((c) => BRAND[c]).join(' + ') },
      ...cards.map((c) => el('span', { class: `cb ${c}`, text: c === 'visa' ? 'VISA' : '' })));
  const cardsText = (cards) => t(cards.length > 1 ? 'cards.both' : 'cards.mc');

  // ---------- precios (espejo del servidor; el servidor recalcula siempre) ----------
  const priceFor = (age) => {
    const p = state.config.pricing;
    if (age < p.childMinAge) return 0;
    if (age <= p.childMaxAge) return p.childCents;
    return p.adultCents;
  };
  const categoryFor = (age) => {
    const p = state.config.pricing;
    if (age < p.childMinAge) return t('cat.infant', { min: p.childMinAge });
    if (age <= p.childMaxAge) return t('cat.child', { min: p.childMinAge, max: p.childMaxAge });
    return t('cat.adult');
  };
  const parsedAge = (v) => (/^\d{1,3}$/.test(String(v.age).trim()) ? Number(v.age) : null);
  // Sin edad indicada, se estima con tarifa de adulto.
  const total = () => state.visitors.reduce((s, v) => s + priceFor(parsedAge(v) ?? 99), 0);

  // ---------- render ----------
  function applyI18n() {
    document.documentElement.lang = state.lang;
    $$('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    $('#lang-toggle').textContent = state.lang === 'es' ? 'EN' : 'ES';
    $('#faq-list').replaceChildren(
      ...t('faq').map(([q, a]) => el('details', {}, el('summary', { text: q }), el('p', { text: a })))
    );
    if (!state.config) return;
    renderDays();
    renderSlots();
    renderVisitors();
    renderSummary();
  }

  function renderDays() {
    const nodes = [];
    let prev = null;
    state.config.dates.forEach(({ date: iso, cards }, i) => {
      const key = cards.join('+');
      // Separador al cambiar de grupo de tarjetas admitidas.
      if (key !== prev) nodes.push(el('div', { class: 'sep' }, cardIcons(cards), el('span', { text: cardsText(cards) })));
      prev = key;
      const p = dateParts(iso);
      const b = el('button', { type: 'button', class: 'day', role: 'radio', 'aria-checked': String(state.date === iso), 'aria-label': `${p.long} · ${cardsText(cards)}` },
        el('span', { class: 'dow', text: p.dow }),
        el('span', { class: 'num', text: p.num }),
        el('span', { class: 'mon', text: p.mon }),
        i === 0 && state.config.firstIsTomorrow ? el('span', { class: 'tag', text: t('tag.tomorrow') }) : cardIcons(cards));
      b.addEventListener('click', () => { state.date = iso; hideError(1); renderDays(); renderSummary(); });
      nodes.push(b);
    });
    $('#days').replaceChildren(...nodes);
  }

  function renderSlots() {
    $('#slots').replaceChildren(
      ...state.config.slots.map((s) => {
        const b = el('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(state.slot === s), text: t(`slot.${s}`) });
        b.addEventListener('click', () => { state.slot = s; renderSlots(); renderSummary(); });
        return b;
      })
    );
  }

  function countryOptions() {
    let names;
    try { names = new Intl.DisplayNames([locale()], { type: 'region' }); } catch { names = null; }
    return window.COUNTRY_CODES
      .map((code) => ({ code, name: names?.of(code) || code }))
      .sort((a, b) => a.name.localeCompare(b.name, locale()));
  }

  function renderVisitors() {
    const countries = countryOptions();
    $('#people-count').textContent = state.visitors.length;
    $('#people-minus').disabled = state.visitors.length <= 1;
    $('#people-plus').disabled = state.visitors.length >= state.config.maxGroupSize;

    $('#visitors').replaceChildren(
      ...state.visitors.map((v, i) => {
        const priceTag = el('span');
        const setTag = () => {
          const age = parsedAge(v);
          priceTag.textContent = age === null ? '' : `${categoryFor(age)} · ${priceFor(age) ? money(priceFor(age)) : t('free')}`;
        };
        const field = (key, label, input) => {
          input.dataset.field = `visitors.${i}.${key}`;
          input.value = v[key];
          input.addEventListener('input', () => {
            v[key] = input.value;
            input.classList.remove('invalid');
            if (key === 'age') { setTag(); renderSummary(); }
          });
          return el('label', {}, el('span', { text: label }), input);
        };
        const select = el('select', { required: '', autocomplete: 'off' }, el('option', { value: '', text: t('f.choose') }),
          ...countries.map((c) => el('option', { value: c.code, text: c.name })));
        setTag();
        return el('div', { class: 'visitor' },
          el('div', { class: 'visitor-head' }, el('strong', { text: `${t('f.visitor')} ${i + 1}` }), priceTag),
          el('div', { class: 'fields four' },
            field('name', t('f.name'), el('input', { type: 'text', required: '', maxlength: '120', autocomplete: i === 0 ? 'name' : 'off' })),
            field('passport', t('f.passport'), el('input', { type: 'text', required: '', maxlength: '30', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' })),
            field('age', t('f.age'), el('input', { type: 'number', required: '', min: '0', max: '120', step: '1', inputmode: 'numeric' })),
            field('nationality', t('f.nationality'), select)));
      })
    );
  }

  function renderSummary() {
    $('#sum-date').textContent = state.date ? dateParts(state.date).long : '—';
    $('#sum-slot').textContent = t(`slot.${state.slot}`);
    const cards = state.date ? cardsOf(state.date) : [];
    $('#sum-cards').replaceChildren(cards.length ? cardIcons(cards) : '—');
    $('#cards-note').replaceChildren(...(cards.length ? [cardIcons(cards), el('span', { text: t(cards.length > 1 ? 'note.both' : 'note.mc') })] : []));
    const groups = new Map();
    for (const v of state.visitors) {
      const age = parsedAge(v) ?? 99;
      const key = categoryFor(age);
      const g = groups.get(key) || { n: 0, cents: 0 };
      g.n += 1; g.cents += priceFor(age);
      groups.set(key, g);
    }
    $('#sum-lines').replaceChildren(
      ...[...groups].map(([label, g]) => el('li', {}, el('span', { text: `${g.n} × ${label}` }), el('span', { text: g.cents ? money(g.cents) : t('free') })))
    );
    $('#sum-total').textContent = money(total());
    $('#pay').textContent = t('btn.pay', { amount: money(state.booking?.amount ?? total()) });
  }

  function showStep(n) {
    state.step = n;
    $$('[data-panel]').forEach((p) => { p.hidden = Number(p.dataset.panel) !== n; });
    $$('#progress li').forEach((li) => li.classList.toggle('on', Number(li.dataset.step) <= n));
    $('#progress').hidden = n === 4;
    $('#summary').hidden = n === 4;
    $('#book').scrollIntoView({ block: 'start' });
  }

  const showError = (step, key) => { const e = $(`#err-${step}`); e.textContent = t(key); e.hidden = false; };
  const hideError = (step) => { $(`#err-${step}`).hidden = true; };

  // ---------- validación en el navegador (el servidor valida de nuevo) ----------
  function validateStep2() {
    const bad = new Set();
    state.visitors.forEach((v, i) => {
      if (v.name.trim().length < 3) bad.add(`visitors.${i}.name`);
      if (!/^[A-Za-z0-9][A-Za-z0-9 -]{3,29}$/.test(v.passport.trim())) bad.add(`visitors.${i}.passport`);
      const age = parsedAge(v);
      if (age === null || age > 120) bad.add(`visitors.${i}.age`);
      if (!v.nationality) bad.add(`visitors.${i}.nationality`);
    });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.email.trim())) bad.add('email');
    if (!/^\+?[\d\s().-]{6,30}$/.test(state.phone.trim())) bad.add('phone');
    return [...bad];
  }

  function markInvalid(fields) {
    $$('.invalid').forEach((n) => n.classList.remove('invalid'));
    for (const f of fields) {
      const node = f === 'email' || f === 'phone' ? $(`#${f}`) : $(`[data-field="${f}"]`);
      node?.classList.add('invalid');
    }
    $('.invalid')?.focus();
  }

  // ---------- flujo ----------
  async function api(path, body) {
    const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { status: res.status, data });
    return data;
  }

  const payload = () => ({
    date: state.date,
    slot: state.slot,
    lang: state.lang,
    contact: { email: state.email.trim(), phone: state.phone.trim() },
    visitors: state.visitors.map((v) => ({ name: v.name.trim(), passport: v.passport.trim(), age: Number(v.age), nationality: v.nationality })),
    acceptTerms: true,
  });

  function loadStripe() {
    return new Promise((resolve, reject) => {
      if (window.Stripe) return resolve();
      const s = el('script', { src: 'https://js.stripe.com/v3/' });
      s.onload = resolve;
      s.onerror = () => reject(new Error('stripe_js'));
      document.head.append(s);
    });
  }

  async function submitVisitors(ev) {
    ev.preventDefault();
    hideError(2);
    const bad = validateStep2();
    if (bad.length) { markInvalid(bad); return showError(2, 'err.fields'); }
    if (!state.visitors.some((v) => Number(v.age) >= 18)) return showError(2, 'err.adult');
    if (!$('#terms').checked) return showError(2, 'err.terms');

    const body = payload();
    const key = JSON.stringify(body);
    const btn = $('#next-2');
    btn.disabled = true;
    try {
      // Si no ha cambiado nada, se reutiliza la solicitud ya creada (no se duplican retenciones).
      if (state.bookingKey !== key) {
        state.booking = await api('/api/bookings', body);
        state.bookingKey = key;
        state.elements = null;
      }
      if (state.booking.demo) {
        $('#demo-pay').hidden = false;
      } else if (!state.elements) {
        await loadStripe();
        state.stripe = state.stripe || window.Stripe(state.config.publishableKey);
        state.elements = state.stripe.elements({
          clientSecret: state.booking.clientSecret,
          locale: state.lang,
          // Solo se muestran como válidas las marcas admitidas para la fecha (el servidor lo vuelve a comprobar).
          disallowedCardBrands: ['american_express', 'discover_global_network', ...(cardsOf(state.date).includes('visa') ? [] : ['visa'])],
          appearance: { theme: 'stripe', variables: { colorPrimary: '#15211c', borderRadius: '4px', fontFamily: 'Inter, system-ui, sans-serif' } },
        });
        $('#payment-element').replaceChildren();
        state.elements.create('payment').mount('#payment-element');
      }
      renderSummary();
      showStep(3);
    } catch (err) {
      if (err.status === 422) {
        const fields = err.data.fields || [];
        if (fields.includes('date')) { await loadConfig(); state.date = null; renderDays(); renderSummary(); showStep(1); showError(1, 'err.dateGone'); }
        else if (fields.includes('adult')) showError(2, 'err.adult');
        else { markInvalid(fields); showError(2, 'err.fields'); }
      } else showError(2, err.status === 429 ? 'err.rate' : 'err.generic');
    } finally {
      btn.disabled = false;
    }
  }

  async function pay() {
    hideError(3);
    const btn = $('#pay');
    btn.disabled = true;
    btn.textContent = t('btn.processing');
    const id = state.booking.bookingId;
    try {
      if (state.booking.demo) {
        showResult(await api(`/api/bookings/${id}/demo-authorize`, { brand: $('input[name="demo-brand"]:checked').value }));
        return;
      }
      const { error } = await state.stripe.confirmPayment({
        elements: state.elements,
        confirmParams: { return_url: `${location.origin}/?booking=${id}`, receipt_email: state.email.trim() },
        redirect: 'if_required',
      });
      if (error) {
        const e = $('#err-3');
        e.textContent = error.message || t('err.generic');
        e.hidden = false;
        return;
      }
      showResult(await api(`/api/bookings/${id}/sync`, {}));
    } catch {
      showError(3, 'err.generic');
    } finally {
      btn.disabled = false;
      renderSummary();
    }
  }

  function showResult(b) {
    if (b.status === 'rejected') {
      // Tarjeta no admitida para la fecha: la retención ya está liberada y hay que repetir el pago.
      Object.assign(state, { booking: null, bookingKey: null, elements: null });
      $('#demo-pay').hidden = true;
      showStep(2);
      return showError(2, b.cards.length > 1 ? 'err.cardBoth' : 'err.cardMc');
    }
    const ok = b.status === 'authorized' || b.status === 'captured';
    $('[data-panel="4"]').classList.toggle('warn', !ok);
    $('.seal').textContent = ok ? '✓' : '…';
    $('#done-title').textContent = t(ok ? 'done.ok.title' : 'done.pending.title');
    $('#done-text').textContent = t(ok ? 'done.ok.text' : 'done.pending.text', { email: state.email.trim() || 'email' });
    const row = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
    $('#done-receipt').replaceChildren(
      row(t('sum.ref'), b.id.slice(0, 8).toUpperCase()),
      row(t('sum.date'), dateParts(b.visitDate).long),
      row(t('sum.slot'), t(`slot.${b.slot}`)),
      row(t('sum.people'), String(b.people)),
      row(t('sum.total'), money(b.amount)));
    showStep(4);
  }

  function restart() {
    Object.assign(state, { date: null, slot: 'any', visitors: [blankVisitor()], booking: null, bookingKey: null, elements: null });
    $('#terms').checked = false;
    $('#demo-pay').hidden = true;
    history.replaceState(null, '', location.pathname);
    applyI18n();
    showStep(1);
  }

  async function loadConfig() {
    state.config = await api('/api/config');
    // "Mañana" solo se etiqueta si la primera fecha es realmente el día siguiente en Granada.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    const next = new Date(`${today}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    state.config.firstIsTomorrow = state.config.dates[0]?.date === next.toISOString().slice(0, 10);
  }

  // ---------- inicio ----------
  async function init() {
    $('#year').textContent = new Date().getFullYear();
    applyI18n();
    $('#lang-toggle').addEventListener('click', () => { state.lang = state.lang === 'es' ? 'en' : 'es'; store.set('lang', state.lang); applyI18n(); });

    try {
      await loadConfig();
    } catch {
      return showError(1, 'err.generic');
    }
    $('#demo-banner').hidden = !state.config.demo;
    applyI18n();

    $('#people-minus').addEventListener('click', () => { if (state.visitors.length > 1) { state.visitors.pop(); renderVisitors(); renderSummary(); } });
    $('#people-plus').addEventListener('click', () => { if (state.visitors.length < state.config.maxGroupSize) { state.visitors.push(blankVisitor()); renderVisitors(); renderSummary(); } });
    $('#next-1').addEventListener('click', () => { if (!state.date) return showError(1, 'err.date'); hideError(1); showStep(2); });
    $$('[data-back]').forEach((b) => b.addEventListener('click', () => showStep(Number(b.dataset.back))));
    for (const key of ['email', 'phone']) $(`#${key}`).addEventListener('input', (e) => { state[key] = e.target.value; e.target.classList.remove('invalid'); });
    $('#terms').addEventListener('change', () => hideError(2));
    $('#visitors-form').addEventListener('submit', submitVisitors);
    $('#pay').addEventListener('click', pay);
    $('#restart').addEventListener('click', restart);

    // Vuelta desde la autenticación del banco (3-D Secure).
    const returned = new URLSearchParams(location.search).get('booking');
    if (returned) {
      try { showResult(await api(`/api/bookings/${encodeURIComponent(returned)}/sync`, {})); } catch { /* referencia desconocida: se muestra el formulario */ }
    }
  }

  init();
})();
