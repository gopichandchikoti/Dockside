import { loadConfig, ConfigError } from './config';
import { createContext } from './context';
import { openDatabase } from './db/database';
import { migrate } from './db/migrate';
import { buildApp } from './app';
import { startScheduler } from './services/scheduler';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const db = openDatabase(config.databasePath);
  migrate(db);
  const ctx = createContext(config, db);
  const app = await buildApp(ctx);

  const stopScheduler = startScheduler(ctx, () => app.log.error('Scheduled collection failed.'));

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    await stopScheduler();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError ? error.message : error instanceof Error ? error.stack : String(error);
  process.stderr.write(`Dockside failed to start: ${message}\n`);
  process.exit(1);
});
