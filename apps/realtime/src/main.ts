import { loadConfig } from './config';
import { buildApp } from './app';

const config = loadConfig();
const built = await buildApp({ config });

await built.app.listen({ port: config.port, host: config.host });

let stopping = false;
const stop = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  built.app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  built
    .close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      built.app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    });
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
