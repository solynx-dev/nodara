import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';

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

  async send(to: string, subject: string, text: string) {
    this.outbox.push({ to, subject, text });
    if (this.outbox.length > 50) this.outbox.shift();
    if (!this.transport) {
      this.log.info({ to, subject }, `[mail disabled] ${subject}\n${text}`);
      return;
    }
    try {
      await this.transport.sendMail({ from: this.config.SMTP_FROM, to, subject, text });
    } catch (err) {
      this.log.error({ err, to, subject }, 'failed to send email');
    }
  }
}
