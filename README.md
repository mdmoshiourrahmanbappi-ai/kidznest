# Kidz Nest Play Café: backend

Node/Express + SQLite. Serves the website (`public/index.html`), the API, the Stripe payment flow and the `/admin` dashboard from **one app on one domain**.

## What it does
| Website feature | Endpoint |
|---|---|
| Live seat counts (30 per session) | `GET /api/availability` |
| Pay by card / Apple Pay / Google Pay | `POST /api/checkout/create-session` → Stripe Checkout |
| Booking confirmed only after Stripe confirms payment | `POST /api/webhooks/stripe` (+ recovery on the success page and a 5-minute sweeper) |
| Confirmation screen, My Bookings | `GET /api/checkout/session/:id`, `GET /api/bookings/by-email/:email` |
| Free membership, 3% discount, rewards | `POST /api/members/join`, `GET /api/members/lookup` |
| Reviews (held until you approve) | `GET/POST /api/reviews` |
| AI chat widget | `POST /api/chat` (falls back to built-in answers if no key) |
| Gallery & Videos: **only the owner uploads** (Admin → Photos & Videos); visitors can only view | `GET /api/media`, files at `/media/...` |
| Owner dashboard: bookings, refunds, members, reviews, photos/videos, closures, CSV | `/admin` |

Prices are recalculated on the server; anything the browser says about money is ignored. Prices, slots, promo rules and capacity live in `lib/config.js` and **must match the website**.

## Go live (step by step)
1. **Hosting.** Needs a host that runs Node 20+ with a *persistent disk* (SQLite lives on it). Render: push this folder to a private GitHub repo → Render → New → Blueprint → pick the repo (`render.yaml` is included). Free plans have no disk, so use a paid one. If the client's hosting is ordinary shared/cPanel hosting without Node support, use Render and only point the domain at it.
2. **Environment variables** (Render → Environment). See `.env.example`. Required: `BASE_URL` (https address), `ADMIN_PASSWORD` (12+ chars), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. The server refuses to start in production without them.
3. **Stripe.** Dashboard → Developers → API keys (start with *test* keys). Then Developers → Webhooks → Add endpoint `https://YOUR-DOMAIN/api/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Settings → Payment methods: make sure Apple Pay and Google Pay are on (they appear automatically on Stripe's checkout page).
4. **Test with Stripe test card** `4242 4242 4242 4242`, any future date/CVC: book, pay, check the confirmation, My Bookings and `/admin`.
5. **Domain.** Render → Settings → Custom Domains → add `www.kidznestplaycafe.co.uk`; at the registrar add the DNS record Render shows (a CNAME for `www`, plus the redirect/A record for the bare domain). HTTPS is automatic. Update `BASE_URL` and the Stripe webhook URL to the final domain.
6. **Go live:** swap to Stripe *live* keys + a new live webhook secret.
7. **Email (optional but recommended):** add SMTP details (e.g. Resend/Brevo/Gmail app password). Customers then get confirmations and you get new-booking alerts.
8. **AI chat (optional):** add `ANTHROPIC_API_KEY`.

## Operations
- Dashboard: `https://YOUR-DOMAIN/admin` (user `ADMIN_USER`, default `admin`).
- Refunds: Admin → Cancel → OK to refund (sent to Stripe, seats freed).
- Backups: automatic daily copy in `DATA_DIR/backups` (last 14). Also download a copy regularly from your host.
- Photos/videos: Admin → Photos & Videos. Photos up to 15 MB, videos up to 50 MB (MP4/MOV/WebM). Files are stored in `DATA_DIR/media`, on the same persistent disk as the database, so include that folder in backups.
- Tests: `npm install && npm test` (36 tests, includes the real website running against the API).
