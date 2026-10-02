import type { APIRoute } from 'astro';
import { SESSION_COOKIE, deleteSession } from '../lib/server/auth';

export const POST: APIRoute = ({ cookies, redirect }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/', 303);
};
