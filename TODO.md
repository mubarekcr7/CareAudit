

## Durable account persistence

- [x] The project has managed server and MySQL database capabilities enabled, with deployment configured through `Dockerfile` and `/api/health`.
- [x] The server bootstraps durable `careaudit_users` and `careaudit_sessions` tables, seeds the initial admin account as `admin` / `12345678`, and preserves subsequent account edits across restarts.
- [x] Login, logout, session validation, inspector creation, inspector activation, inspector password reset, and admin credential updates use same-origin server API routes with HTTP-only secure cookies.
- [x] The standard development command starts Vite and the database API together; the production build and server syntax checks pass; managed diagnostics remain registered.
- [x] Preview verification confirmed admin login, database-backed inspector creation and roster refresh, and inspector login with the persisted account.
