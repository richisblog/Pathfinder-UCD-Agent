import {
  PROTOCOL_VERSION,
  type BridgeRequest,
  type BridgeResult,
  type BridgeStatus,
} from "../protocol/messages";
import { validateIncomingRequest } from "../protocol/validate";

const BRIDGE_PATH = "/v1/bridge";

export interface SocketLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void;
  removeEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void;
  send(data: string): void;
  close(): void;
}

export interface SocketFactory {
  create(url: string): SocketLike;
}

export interface CredentialStore {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export interface BridgeClientOptions {
  extensionId: string;
  ports: readonly number[];
  sockets: SocketFactory;
  store: CredentialStore;
  openTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  handleRequest?: RequestHandler;
}

export type RequestHandlerResult = Omit<BridgeResult, "protocol" | "id" | "type">;
export type RequestHandler = (request: BridgeRequest) => Promise<RequestHandlerResult>;

interface WireMessage {
  protocol: number;
  type: string;
  status?: BridgeStatus;
  token?: string;
  message?: string;
}

export class BrowserSocketFactory implements SocketFactory {
  create(url: string): SocketLike {
    return new WebSocket(url) as SocketLike;
  }
}

export class ChromeCredentialStore implements CredentialStore {
  private readonly key = "pathfinderBridgeCredential";

  async get(): Promise<string | undefined> {
    const result = await chrome.storage.local.get(this.key);
    const value = result[this.key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  async set(value: string): Promise<void> {
    await chrome.storage.local.set({ [this.key]: value });
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(this.key);
  }
}

export class BridgeClient {
  private readonly extensionId: string;
  private readonly ports: readonly number[];
  private readonly sockets: SocketFactory;
  private readonly store: CredentialStore;
  private readonly openTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly handleRequest: RequestHandler | undefined;
  private socket: SocketLike | undefined;
  private requestListener: ((event: Event | MessageEvent<string>) => void) | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(options: BridgeClientOptions) {
    this.extensionId = options.extensionId;
    this.ports = [...options.ports];
    this.sockets = options.sockets;
    this.store = options.store;
    this.openTimeoutMs = options.openTimeoutMs ?? 800;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
    this.handleRequest = options.handleRequest;
  }

  async connect(): Promise<BridgeStatus> {
    this.disconnect();
    const credential = await this.store.get();
    for (const port of this.ports) {
      const socket = this.sockets.create(`ws://127.0.0.1:${port}${BRIDGE_PATH}`);
      try {
        await waitForOpen(socket, this.openTimeoutMs);
      } catch {
        socket.close();
        continue;
      }
      this.socket = socket;
      if (!credential) return "PAIRING_REQUIRED";
      socket.send(
        JSON.stringify({
          protocol: PROTOCOL_VERSION,
          type: "hello",
          extension_id: this.extensionId,
          token: credential,
        }),
      );
      const response = await waitForWireMessage(socket, this.openTimeoutMs);
      if (response.type !== "hello.result" || response.status !== "OK") {
        if (response.status === "PAIRING_REQUIRED") await this.store.clear();
        socket.close();
        this.socket = undefined;
        return response.status ?? "INTERNAL_ERROR";
      }
      this.installRequestListener(socket);
      this.startHeartbeat(socket);
      return "OK";
    }
    return "EXTENSION_REQUIRED";
  }

  async pair(code: string): Promise<void> {
    if (!/^\d{6}$/.test(code)) throw new Error("pairing code must contain six digits");
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) throw new Error("Pathfinder bridge is not connected");
    socket.send(
      JSON.stringify({
        protocol: PROTOCOL_VERSION,
        type: "pair.exchange",
        extension_id: this.extensionId,
        code,
      }),
    );
    const response = await waitForWireMessage(socket, this.openTimeoutMs);
    if (response.type !== "pair.result" || response.status !== "OK") {
      throw new Error(response.message ?? "pairing was rejected");
    }
    if (typeof response.token !== "string" || response.token.length < 40) {
      throw new Error("Pathfinder returned an invalid pairing credential");
    }
    await this.store.set(response.token);
    socket.close();
    this.socket = undefined;
  }

  disconnect(): void {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    if (this.socket && this.requestListener) {
      this.socket.removeEventListener("message", this.requestListener);
    }
    this.requestListener = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  private startHeartbeat(socket: SocketLike): void {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, type: "keepalive" }));
    }, this.heartbeatIntervalMs);
  }

  private installRequestListener(socket: SocketLike): void {
    if (!this.handleRequest) return;
    const listener = (event: Event | MessageEvent<string>) => {
      if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
      void this.respondToRequest(socket, event.data);
    };
    this.requestListener = listener;
    socket.addEventListener("message", listener);
  }

  private async respondToRequest(socket: SocketLike, raw: string): Promise<void> {
    let request: BridgeRequest;
    try {
      request = validateIncomingRequest(JSON.parse(raw) as unknown);
    } catch (error) {
      const id = safeRequestID(raw);
      if (id && socket.readyState === 1) {
        socket.send(JSON.stringify({
          protocol: PROTOCOL_VERSION,
          id,
          type: "result",
          status: "INVALID_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        } satisfies BridgeResult));
      }
      return;
    }

    let payload: RequestHandlerResult;
    try {
      payload = await this.handleRequest!(request);
    } catch (error) {
      payload = { status: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
    }
    if (this.socket !== socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({
      protocol: PROTOCOL_VERSION,
      id: request.id,
      type: "result",
      ...payload,
    } satisfies BridgeResult));
  }
}

function safeRequestID(raw: string): string | undefined {
  try {
    const value = JSON.parse(raw) as { id?: unknown };
    return typeof value.id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value.id) ? value.id : undefined;
  } catch {
    return undefined;
  }
}

function waitForOpen(socket: SocketLike, timeoutMs: number): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("connection timed out")), timeoutMs);
    const onOpen = () => finish();
    const onError = () => finish(new Error("connection failed"));
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

function waitForWireMessage(socket: SocketLike, timeoutMs: number): Promise<WireMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(undefined, new Error("bridge response timed out")), timeoutMs);
    const onMessage = (event: Event | MessageEvent<string>) => {
      if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
        finish(undefined, new Error("bridge returned a non-text message"));
        return;
      }
      try {
        const value = JSON.parse(event.data) as unknown;
        if (typeof value !== "object" || value === null) throw new Error("message must be an object");
        const message = value as WireMessage;
        if (message.protocol !== PROTOCOL_VERSION || typeof message.type !== "string") {
          throw new Error("unsupported bridge response");
        }
        finish(message);
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onError = () => finish(undefined, new Error("bridge connection failed"));
    const finish = (message?: WireMessage, error?: Error) => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve(message!);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}
