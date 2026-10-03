import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadConfig } from "../config.js";
import { cleanSubject, parseRecipient } from "../recipients.js";
import { decodeRef, encodeRef } from "../refs.js";
import { explainFailure, parseResponse } from "../runner.js";

describe("refs", () => {
  test("round-trip, including awkward names", () => {
    const loc = { account: "Work: Ünïcode/Acct", mailbox: ["Parent", "Child / odd"], id: 123456 };
    assert.deepEqual(decodeRef(encodeRef(loc)), loc);
  });

  test("garbage refs are rejected with guidance", () => {
    for (const bad of ["", "msg_", "msg_!!!", "hello", "msg_" + Buffer.from('["a",[],1]').toString("base64url")]) {
      assert.throws(() => decodeRef(bad), /Invalid message ref/);
    }
  });
});

describe("recipients", () => {
  test("accepts bare and named addresses", () => {
    assert.deepEqual(parseRecipient(" a@b.com "), { name: null, address: "a@b.com" });
    assert.deepEqual(parseRecipient('Grace Hopper <grace@navy.test>'), { name: "Grace Hopper", address: "grace@navy.test" });
    assert.deepEqual(parseRecipient('"Hopper, Grace" <grace@navy.test>'), { name: "Hopper, Grace", address: "grace@navy.test" });
    assert.deepEqual(parseRecipient("<a@b.com>"), { name: null, address: "a@b.com" });
  });

  test("rejects lists, junk and header injection", () => {
    for (const bad of [
      "a@b.com, c@d.com",
      "a@b.com; c@d.com",
      "not-an-address",
      "a@b",
      "a@b.com\r\nBcc: evil@x.test",
      "Name <a@b.com> trailing",
      "",
    ]) {
      assert.throws(() => parseRecipient(bad), /Invalid recipient/, bad);
    }
  });

  test("subjects lose line breaks", () => {
    assert.equal(cleanSubject("Hi\r\nBcc: x@y.z"), "Hi Bcc: x@y.z");
  });
});

describe("config", () => {
  test("defaults to draft mode", () => {
    assert.deepEqual(loadConfig({}), { mode: "draft", timeoutMs: 60000, osascript: "osascript" });
  });

  test("accepts each mode, case-insensitively", () => {
    for (const mode of ["read-only", "draft", "full"]) {
      assert.equal(loadConfig({ APPLE_MAIL_MCP_MODE: mode.toUpperCase() }).mode, mode);
    }
  });

  test("rejects unknown modes and bad timeouts instead of guessing", () => {
    assert.throws(() => loadConfig({ APPLE_MAIL_MCP_MODE: "yolo" }), /must be one of read-only, draft, full/);
    assert.throws(() => loadConfig({ APPLE_MAIL_MCP_TIMEOUT_MS: "5" }), /TIMEOUT_MS/);
    assert.throws(() => loadConfig({ APPLE_MAIL_MCP_TIMEOUT_MS: "abc" }), /TIMEOUT_MS/);
  });
});

describe("runner helpers", () => {
  test("parseResponse tolerates plain and double-encoded JSON", () => {
    const body = { ok: true, result: { a: 1 } };
    assert.deepEqual(parseResponse(JSON.stringify(body) + "\n"), body);
    assert.deepEqual(parseResponse(JSON.stringify(JSON.stringify(body))), body);
  });

  test("parseResponse rejects anything else", () => {
    assert.throws(() => parseResponse(""), /Unexpected output/);
    assert.throws(() => parseResponse("Mail got an error"), /Unexpected output/);
    assert.throws(() => parseResponse("[1,2]"), /Unexpected output/);
  });

  test("known osascript failures are translated", () => {
    assert.match(explainFailure("execution error: Not authorized to send Apple events to Mail. (-1743)"), /Automation/);
    assert.match(explainFailure("execution error: AppleEvent timed out. (-1712)"), /narrow the request/);
    assert.match(explainFailure("Application isn't running. (-600)"), /Open Mail/);
    assert.equal(explainFailure("  something else  "), "something else");
  });
});
