import { randomUUID } from "node:crypto";
import tls from "node:tls";

import lz4 from "lz4js";
import { pack, unpack } from "msgpackr";

export class MaxSocketDisconnectedError extends Error {
  readonly opcode: number;

  constructor(opcode: number) {
    super("MAX socket disconnected");
    this.name = "MaxSocketDisconnectedError";
    this.opcode = opcode;
  }
}

export class MaxSocketRequestError extends Error {
  readonly opcode: number;
  readonly code: string;
  readonly localizedMessage: string;
  readonly payload: unknown;

  constructor(opcode: number, payload: unknown) {
    const record = isRecord(payload) ? payload : {};
    const message =
      readOptionalString(record.message) ??
      readOptionalString(record.localizedMessage) ??
      "MAX request failed";

    super(message);
    this.name = "MaxSocketRequestError";
    this.opcode = opcode;
    this.code = readOptionalString(record.error) ?? "unknown";
    this.localizedMessage =
      readOptionalString(record.localizedMessage) ??
      readOptionalString(record.message) ??
      "MAX returned an unknown error.";
    this.payload = payload ?? null;
  }
}

export type MaxAuthTransportClientConfig = {
  allowedEarlyOpcodes: ReadonlySet<number>;
  authTimeoutMs: number;
  buildMaxHandshakePayload(deviceId: string, locale: string): unknown;
  connect(options: tls.ConnectionOptions): tls.TLSSocket;
  createDeviceId(): string;
  defaultLocale: string;
  protocolVersion: number;
  socketHost: string;
  socketPort: number;
};

export type MaxAuthTransportClientOptions = {
  config: MaxAuthTransportClientConfig;
  deviceId?: string;
  locale?: string;
};

export type CreateMaxAuthTransportClientFactoryOptions = {
  allowedEarlyOpcodes?: Iterable<number>;
  authTimeoutMs?: number;
  buildMaxHandshakePayload(deviceId: string, locale: string): unknown;
  connect?: (options: tls.ConnectionOptions) => tls.TLSSocket;
  createDeviceId?: () => string;
  defaultLocale?: string;
  protocolVersion?: number;
  socketHost?: string;
  socketPort?: number;
};

