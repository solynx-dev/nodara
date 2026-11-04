import { BRAND, BRAND_GRADIENT_CSS } from '@nodara/shared';
import type { Ctx } from '../context.js';

/**
 * The emails Nodara sends. Each one has a plain-text body and a simple HTML
 * version. Emails that ask for an action carry both a link (for a browser) and
 * a 6-digit code (to type into the app).
 */
export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

interface Parts {
  subject: string;
  /** Short heading at the top of the HTML email. */
  heading: string;
  /** Paragraphs before the code / button. */
  lines: string[];
  code?: string;
  link?: { url: string; label: string };
  /** Paragraphs after the code / button. */
  after?: string[];
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function render(instance: string, p: Parts): EmailContent {
  const text = [
    ...p.lines,
    ...(p.code ? [`Your code: ${p.code}`] : []),
    ...(p.link ? [`${p.link.label}:\n${p.link.url}`] : []),
    ...(p.after ?? []),
    `— ${instance}`,
  ].join('\n\n');

  const para = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#474b66">${esc(s).replace(/\n/g, '<br>')}</p>`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7fb;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;padding:28px 26px">
<tr><td>
<div style="height:4px;border-radius:4px;margin:0 0 20px;background:${BRAND.purple};background-image:${BRAND_GRADIENT_CSS}"></div>
<div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${BRAND.purple};margin-bottom:10px">${esc(instance)}</div>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#12132a">${esc(p.heading)}</h1>
${p.lines.map(para).join('\n')}
${
  p.code
    ? `<div style="margin:6px 0 18px;padding:14px 0;border-radius:14px;background:#f1f0f8;text-align:center;font-size:32px;font-weight:700;letter-spacing:.3em;color:#12132a;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(p.code)}</div>`
    : ''
}
${
  p.link
    ? `<p style="margin:0 0 18px"><a href="${esc(p.link.url)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${BRAND.purple};color:#ffffff;font-weight:600;font-size:15px;text-decoration:none">${esc(p.link.label)}</a></p>`
    : ''
}
${(p.after ?? []).map(para).join('\n')}
</td></tr></table>
<p style="margin:14px 0 0;font-size:12px;color:#666b88">Sent by ${esc(instance)}. You're getting this because of activity on your account.</p>
</td></tr></table>
</body></html>`;
  return { subject: p.subject, text, html };
}

const mask = (email: string) => {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
};

export const emails = {
  verify: (ctx: Ctx, link: string, code: string) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `Verify your ${ctx.config.INSTANCE_NAME} email`,
      heading: 'Confirm your email',
      lines: ['Enter this code in the app to confirm your email address:'],
      code,
      link: { url: link, label: 'Or confirm in your browser' },
      after: ["The code expires in 48 hours. If you didn't create an account, you can ignore this email."],
    }),

  reset: (ctx: Ctx, link: string, code: string) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `Reset your ${ctx.config.INSTANCE_NAME} password`,
      heading: 'Reset your password',
      lines: ['Someone (hopefully you) asked to reset your password. Enter this code in the app:'],
      code,
      link: { url: link, label: 'Or choose a new password in your browser' },
      after: ["The code expires in 2 hours. If you didn't ask for this, ignore this email; your password won't change."],
    }),

  changeEmail: (ctx: Ctx, link: string, code: string, oldEmail: string) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `Confirm your new ${ctx.config.INSTANCE_NAME} email`,
      heading: 'Confirm your new email',
      lines: [`You asked to change the email on your ${ctx.config.INSTANCE_NAME} account from ${oldEmail} to this address. Enter this code in the app to confirm:`],
      code,
      link: { url: link, label: 'Or confirm in your browser' },
      after: ["The code expires in 24 hours. If you didn't ask for this, ignore this email."],
    }),

  changeRequested: (ctx: Ctx, newEmail: string) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `Email change requested on ${ctx.config.INSTANCE_NAME}`,
      heading: 'Email change requested',
      lines: [
        `Someone signed in to your account asked to change its email to ${mask(newEmail)}. Nothing changes until the new address is confirmed.`,
        "If this wasn't you, sign in and change your password now, and check your active sessions.",
      ],
    }),

  emailChanged: (ctx: Ctx, newEmail: string) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `Your ${ctx.config.INSTANCE_NAME} email was changed`,
      heading: 'Your email was changed',
      lines: [
        `The email on your ${ctx.config.INSTANCE_NAME} account is now ${mask(newEmail)}. This address won't receive account emails any more.`,
        "If this wasn't you, contact your server administrator right away.",
      ],
    }),

  /** Short "something changed on your account" notices. */
  security: (ctx: Ctx, what: string, detail: string) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `${what} — ${ctx.config.INSTANCE_NAME}`,
      heading: what,
      lines: [detail, "If this wasn't you, reset your password and review your active sessions in Settings → Account."],
    }),

  welcome: (ctx: Ctx, link: string) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `Your ${ctx.config.INSTANCE_NAME} account`,
      heading: 'An account was made for you',
      lines: [`An administrator created a ${ctx.config.INSTANCE_NAME} account for this email. Choose a password to finish setting it up.`],
      link: { url: link, label: 'Choose a password' },
      after: ['The link expires in 7 days.'],
    }),

  test: (ctx: Ctx) =>
    render(ctx.config.INSTANCE_NAME, {
      subject: `${ctx.config.INSTANCE_NAME} test email`,
      heading: 'Email is working',
      lines: [`This is a test from ${ctx.config.PUBLIC_URL}. Verification codes, password resets and security notices will arrive like this.`],
    }),
};

/** Send a security notice to a person's current address (never blocks the request). */
export async function notifySecurity(ctx: Ctx, userId: string, what: string, detail: string) {
  const [u] = await ctx.sql<{ email: string; is_demo: boolean }[]>`SELECT email, is_demo FROM users WHERE id = ${userId}`;
  if (!u || u.is_demo) return;
  void ctx.mailer.send(u.email, emails.security(ctx, what, detail));
}
