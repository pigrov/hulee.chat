export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: unknown;
};

export type SerializedError = {
  name: string;
  message: string;
  code?: string;
  stack?: string;
};

export type SerializedLogRecord = {
  timestamp: string;
  service: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: SerializedError | { value: string };
};

export type Logger = {
  log(record: LogRecord): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ): void;
  error(
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ): void;
};

export type JsonLoggerOptions = {
  service: string;
  defaultContext?: Record<string, unknown>;
  includeStack?: boolean;
  now?: () => Date;
  sink?: (line: string) => void;
};

const logLevelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function errorCode(error: Error): string | undefined {
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }

  return undefined;
}

export function serializeError(
  error: unknown,
  includeStack = false
): SerializedError | { value: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: errorCode(error),
      stack: includeStack ? error.stack : undefined
    };
  }

  return {
    value: String(error)
  };
}

export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const sink = options.sink ?? console.log;
  const now = options.now ?? (() => new Date());

  const write = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ) => {
    const mergedContext =
      options.defaultContext === undefined && context === undefined
        ? undefined
        : {
            ...options.defaultContext,
            ...context
          };
    const record: SerializedLogRecord = {
      timestamp: now().toISOString(),
      service: options.service,
      level,
      message,
      context: mergedContext,
      error:
        error === undefined
          ? undefined
          : serializeError(error, options.includeStack ?? false)
    };

    sink(JSON.stringify(record));
  };

  return {
    log(record) {
      write(record.level, record.message, record.context, record.error);
    },
    debug(message, context) {
      write("debug", message, context);
    },
    info(message, context) {
      write("info", message, context);
    },
    warn(message, context, error) {
      write("warn", message, context, error);
    },
    error(message, context, error) {
      write("error", message, context, error);
    }
  };
}

export function createConsoleLogger(service = "hulee"): Logger {
  return createJsonLogger({ service });
}

export function createLevelFilteredLogger(
  logger: Logger,
  minimumLevel: LogLevel
): Logger {
  const shouldLog = (level: LogLevel) =>
    logLevelRank[level] >= logLevelRank[minimumLevel];

  return {
    log(record) {
      if (shouldLog(record.level)) {
        logger.log(record);
      }
    },
    debug(message, context) {
      if (shouldLog("debug")) {
        logger.debug(message, context);
      }
    },
    info(message, context) {
      if (shouldLog("info")) {
        logger.info(message, context);
      }
    },
    warn(message, context, error) {
      if (shouldLog("warn")) {
        logger.warn(message, context, error);
      }
    },
    error(message, context, error) {
      if (shouldLog("error")) {
        logger.error(message, context, error);
      }
    }
  };
}
