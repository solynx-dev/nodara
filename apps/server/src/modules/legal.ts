import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import type { Ctx } from '../context.js';

/**
 * Public privacy policy at /privacy-policy, rendered on the server as plain
 * HTML (no JavaScript, no sign-in) so it works for app-store reviewers, the
 * iOS app, and any browser. The text comes from PRIVACY.md at the repository
 * root (copied into the Docker image); set PRIVACY_POLICY_FILE to serve your
 * own Markdown file instead.
 */
export function findPolicyFile(): string | null {
  const configured = process.env.PRIVACY_POLICY_FILE;
  if (configured) return existsSync(configured) ? resolve(configured) : null;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'PRIVACY.md');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const slug = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/&#?\w+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function renderPolicy(markdown: string, instanceName: string): string {
  // `breaks` keeps "Effective Date" and "Last Updated" on separate lines.
  const body = (new Marked({ gfm: true, breaks: true }).parse(markdown) as string)
    // Anchor every section so it can be linked to (…/privacy-policy#4-optional-anonymous-usage-analytics).
    .replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => `<h${level} id="${slug(inner)}">${inner}</h${level}>`)
    .replace(/<a href="(https?:\/\/[^"]+)">/g, '<a href="$1" rel="noopener noreferrer">');
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? 'Privacy Policy';
  const sections = [...body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(([, id, text]) => ({ id: id!, text: text!.replace(/<[^>]+>/g, '') }));
  const toc = sections.length
    ? `<nav class="toc" aria-label="Contents"><p class="toc-title">Contents</p><ol>${sections.map((s) => `<li><a href="#${s.id}">${s.text.replace(/^\d+\.\s*/, '')}</a></li>`).join('')}</ol></nav>`
    : '';
  // Contents go right before the first numbered section.
  const withToc = body.replace(/<h2 /, `${toc}<h2 `);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="How Nodara handles your information: self-hosted, your location stays on the server you choose.">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.png">
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#16181d;--ink2:#545a66;--line:#e6e3dc;--accent:#ff6b3d;--accent-ink:#d94a1f;--soft:#fff1eb}
@media (prefers-color-scheme:dark){:root{--bg:#0c0e12;--card:#15181e;--ink:#eef0f3;--ink2:#a3a9b5;--line:#262a32;--accent:#ff7a4d;--accent-ink:#ff9a75;--soft:#2a1a14}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
header{position:sticky;top:0;z-index:1;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:saturate(180%) blur(14px);-webkit-backdrop-filter:saturate(180%) blur(14px);border-bottom:1px solid var(--line)}
.bar{max-width:760px;margin:0 auto;padding:12px max(20px,env(safe-area-inset-left));display:flex;align-items:center;gap:10px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:800;font-size:18px;letter-spacing:-.2px}
.brand svg{width:28px;height:28px}
.bar .spacer{flex:1}
.bar .open{color:var(--accent-ink);text-decoration:none;font-weight:600;font-size:15px}
main{max-width:760px;margin:0 auto;padding:28px max(20px,env(safe-area-inset-left)) 64px}
article{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:28px clamp(20px,5vw,44px) 36px}
h1{font-size:clamp(30px,6vw,40px);line-height:1.15;letter-spacing:-.6px;margin:.2em 0 .5em}
h2{font-size:22px;line-height:1.3;letter-spacing:-.2px;margin:2em 0 .5em;padding-top:1.2em;border-top:1px solid var(--line);scroll-margin-top:80px}
h3{font-size:18px;margin:1.6em 0 .4em;scroll-margin-top:80px}
p{margin:.7em 0}
ul,ol{padding-left:1.3em}
li{margin:.3em 0}
li::marker{color:var(--accent)}
strong{font-weight:700}
a{color:var(--accent-ink);text-underline-offset:3px}
hr{border:0;border-top:1px solid var(--line);margin:2.4em 0}
h1+p{color:var(--ink2);font-size:15px}
h1+p strong{color:var(--ink)}
.toc{margin:1.8em 0 0;padding:16px 20px;border-radius:16px;background:var(--soft)}
.toc-title{margin:0 0 .3em;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink2)}
.toc ol{margin:0;columns:2;column-gap:28px;font-size:15px}
.toc li{break-inside:avoid;margin:0 0 .35em}
.toc a{text-decoration:none}
@media (max-width:560px){.toc ol{columns:1}main{padding:12px 16px 40px}article{border:0;background:transparent;padding:4px 2px 16px;border-radius:0}h2{scroll-margin-top:72px}}
hr~h3,hr~h3~p{text-align:center}
hr~h3~p strong{color:var(--accent-ink)}
footer{max-width:760px;margin:0 auto;padding:0 20px 48px;color:var(--ink2);font-size:14px;text-align:center}
footer a{color:var(--ink2)}
@media print{header,.toc,footer{display:none}body{background:#fff}article{border:0;padding:0}}
</style>
</head>
<body>
<header><div class="bar">
<a class="brand" href="/"><svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB547"/><stop offset="1" stop-color="#FF5A2B"/></linearGradient></defs><path d="M32 58S14 41.5 14 26a18 18 0 0 1 36 0c0 15.5-18 32-18 32z" fill="none" stroke="url(#g)" stroke-width="6" stroke-linejoin="round"/><circle cx="32" cy="26" r="6.5" fill="url(#g)"/><circle cx="51" cy="8" r="4" fill="#FFB547"/></svg>${escapeHtml(instanceName)}</a>
<span class="spacer"></span><a class="open" href="/">Open Nodara</a>
</div></header>
<main><article>
${withToc}
</article></main>
<footer><p><a href="https://github.com/solynx-dev/nodara" rel="noopener noreferrer">Nodara on GitHub</a> · Open source under the AGPL-3.0</p></footer>
</body>
</html>`;
}

export default async function legalRoutes(app: FastifyInstance, ctx: Ctx) {
  let cache: { file: string; html: string } | null = null;
  const page = () => {
    const file = findPolicyFile();
    if (!file) return null;
    // Rendered once; restart (or redeploy) to pick up edits.
    if (cache?.file !== file) cache = { file, html: renderPolicy(readFileSync(file, 'utf8'), ctx.config.INSTANCE_NAME) };
    return cache.html;
  };

  app.get('/privacy-policy', async (_req, reply) => {
    const html = page();
    if (!html) return reply.code(404).type('text/plain').send('No privacy policy is configured on this server.');
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'public, max-age=600').send(html);
  });
  app.get('/privacy', async (_req, reply) => reply.redirect('/privacy-policy', 301));
}
