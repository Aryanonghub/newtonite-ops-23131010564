import { createApp } from './app';
import { config } from './config';
import { log } from './logger';

createApp().listen(config.port, () => {
  log('info', 'API listening', { port: config.port });
});
