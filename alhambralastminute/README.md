# Alhambra Last Minute

Web de reservas de última hora para la Alhambra. No hay calendario de disponibilidad:
el cliente elige cualquier día entre **mañana y hoy + 29**, indica los datos de cada
visitante (nombre, pasaporte, edad, nacionalidad) y deja una **preautorización** con Stripe.
El importe solo se cobra cuando confirmas la visita desde el panel; si no, se libera.

## Arrancar

```bash
npm install
cp .env.example .env   # rellena las claves
npm start              # http://localhost:3000
npm test
```

Sin claves de Stripe arranca en **modo demo**: todo el flujo funciona pero el pago se simula.

## Configuración (`.env`)

| Variable | Para qué |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Claves de Stripe (usa las `sk_test_…` / `pk_test_…` para probar) |
| `STRIPE_WEBHOOK_SECRET` | Secreto del webhook. Endpoint: `https://TU-DOMINIO/webhook`, eventos `payment_intent.*` |
| `ADMIN_PASSWORD` | Contraseña del panel `/admin` (sin ella, el panel está desactivado) |
| `FIRST_DAY_OFFSET`, `LAST_DAY_OFFSET` | Ventana de fechas. Por defecto 1 y 29 = de mañana a hoy + 29 |
| `VISA_MAX_OFFSET` | Hasta hoy + 6 se aceptan Visa y Mastercard; después, solo Mastercard |
| `BLOCKED_DATES` | Días cerrados (`YYYY-MM-DD`, separados por comas) |
| `PRICE_ADULT_CENTS`, `PRICE_CHILD_CENTS`, `CHILD_MIN_AGE`, `CHILD_MAX_AGE` | Tarifas por edad (**valores provisionales**) |
| `MAX_GROUP_SIZE` | Máximo de personas por solicitud |
| `TRUST_PROXY` | `1` si hay un proxy o CDN delante |
| `DB_PATH` | Fichero SQLite con las reservas |

## Cómo funciona

1. `POST /api/bookings` valida la solicitud en el servidor (fecha dentro de la ventana en hora
   de Granada, datos de visitantes, al menos un adulto), calcula el importe y crea un
   `PaymentIntent` con `capture_method: manual`.
2. El navegador confirma la tarjeta con Stripe Payment Element (incluye 3-D Secure).
   El importe queda **retenido**, no cobrado → estado `authorized`.
3. En `/admin` ves cada solicitud con los datos de los visitantes y decides:
   **Confirmar y cobrar** (captura) o **Liberar retención** (cancela el PaymentIntent).

Estados: `pending` (pago no completado) → `authorized` → `captured` | `released`; `rejected` si la tarjeta no está admitida para la fecha.

## Tarjetas admitidas según la fecha

Una retención Visa dura 7 días; una Mastercard puede ampliarse a 30. Por eso:

- Visita hasta **hoy + 6**: Visa y Mastercard.
- Visita de **hoy + 7 a hoy + 29**: solo Mastercard.

El calendario lo indica con un icono en cada día. El formulario de Stripe solo acepta las marcas
admitidas y el servidor lo vuelve a comprobar tras la retención: si la marca no vale para esa fecha,
libera la retención y marca la solicitud como `rejected`.

Cada `PaymentIntent` pide la retención ampliada (`request_extended_authorization: if_available`).
**Stripe tiene que tenerla activada en tu cuenta**; si no, la retención Mastercard también dura 7 días.
El panel muestra la fecha en que caduca cada retención y avisa en rojo si caduca antes de la visita.

## Estructura

```
server.js          API, webhook de Stripe, panel de administración
lib/config.js      Lectura de .env
lib/dates.js       Ventana de fechas reservables (Europe/Madrid)
lib/booking.js     Validación y cálculo de precio
lib/db.js          SQLite (node:sqlite, sin dependencias nativas)
public/            Web (index, estilos, textos ES/EN en i18n.js) y panel /admin
test/              Tests de fechas y validación
```

## Pendiente antes de publicar

- Precios, textos comerciales y FAQ reales (`.env` y `public/i18n.js`).
- Páginas legales: condiciones de reserva, política de privacidad y aviso legal. Se guardan
  números de pasaporte, así que hay que cumplir el RGPD (base legal, plazo de conservación, borrado).
- Aviso por email al recibir una solicitud (hoy solo se ven en `/admin`; Stripe envía el recibo al cobrar).
- Alojamiento con Node ≥ 22.13 y disco persistente para la base de datos, siempre bajo HTTPS.
