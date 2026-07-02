# shopflow-api

A small order-management HTTP API. Users authenticate, browse a catalog, and
place orders. Backed by PostgreSQL. This README exists so the benchmark has a
realistic "docs" file to count, the way an agent would read it on session start
to orient itself.

## Architecture

- `src/server.js` — HTTP entrypoint, wires middleware and mounts route modules.
- `src/config.js` — environment-driven configuration (port, database URL, JWT secret).
- `src/db.js` — a thin PostgreSQL connection pool wrapper with a `query()` helper.
- `src/auth.js` — issues and verifies JWT access tokens; exposes `requireAuth` middleware.
- `src/routes/users.js` — signup, login, and profile endpoints.
- `src/routes/orders.js` — create and list orders for the authenticated user.

## Running

```
npm install
DATABASE_URL=postgres://localhost/shopflow JWT_SECRET=dev npm start
```

## Conventions

- All route handlers are `async` and wrapped so thrown errors become 500s.
- Money is stored in integer cents, never floats.
- Timestamps are UTC ISO strings.
