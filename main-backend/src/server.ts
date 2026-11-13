import { env } from './config/env';
import { buildApp } from './app';
import { checkDatabase, db } from './database/knex';
import { startJobs } from './modules/jobs';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  const app = await buildApp();

  try {
    await checkDatabase();
    app.log.info('Database connection established');
  } catch (err) {
    app.log.fatal({ err }, 'Cannot connect to database');
    await db.destroy().catch(() => undefined);
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down gracefully');
    const force = setTimeout(() => {
      app.log.error('Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    try {
      await app.close(); // stops accepting connections, drains in-flight requests
      await db.destroy();
      app.log.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) =>
    app.log.error({ err: reason }, 'Unhandled rejection'),
  );
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.fatal({ err }, 'Failed to bind HTTP server');
    await db.destroy();
    process.exit(1);
  }
  startJobs(app.log);
  app.log.info(`${env.APP_NAME} listening on ${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
}

void main();
