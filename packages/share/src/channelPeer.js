import WebSocket from "ws";

const DEFAULT_RECONNECT_MS = 5000;

export class ChannelPeer {
  constructor({
    url = "ws://127.0.0.1:8736",
    channels,
    reconnectMs = DEFAULT_RECONNECT_MS,
    log = null,
  }) {
    if (!channels || typeof channels !== "object") {
      throw new Error("ChannelPeer requires channels");
    }
    this.url = url;
    this.channels = new Map(Object.entries(channels));
    this.reconnectMs = reconnectMs;
    this.log = log;
    this.active = new Set();
    this.ws = null;
    this.reconnectTimer = null;
    this.closed = false;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  publishDelta(name, data) {
    if (!this.active.has(name)) return;
    this.send({ ch: name, op: "delta", data });
  }

  publishSnapshot(name, data) {
    if (!this.active.has(name)) return;
    this.send({ ch: name, op: "snapshot", data });
  }

  connect() {
    if (this.closed) return;
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    )
      return;

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.send({ op: "register", channels: [...this.channels.keys()] });
    });

    ws.on("message", (data) => {
      this.handleMessage(data).catch((e) => {
        this.log?.(`channel peer message failed: ${e.message}`);
      });
    });

    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.active.clear();
      this.scheduleReconnect();
    });

    ws.on("error", (e) => {
      this.log?.(`channel peer socket error: ${e.message}`);
    });
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
  }

  async handleMessage(data) {
    const frame = JSON.parse(data.toString());
    const source = this.channels.get(frame.ch);
    if (!source) return;

    if (frame.op === "sub") {
      const wasActive = this.active.has(frame.ch);
      this.active.add(frame.ch);
      if (!wasActive) await source.onFirstSubscriber?.();
      await this.sendSnapshot(frame.ch, source);
      return;
    }

    if (frame.op === "snapshot-request") {
      await this.sendSnapshot(frame.ch, source, frame.requestId);
      return;
    }

    if (frame.op === "unsub") {
      if (!this.active.delete(frame.ch)) return;
      await source.onLastUnsubscriber?.();
    }
  }

  async sendSnapshot(name, source, requestId = undefined) {
    const data = await source.snapshot();
    const frame = { ch: name, op: "snapshot", data };
    if (requestId !== undefined) frame.requestId = requestId;
    this.send(frame);
  }

  send(frame) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }
}
