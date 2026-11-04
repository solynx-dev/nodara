import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';

export interface MailMessage {
  subject: string;
  text: string;
  html?: string;
}

/**
 * Optional SMTP email. Without SMTP_URL, messages are written to the server log
 * so a self-hoster can still complete verification/reset flows on a LAN.
 */
export class Mailer {
  private transport: Transporter | null;
  readonly enabled: boolean;
  /** Last messages, kept for tests and the dev log. */
  readonly outbox: { to: string; subject: string; text: string }[] = [];

  constructor(
    private config: Config,
    private log: FastifyBaseLogger,
  ) {
    this.transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
    this.enabled = Boolean(this.transport);
  }

  /** Send, logging (not throwing) on failure. */
  async send(to: string, message: MailMessage): Promise<void>;
  async send(to: string, subject: string, text: string): Promise<void>;
  async send(to: string, a: MailMessage | string, b?: string) {
    const m: MailMessage = typeof a === 'string' ? { subject: a, text: b ?? '' } : a;
    try {
      await this.deliver(to, m);
    } catch (err) {
      this.log.error({ err, to, subject: m.subject }, 'failed to send email');
    }
  }

  /** Send and report failure to the caller (for the admin "send a test email" button). */
  async deliver(to: string, m: MailMessage) {
    this.outbox.push({ to, subject: m.subject, text: m.text });
    if (this.outbox.length > 50) this.outbox.shift();
    if (!this.transport) {
      this.log.info({ to, subject: m.subject }, `[mail disabled] ${m.subject}\n${m.text}`);
      return;
    }
    await this.transport.sendMail({ from: this.config.SMTP_FROM, to, subject: m.subject, text: m.text, html: m.html });
  }
}
