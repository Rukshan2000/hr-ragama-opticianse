import { env } from '../../config/env';
import { appConfig } from '../../config/app.config';
import nodemailer from 'nodemailer';
import pino from 'pino';

const log = pino({ level: env.LOG_LEVEL, name: 'mailer' });

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      // Internal relay (postfix on the Docker network) has no certificate for its service name.
      tls: { rejectUnauthorized: false },
    })
  : null;

/** Sends through SMTP when configured; never throws, so a mail outage can't break a request. */
async function send(to: string, subject: string, text: string): Promise<boolean> {
  if (!transport) return false;
  try {
    await transport.sendMail({ from: `InvoTeam <${env.MAIL_FROM}>`, to, subject, text });
    log.info({ to, subject }, 'Email sent');
  } catch (err) {
    log.error({ err, to, subject }, 'Email delivery failed');
  }
  return true;
}

/**
 * Delivery hook for password-reset links. Outside production the link is logged so the flow
 * works end-to-end locally. Wire an SMTP/API provider here before enabling it in production.
 */
export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const sent = await send(
    to,
    'InvoTeam: reset your password',
    `Someone asked to reset your InvoTeam password.\n\nOpen this link to choose a new one (it expires soon):\n${link}\n\nIf this wasn't you, ignore this email.`,
  );
  if (sent) return;
  if (appConfig.isProduction) {
    log.warn({ to }, 'Password reset requested but no mail provider is configured');
    return;
  }
  log.info({ to, link }, 'Password reset link (development delivery)');
}

/** Second-factor sign-in code. Same delivery caveat as above. */
export async function sendMfaCodeEmail(to: string, code: string): Promise<void> {
  const sent = await send(
    to,
    `InvoTeam sign-in code: ${code}`,
    `Your InvoTeam sign-in code is ${code}.\n\nIt expires in a few minutes. If you didn't try to sign in, change your password.`,
  );
  if (sent) return;
  if (appConfig.isProduction) {
    log.warn({ to }, 'MFA email code requested but no mail provider is configured');
    return;
  }
  log.info({ to, code }, 'MFA sign-in code (development delivery)');
}

/** In-app notification mirrored to email when the user opted in. Same delivery caveat as above. */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  if (await send(to, subject, body)) return;
  if (appConfig.isProduction) {
    log.warn({ to, subject }, 'Notification email skipped: no mail provider is configured');
    return;
  }
  log.info({ to, subject, body }, 'Notification email (development delivery)');
}
