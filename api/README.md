# kallax-api

Cloudflare Worker for accounts (email + 6-digit code) and project sync.

- Route: `kallax.abpq.cc/api/*` (same origin as the Pages app)
- D1: `kallax-db` (schema in `schema.sql`)
- Email: Cloudflare Email Service `send_email` binding, sender `noreply@abpq.cc`
- Session: random token in an HttpOnly / Secure / SameSite=Lax cookie (`kd_session`, 90 days), only its SHA-256 is stored
- Codes: 6 digits, stored hashed, 10 min, 5 attempts; rate limits 1/30 s and 5/h per email, 20/h per IP

Deploy: `npx wrangler deploy` from this folder.
