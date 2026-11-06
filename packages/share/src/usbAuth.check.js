// Self-check for usbPassOk: node usbAuth.check.js
import assert from "node:assert/strict";
import { usbPassOk } from "./usbAuth.js";

const PASS = "right1";
const basic = (s) => `Basic ${Buffer.from(s).toString("base64")}`;
const ok = (headers) => usbPassOk({ headers }, PASS);

// On the LAN no password is needed.
assert.equal(ok({ "x-real-ip": "192.168.1.20" }), true);
assert.equal(ok({ "x-real-ip": "127.0.0.1" }), true);

// Off the LAN it is.
const OUT = "216.163.184.10";
assert.equal(ok({ "x-real-ip": OUT }), false);
assert.equal(ok({ "x-real-ip": OUT, authorization: basic("u:wrong") }), false);
assert.equal(ok({ "x-real-ip": OUT, authorization: basic("u:") }), false);
assert.equal(ok({ "x-real-ip": OUT, authorization: "Bearer right1" }), false);
assert.equal(ok({ "x-real-ip": OUT, authorization: "Basic" }), false);
assert.equal(ok({ "x-real-ip": OUT, authorization: basic("u:right1") }), true);
assert.equal(ok({ "x-real-ip": OUT, authorization: basic(":right1") }), true);

// A prefix that only looks like the LAN, and a request that skipped nginx.
assert.equal(ok({ "x-real-ip": "192.168.10.5" }), false);
assert.equal(ok({}), false);

console.log("usbAuth ok");
