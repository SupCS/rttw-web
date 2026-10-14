import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const defaultDirectory = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const csp = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'",
  "worker-src 'none'", "manifest-src 'self'",
].join('; ');

function contained(directory: string, target: string) {
  const path = relative(directory, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function missing(reply: FastifyReply) {
  return reply.header('cache-control', 'no-store').code(404).send({ error: 'not_found' });
}

/** One origin serves the built website and API; the browser never needs CORS. */
export async function registerWebStatic(app: FastifyInstance, options: { directory?: string; required?: boolean } = {}): Promise<boolean> {
  const requestedDirectory = resolve(options.directory ?? defaultDirectory);
  let directory: string;
  try {
    directory = await realpath(requestedDirectory);
    const index = await realpath(resolve(directory, 'index.html'));
    if (!contained(directory, index) || !(await stat(index)).isFile()) throw new Error('Invalid web build');
  } catch {
    if (options.required ?? process.env.NODE_ENV === 'production') {
      throw new Error('Built website is missing; run npm run build before starting the production server');
    }
    return false;
  }

  const serve = async (request: FastifyRequest, reply: FastifyReply) => {
    let pathname: string;
    try { pathname = decodeURIComponent(request.url.split('?')[0] ?? '/'); }
    catch { return missing(reply); }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
      pathname.split('/').some((part) => part.startsWith('.')) ||
      /^\/(?:api|auth)(?:\/|$)/i.test(pathname)) return missing(reply);
    const candidate = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!contained(directory, candidate)) return missing(reply);
    let file: string;
    try {
      file = await realpath(candidate);
      if (!contained(directory, file) || !(await stat(file)).isFile()) return missing(reply);
    } catch { return missing(reply); }
    const extension = extname(file).toLowerCase();
    const body = await readFile(file);
    const immutable = pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(pathname);
    return reply
      .header('content-security-policy', csp)
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'same-origin')
      .header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
      .header('cache-control', extension === '.html' ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate')
      .type(contentTypes[extension] ?? 'application/octet-stream')
      .send(body);
  };
  // Specific API routes win over the wildcard. Unknown API paths stay JSON 404.
  app.get('/', serve);
  app.get('/*', serve);
  return true;
}