export type MaxAuthTransportClientFactoryInput = {
  deviceId?: string;
  locale?: string;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

function getLoginAuth(payload: unknown): {
  token: string;
  viewerId: string;
} | null {
  const record = isRecord(payload) ? payload : {};
  const tokenAttrs = isRecord(record.tokenAttrs) ? record.tokenAttrs : {};
  const login = isRecord(tokenAttrs.LOGIN) ? tokenAttrs.LOGIN : {};
  const profile = isRecord(record.profile) ? record.profile : {};
  const contact = isRecord(profile.contact) ? profile.contact : {};
  const token =
    readOptionalString(record.token) ?? readOptionalString(login.token);
  const viewerId = readOptionalId(contact.id);

  return token && viewerId ? { token, viewerId } : null;
}

function readCompressionFrame(input: number): {
  compressionFlag: number;
  payloadLength: number;
} {
  return {
    compressionFlag: input >>> 24,
    payloadLength: input & 0x00ffffff
  };
}

export class MaxAuthTransportClient {
  readonly config: MaxAuthTransportClientConfig;
  readonly deviceId: string;
  readonly locale: string;
  auth: { token: string; viewerId: string } | null = null;

  private socket: tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private nextSeq = 0;
  private pending = new Map<number, PendingRequest>();

  constructor({ config, deviceId, locale }: MaxAuthTransportClientOptions) {
    this.config = config;
    this.deviceId = deviceId || config.createDeviceId();
    this.locale = locale || config.defaultLocale;
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = this.config.connect({
        host: this.config.socketHost,
        port: this.config.socketPort,
        servername: this.config.socketHost
      });
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        reject(new Error("MAX_SOCKET_CONNECT_TIMEOUT"));
      }, this.config.authTimeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeAllListeners("secureConnect");
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
      };

      socket.on("secureConnect", () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        socket.setKeepAlive(true);
        socket.setNoDelay(true);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.on("data", (data) => {
          this.handleData(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
        socket.on("close", () => {
          this.handleClose();
        });
        socket.on("error", () => undefined);
        resolve();
      });

      socket.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      });

      socket.on("close", () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(new Error("MAX_SOCKET_CLOSED_BEFORE_OPEN"));
      });
    });

    await this.cmd(
      6,
      this.config.buildMaxHandshakePayload(this.deviceId, this.locale)
    );
  }

  send(frame: {
    cmd: number;
    opcode: number;
    payload?: unknown;
    seq?: number;
  }): number {
    if (!this.socket || this.socket.destroyed) {
      throw new MaxSocketDisconnectedError(frame.opcode);
    }

    const seq = (frame.seq ?? this.nextSeq++) % 256;
    const payloadBuffer =
      frame.payload === undefined
        ? Buffer.alloc(0)
        : Buffer.from(pack(frame.payload));
    const header = Buffer.alloc(10);

    header.writeUInt8(this.config.protocolVersion, 0);
    header.writeUInt16BE(frame.cmd, 1);
    header.writeUInt8(seq, 3);
    header.writeUInt16BE(frame.opcode, 4);
    header.writeUInt32BE(payloadBuffer.length, 6);

    if (
      frame.cmd === 0 &&
      !this.config.allowedEarlyOpcodes.has(frame.opcode) &&
      !this.auth
    ) {
      throw new Error(`MAX_AUTH_REQUIRED_FOR_OPCODE_${frame.opcode}`);
    }

    this.socket.write(Buffer.concat([header, payloadBuffer]));
    return seq;
  }

  async cmd(
    opcode: number,
    payload: unknown,
    options: { timeoutMs?: number } = {}
  ): Promise<unknown> {
    const seq = this.nextSeq++ % 256;

    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`MAX_CMD_TIMEOUT_${opcode}`));
      }, options.timeoutMs || this.config.authTimeoutMs);

      this.pending.set(seq, {
        resolve: (value) => {
          clearTimeout(timeout);
          this.pending.delete(seq);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.pending.delete(seq);
          reject(error);
        }
      });

      try {
        this.send({ cmd: 0, opcode, payload, seq });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(seq);
        reject(error);
      }
    });
  }

  private decodePayload(
    payloadBytes: Buffer,
    compressionFlag: number
  ): unknown {
    if (!payloadBytes.length) {
      return null;
    }

    let body = payloadBytes;

    if (compressionFlag !== 0) {
      let outputSize = Math.max(65_536, payloadBytes.length * 8);
      let decoded: Buffer | null = null;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const output = new Uint8Array(outputSize);
        const written = lz4.decompressBlock(
          payloadBytes,
          output,
          0,
          payloadBytes.length,
          0
        );

        if (written <= output.length) {
          decoded = Buffer.from(output.subarray(0, written));
          break;
        }

        outputSize *= 2;
      }

      if (!decoded) {
        throw new Error("MAX_LZ4_DECOMPRESS_FAILED");
      }

      body = decoded;
    }

    return unpack(body);
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 10) {
      const cmd = this.buffer.readUInt16LE(1);
      const seq = this.buffer.readUInt8(3);
      const opcode = this.buffer.readUInt16BE(4);
      const packedLength = this.buffer.readUInt32BE(6);
      const { compressionFlag, payloadLength } =
        readCompressionFrame(packedLength);

      if (this.buffer.length < 10 + payloadLength) {
        return;
      }

      const payloadBytes = this.buffer.subarray(10, 10 + payloadLength);
      this.buffer = this.buffer.subarray(10 + payloadLength);
      let payload: unknown;

      try {
        payload = this.decodePayload(payloadBytes, compressionFlag);
      } catch (error) {
        this.handleClose(error);
        return;
      }

      const messages = Array.isArray(payload)
        ? payload.map((value) => ({
            cmd,
            seq,
            opcode,
            payload: value as unknown
          }))
        : [
            {
              cmd,
              seq,
              opcode,
              payload
            }
          ];

      for (const message of messages) {
        this.handleMessage(message);
      }
    }
  }

  private handleMessage(message: {
    cmd: number;
    seq: number;
    opcode: number;
    payload: unknown;
  }): void {
    if (message.cmd === 1) {
      if ([18, 19, 23, 101, 115, 291].includes(message.opcode)) {
        this.maybeSaveAuth(message.payload);
      } else if (message.opcode === 20) {
        this.auth = null;
      }

      this.pending.get(message.seq)?.resolve(message.payload);
      return;
    }

    if (message.cmd === 3) {
      this.pending
        .get(message.seq)
        ?.reject(new MaxSocketRequestError(message.opcode, message.payload));
    }
  }

  private maybeSaveAuth(payload: unknown): void {
    const auth = getLoginAuth(payload);

    if (auth) {
      this.auth = auth;
    }
  }

  private handleClose(sourceError?: unknown): void {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    const error =
      sourceError instanceof Error
        ? sourceError
        : new Error("MAX_SOCKET_CLOSED");

    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    this.buffer = Buffer.alloc(0);

    await new Promise<void>((resolve) => {
      if (socket.destroyed) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        try {
          socket.destroy();
        } catch {
          // Best effort cleanup for broken TLS sockets.
        }

        resolve();
      }, 2_000);

      socket.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        socket.end();
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
  }
}

export function createMaxAuthTransportClientFactory(
  options: CreateMaxAuthTransportClientFactoryOptions
): (input?: MaxAuthTransportClientFactoryInput) => MaxAuthTransportClient {
  const config: MaxAuthTransportClientConfig = {
    allowedEarlyOpcodes: new Set(options.allowedEarlyOpcodes ?? []),
    authTimeoutMs:
      typeof options.authTimeoutMs === "number"
        ? options.authTimeoutMs
        : 30_000,
    buildMaxHandshakePayload: options.buildMaxHandshakePayload,
    connect: options.connect ?? tls.connect,
    createDeviceId: options.createDeviceId ?? randomUUID,
    defaultLocale: options.defaultLocale || "ru",
    protocolVersion:
      typeof options.protocolVersion === "number"
        ? options.protocolVersion
        : 11,
    socketHost: options.socketHost || "api.oneme.ru",
    socketPort:
      typeof options.socketPort === "number" ? options.socketPort : 443
  };

  return (input = {}) =>
    new MaxAuthTransportClient({
      ...input,
      config
    });
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readOptionalId(value: unknown): string | undefined {
  if (typeof value === "bigint" || typeof value === "number") {
    return String(value);
  }

  return readOptionalString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const maxDirectTransportClientTestUtils = {
  getLoginAuth,
  readCompressionFrame
};
