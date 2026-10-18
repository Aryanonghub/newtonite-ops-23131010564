import { waitUntil } from '@vercel/functions';
import express from 'express';
import { createApp } from './app';
import { processNextJob } from './worker';

// Entry point when deployed on Vercel (see vercel.json and api/index.js). Docker uses index.ts instead.
//
// Vercel has no long-running processes, so there is no separate worker. Instead, after each write
// request, the same function drains the outbox; waitUntil keeps it running after the response is
// sent, so the user never waits for it. Jobs still go through outbox_jobs with FOR UPDATE SKIP LOCKED,
// so two functions draining at once never run the same job, and retries/backoff work as before.
const MAX_JOBS_PER_DRAIN = 25;

async function drainOutbox() {
  for (let i = 0; i < MAX_JOBS_PER_DRAIN; i++) {
    if (!(await processNextJob())) return;
  }
}

const app = express();
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => waitUntil(drainOutbox().catch((err) => console.error('outbox drain failed:', err))));
  }
  next();
});
// Vercel passes the full path (/api/items), so the API is mounted under /api, like nginx does in Docker.
app.use('/api', createApp());

export default app;
