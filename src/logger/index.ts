import Pino from "pino";

export const baseLogger = Pino({
  level: 'warn',
  transport: {
    target: './pino-pretty-transport.js',
  },
});