import { describe, expect, it } from "vitest";

import {
  BridgeClient,
  type CredentialStore,
  type SocketFactory,
  type SocketLike,
} from "../src/background/bridge-client";
import type { BridgeRequest } from "../src/protocol/messages";

class MemoryCredentialStore implements CredentialStore {
  value: string | undefined;

  async get(): Promise<string | undefined> {
    return this.value;
  }

  async set(value: string): Promise<void> {
    this.value = value;
  }

  async clear(): Promise<void> {
    this.value = undefined;
  }
}

class FakeSocket implements SocketLike {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: Event | MessageEvent<string>) => void>>();
  readyState = 0;
  closed = false;

  addEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", new Event("open"));
  }

  fail(): void {
    this.emit("error", new Event("error"));
  }

  message(value: unknown): void {
    this.emit("message", new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  private emit(type: string, event: Event | MessageEvent<string>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeSocketFactory implements SocketFactory {
  readonly urls: string[] = [];
  readonly sockets: FakeSocket[] = [];

  constructor(private readonly outcomes: Array<"open" | "error">) {}

  create(url: string): SocketLike {
    this.urls.push(url);
    const socket = new FakeSocket();
    this.sockets.push(socket);
    const outcome = this.outcomes.shift() ?? "error";
    queueMicrotask(() => (outcome === "open" ? socket.open() : socket.fail()));
    return socket;
  }
}

describe("BridgeClient", () => {
  it("tries only compile-time loopback ports and stops at the first open socket", async () => {
    const sockets = new FakeSocketFactory(["error", "open"]);
    const client = new BridgeClient({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      ports: [38673, 38674],
      sockets,
      store: new MemoryCredentialStore(),
      openTimeoutMs: 50,
    });

    await expect(client.connect()).resolves.toBe("PAIRING_REQUIRED");
    expect(sockets.urls).toEqual([
      "ws://127.0.0.1:38673/v1/bridge",
      "ws://127.0.0.1:38674/v1/bridge",
    ]);
  });

  it("exchanges the pairing code in a message and stores the returned credential", async () => {
    const sockets = new FakeSocketFactory(["open"]);
    const store = new MemoryCredentialStore();
    const client = new BridgeClient({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      ports: [38673],
      sockets,
      store,
      openTimeoutMs: 50,
    });
    await client.connect();

    const pairing = client.pair("123456");
    const socket = sockets.sockets[0];
    expect(socket).toBeDefined();
    expect(JSON.parse(socket!.sent[0] ?? "{}")).toMatchObject({
      type: "pair.exchange",
      code: "123456",
    });
    expect(sockets.urls[0]).not.toContain("123456");
    socket!.message({
      protocol: 1,
      type: "pair.result",
      status: "OK",
      token: "A".repeat(43),
    });

    await pairing;
    expect(store.value).toBe("A".repeat(43));
  });

  it("sends credentials in hello messages rather than URLs", async () => {
    const sockets = new FakeSocketFactory(["open"]);
    const store = new MemoryCredentialStore();
    store.value = "B".repeat(43);
    const client = new BridgeClient({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      ports: [38673],
      sockets,
      store,
      openTimeoutMs: 50,
    });

    const connecting = client.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sockets.sockets[0]!;
    expect(sockets.urls[0]).not.toContain(store.value);
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({ type: "hello", token: store.value });
    socket.message({ protocol: 1, type: "hello.result", status: "OK" });
    await expect(connecting).resolves.toBe("OK");
  });

  it("keeps the authenticated WebSocket alive for the MV3 service worker", async () => {
    const sockets = new FakeSocketFactory(["open"]);
    const store = new MemoryCredentialStore();
    store.value = "H".repeat(43);
    const client = new BridgeClient({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      ports: [38673], sockets, store, openTimeoutMs: 50, heartbeatIntervalMs: 5,
    });

    const connecting = client.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sockets.sockets[0]!;
    socket.message({ protocol: 1, type: "hello.result", status: "OK" });
    await connecting;
    await new Promise((resolve) => setTimeout(resolve, 12));

    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toEqual({ protocol: 1, type: "keepalive" });
    client.disconnect();
    const sentAfterDisconnect = socket.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(socket.sent).toHaveLength(sentAfterDisconnect);
  });

  it("routes authenticated desktop requests and returns correlated results", async () => {
    const sockets = new FakeSocketFactory(["open"]);
    const store = new MemoryCredentialStore();
    store.value = "C".repeat(43);
    const received: BridgeRequest[] = [];
    const client = new BridgeClient({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      ports: [38673],
      sockets,
      store,
      openTimeoutMs: 50,
      handleRequest: async (request) => {
        received.push(request);
        return { status: "BROWSER_REQUIRED", message: "Open Schedule Builder." };
      },
    });

    const connecting = client.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sockets.sockets[0]!;
    socket.message({ protocol: 1, type: "hello.result", status: "OK" });
    await expect(connecting).resolves.toBe("OK");

    socket.message({
      protocol: 1,
      id: "req_live_01",
      type: "request",
      method: "schedule.search",
      params: { term: "2026-fall", courses: ["ECS 036A"] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toHaveLength(1);
    expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({
      protocol: 1,
      id: "req_live_01",
      type: "result",
      status: "BROWSER_REQUIRED",
    });
  });
});
