import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INDEX = fileURLToPath(new URL("../index.js", import.meta.url));
const FAKE = fileURLToPath(new URL("./fake-osascript.js", import.meta.url));

before(() => chmodSync(FAKE, 0o755));

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("APPLE_MAIL_MCP_")) env[k] = v;
  return { ...env, APPLE_MAIL_MCP_OSASCRIPT: FAKE, ...extra };
}

async function withClient<T>(extra: Record<string, string>, fn: (c: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [INDEX], env: cleanEnv(extra) });
  const client = new Client({ name: "stdio-test", version: "0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const text = (res: any): string => res.content.map((c: any) => c.text).join("\n");

function cli(args: string[], extra: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [INDEX, ...args], { env: cleanEnv(extra) }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as any).code as number) : 0, stdout, stderr }),
    );
  });
}

describe("real server process over stdio", () => {
  test("initializes, lists tools, and round-trips list_messages -> get_message through osascript", async () => {
    await withClient({}, async (client) => {
      const { tools } = await client.listTools();
      assert.ok(tools.some((t) => t.name === "list_messages"));
      assert.ok(!tools.some((t) => t.name === "send_email"), "default mode must not expose send_email");

      const list = JSON.parse(text(await client.callTool({ name: "list_messages", arguments: { limit: 3 } })));
      assert.equal(list.total, 5);
      assert.equal(list.messages[0].subject, "Quarterly invoice");

      const got = JSON.parse(
        text(await client.callTool({ name: "get_message", arguments: { ref: list.messages[0].ref } })),
      );
      assert.equal(got.subject, "Quarterly invoice");
      assert.equal(got.account, "Gmail");
    });
  });

  test("read-only mode via env hides write tools", async () => {
    await withClient({ APPLE_MAIL_MCP_MODE: "read-only" }, async (client) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 4);
    });
  });

  test("macOS permission failure becomes an actionable tool error", async () => {
    await withClient(
      { FAKE_OSASCRIPT_FAIL: "execution error: Not authorized to send Apple events to Mail. (-1743)" },
      async (client) => {
        const res: any = await client.callTool({ name: "list_accounts", arguments: {} });
        assert.equal(res.isError, true);
        assert.match(text(res), /System Settings > Privacy & Security > Automation/);
      },
    );
  });

  test("a hung osascript is killed at the timeout with a clear error", async () => {
    await withClient({ FAKE_OSASCRIPT_HANG: "1", APPLE_MAIL_MCP_TIMEOUT_MS: "1000" }, async (client) => {
      const started = Date.now();
      const res: any = await client.callTool({ name: "list_accounts", arguments: {} });
      assert.equal(res.isError, true);
      assert.match(text(res), /timed out|did not answer in time/);
      assert.ok(Date.now() - started < 10_000);
    });
  });

  test("an invalid mode makes startup fail loudly", async () => {
    const res = await cli([], { APPLE_MAIL_MCP_MODE: "yolo" });
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /APPLE_MAIL_MCP_MODE must be one of/);
  });
});

describe("CLI", () => {
  test("--check walks every read path and reports each step", async () => {
    const res = await cli(["--check"]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /ok {2}accounts: iCloud <ada@icloud.com>; Gmail <ada@gmail.com, ada.l@gmail.com>/);
    assert.match(res.stdout, /ok {2}mailboxes: .* across 2 account\(s\)/);
    assert.match(res.stdout, /ok {2}combined inbox: 5 messages, newest in Gmail\/INBOX/);
    assert.match(res.stdout, /ok {2}filtered search \(unread, last 30 days\): \d+ matches/);
    assert.match(res.stdout, /ok {2}read newest message: "Quarterly invoice"/);
    assert.match(res.stdout, /OK: Mail is reachable/);
  });

  test("--check exits non-zero with the reason on failure", async () => {
    const res = await cli(["--check"], { FAKE_OSASCRIPT_FAIL: "Not authorized to send Apple events (-1743)" });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /FAILED at step "accounts": .*Automation/);
  });

  test("--print-config emits valid client config with absolute paths", async () => {
    const res = await cli(["--print-config"]);
    assert.equal(res.code, 0);
    const cfg = JSON.parse(res.stdout).mcpServers["apple-mail"];
    assert.equal(cfg.command, process.execPath);
    assert.equal(cfg.args[0], INDEX);
    assert.equal(cfg.env.APPLE_MAIL_MCP_MODE, "draft");
  });

  test("--help documents the modes and writes nothing to stderr", async () => {
    const res = await cli(["--help"]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /APPLE_MAIL_MCP_MODE/);
    assert.equal(res.stderr, "");
  });
});
