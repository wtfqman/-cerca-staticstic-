import pino from 'pino';

import { config } from '../config';

const transport =
  config.app.env === 'development'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      })
    : undefined;

export const logger = pino(
  {
    level: config.app.logLevel
  },
  transport
);
