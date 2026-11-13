import { env } from '../../config/env';
import { appConfig } from '../../config/app.config';
import pino from 'pino';

const log = pino({ level: env.LOG_LEVEL, name: 'mailer' });

/**
 * Delivery hook for password-reset links. Outside production the link is logged so the flow
 * works end-to-end locally. Wire an SMTP/API provider here before enabling it in production.
 */
export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  if (appConfig.isProduction) {
    log.warn({ to }, 'Password reset requested but no mail provider is configured');
    return;
  }
  log.info({ to, link }, 'Password reset link (development delivery)');
}

/** Second-factor sign-in code. Same delivery caveat as above. */
export async function sendMfaCodeEmail(to: string, code: string): Promise<void> {
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
  if (appConfig.isProduction) {
    log.warn({ to, subject }, 'Notification email skipped: no mail provider is configured');
    return;
  }
  log.info({ to, subject, body }, 'Notification email (development delivery)');
}
