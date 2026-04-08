// Broadlink RM Mini 3 protocol — direct translation of python-broadlink device.py + remote.py
import dgram from "dgram";
import crypto from "crypto";

const INIT_KEY = Buffer.from("097628343fe99e23765c1513accf8b02", "hex");
const INIT_IV = Buffer.from("562e17996d093d28ddb3ba695a2e6f58", "hex");

function aesCBC(key, iv, data, encrypt) {
  const padded = Buffer.concat([
    data,
    Buffer.alloc((16 - (data.length % 16)) % 16),
  ]);
  const cipher = encrypt
    ? crypto.createCipheriv("aes-128-cbc", key, iv)
    : crypto.createDecipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function checksum(buf) {
  let s = 0xbeaf;
  for (const b of buf) s = (s + b) & 0xffff;
  return s;
}

export class Broadlink {
  constructor(host, mac, devtype = 0x5f36) {
    // host: "192.168.1.x", mac: Buffer (in normal order E8:16:56:70:4C:AE)
    this.host = host;
    this.port = 80;
    this.mac = Buffer.isBuffer(mac) ? mac : Buffer.from(mac);
    this.devtype = devtype;
    this.count = Math.floor(Math.random() * (0xffff - 0x8000)) + 0x8000;
    this.iv = Buffer.from(INIT_IV);
    this.key = Buffer.from(INIT_KEY);
    this.id = 0;
  }

  _encrypt(payload) {
    return aesCBC(this.key, this.iv, payload, true);
  }
  _decrypt(payload) {
    return aesCBC(this.key, this.iv, payload, false);
  }

  _sendPacket(packetType, payload) {
    // Direct translation of Device.send_packet()
    this.count = ((this.count + 1) | 0x8000) & 0xffff;
    const pkt = Buffer.alloc(0x38);
    Buffer.from("5aa5aa555aa5aa55", "hex").copy(pkt, 0x00);
    pkt.writeUInt16LE(this.devtype, 0x24);
    pkt.writeUInt16LE(packetType, 0x26);
    pkt.writeUInt16LE(this.count, 0x28);
    // MAC reversed in packet (python: self.mac[::-1])
    Buffer.from(this.mac).reverse().copy(pkt, 0x2a);
    pkt.writeUInt32LE(this.id, 0x30);

    const p_cs = checksum(payload);
    pkt.writeUInt16LE(p_cs, 0x34);

    const padding = (16 - (payload.length % 16)) % 16;
    const encPayload = this._encrypt(
      Buffer.concat([payload, Buffer.alloc(padding)]),
    );
    const full = Buffer.concat([pkt, encPayload]);
    full.writeUInt16LE(checksum(full), 0x20);

    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket("udp4");
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        sock.close();
        reject(new Error("broadlink timeout"));
      }, 10000);
      sock.bind(() => {
        sock.once("message", (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          sock.close();
          resolve(resp);
        });
        sock.send(full, 0, full.length, this.port, this.host, (err) => {
          if (err && !done) {
            done = true;
            clearTimeout(timer);
            sock.close();
            reject(err);
          }
        });
      });
    });
  }

  async auth() {
    // Direct translation of Device.auth()
    this.id = 0;
    this.key = Buffer.from(INIT_KEY);
    const payload = Buffer.alloc(0x50);
    // packet[0x04:0x14] = [0x31] * 16
    payload.fill(0x31, 0x04, 0x14);
    payload[0x1e] = 0x01;
    payload[0x2d] = 0x01;
    Buffer.from("Test 1").copy(payload, 0x30);
    const resp = await this._sendPacket(0x65, payload);
    const decrypted = this._decrypt(resp.slice(0x38));
    this.id = decrypted.readUInt32LE(0x00);
    this.key = Buffer.from(decrypted.slice(0x04, 0x14));
  }

  sendData(irData) {
    // rmmini.send_data(data): self._send(0x2, data)
    // rmmini._send(command, data): packet = struct.pack("<I", command) + data  then send_packet(0x6A, packet)
    const data = Buffer.isBuffer(irData) ? irData : Buffer.from(irData);
    const payload = Buffer.concat([Buffer.alloc(4), data]);
    payload.writeUInt32LE(0x2, 0);
    // Fire and forget — don't block on device response
    const sock = dgram.createSocket("udp4");
    this.count = ((this.count + 1) | 0x8000) & 0xffff;
    const pkt = Buffer.alloc(0x38);
    Buffer.from("5aa5aa555aa5aa55", "hex").copy(pkt, 0x00);
    pkt.writeUInt16LE(this.devtype, 0x24);
    pkt.writeUInt16LE(0x6a, 0x26);
    pkt.writeUInt16LE(this.count, 0x28);
    Buffer.from(this.mac).reverse().copy(pkt, 0x2a);
    pkt.writeUInt32LE(this.id, 0x30);
    const p_cs = checksum(payload);
    pkt.writeUInt16LE(p_cs, 0x34);
    const padding = (16 - (payload.length % 16)) % 16;
    const encPayload = this._encrypt(
      Buffer.concat([payload, Buffer.alloc(padding)]),
    );
    const full = Buffer.concat([pkt, encPayload]);
    full.writeUInt16LE(checksum(full), 0x20);
    sock.bind(() => {
      sock.send(full, 0, full.length, this.port, this.host, () => {
        setTimeout(() => {
          try {
            sock.close();
          } catch (_) {}
        }, 2000);
      });
    });
  }
}
