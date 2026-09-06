/*
 * cook-log-service Worker entry.
 *
 * Isolated data-layer Worker for anonymized, opt-in cook logging — no
 * static assets, no shared code with pitmaster-command-center. Routes:
 *   POST  /api/cook-logs
 *   PATCH /api/cook-logs/:id
 */
import type { CookLogEnv } from './server/types';
import { handleCreateCookLog, handlePatchCookLog } from './server/cookLogHandler';

const COOK_LOGS_ID_RE = /^\/api\/cook-logs\/([^/]+)$/;

const methodNotAllowed = (allow: string): Response =>
  new Response(JSON.stringify({ ok: false, error: `Use ${allow}.` }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow },
  });

const notFound = (): Response =>
  new Response(JSON.stringify({ ok: false, error: 'Not found.' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export default {
  async fetch(request: Request, env: CookLogEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/cook-logs') {
      if (request.method === 'POST') return handleCreateCookLog(request, env);
      return methodNotAllowed('POST');
    }

    const match = url.pathname.match(COOK_LOGS_ID_RE);
    if (match) {
      if (request.method === 'PATCH') return handlePatchCookLog(request, env, match[1]);
      return methodNotAllowed('PATCH');
    }

    return notFound();
  },
};
