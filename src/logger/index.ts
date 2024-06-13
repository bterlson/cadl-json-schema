import Pino from "pino";

export const baseLogger = Pino({
  level: 'trace',
  transport: {
    target: './pino-pretty-transport.js',
  },
});