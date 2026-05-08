import app from './app';
import { config } from './config';

const server = app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on ${config.host}:${config.port} in ${config.nodeEnv} mode`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});
