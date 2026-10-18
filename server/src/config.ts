// All settings come from environment variables. Defaults are for local development only.
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://ops:ops@localhost:5432/ops',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  port: Number(process.env.PORT ?? 3000),
  // Live updates: how often an open item stream checks for changes, and how long one stream stays open
  // (under Vercel's 30 s function limit; the browser reconnects). The tests make both short.
  livePollMs: Number(process.env.LIVE_POLL_MS ?? 1500),
  liveStreamSeconds: Number(process.env.LIVE_STREAM_SECONDS ?? 25),
};
