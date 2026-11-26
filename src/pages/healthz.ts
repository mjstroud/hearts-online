import type { APIRoute } from 'astro';
import { sql } from '../lib/server/db';

/**
 * Health check for the host (Fly.io polls it). Answering it also runs the middleware's
 * first-request boot, so computer players resume right after a restart or deploy.
 */
export const GET: APIRoute = () => {
  try {
    sql('SELECT 1').get();
    return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('database unavailable', { status: 503 });
  }
};
