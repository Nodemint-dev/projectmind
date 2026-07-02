# shopflow-api — project map
Order-management HTTP API with JWT auth, backed by PostgreSQL.
Stack: node, express, postgres

## Active
- **auth**: Issues/verifies JWT access tokens; exposes requireAuth Express middleware. [active]
- **orders-route**: Create and list orders for the authenticated user; totals in integer cents. [active]
- **users-route**: Auth endpoints: signup, login, and authenticated /me profile. [active]

## Modules
- **config**: Environment-driven config (port, DATABASE_URL, JWT secret/ttl). Single source of env.
- **db**: PostgreSQL pool wrapper: query() helper and withTransaction().
- **server**: HTTP entrypoint; wires JSON parsing, mounts route modules, error handler.

## Dependencies
- server → users-route (mounts)
- server → orders-route (mounts)
- server → config (depends-on)
- db → config (depends-on)
- auth → config (depends-on)
- users-route → db (calls)
- users-route → auth (calls)
- orders-route → db (calls)
- orders-route → auth (calls)

## Key decisions
- Store money as integer cents, never floats. (2026-06-10)
- Use scrypt for password hashing. (2026-06-12)
- JWT for stateless auth instead of server sessions. (2026-06-15)

## Conventions
- All route handlers are async; thrown errors are converted to 500s by the error middleware.
- Money is stored and computed in integer cents.
- Timestamps are UTC ISO strings.
- Never read process.env outside src/config.js.

## Glossary
- claims: The decoded payload of a verified JWT (sub, email).
- SKU: Stock Keeping Unit — the identifier for a purchasable item.

> Use mind_query(<id>) for file lists and detail; call mind_update after structural changes.
