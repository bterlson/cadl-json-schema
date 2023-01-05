import PinoPretty, { PrettyOptions } from 'pino-pretty';
export default (opts: PrettyOptions) =>
  PinoPretty({
    ...opts,
    levelFirst: true,
    ignore: 'time,pid,hostname',
    messageFormat: (log, key) => {
      const msg = log.module ?
      `[${log.module}] ${log[key]}` :
      log[key];

      delete log.module;
      return msg as string;
    }
  });