#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { OsascriptRunner, type JxaRunner } from "./runner.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const HELP = `${SERVER_NAME}-mcp ${SERVER_VERSION}
MCP server (stdio) that connects an MCP client to the macOS Mail app.

Usage:
  apple-mail-mcp                 Start the server (this is what MCP clients run)
  apple-mail-mcp --check         Verify Mail access end to end (read-only)
  apple-mail-mcp --print-config  Print a ready-to-paste MCP client config for this install
  apple-mail-mcp --help

Environment:
  APPLE_MAIL_MCP_MODE        read-only | draft (default) | full
                               read-only: list/read only
                               draft:     + mark, move, trash, create drafts/replies (never sends)
                               full:      + send_email and send replies
  APPLE_MAIL_MCP_TIMEOUT_MS  per-call timeout, default 60000
`;

/** Read-only walk through every read path, naming the step that fails. */
async function check(): Promise<number> {
  const config = loadConfig();
  const runner: JxaRunner = new OsascriptRunner(config);
  console.log(`apple-mail-mcp ${SERVER_VERSION} | mode: ${config.mode} | platform: ${process.platform}\n`);

  let step = "";
  const run = async <T>(name: string, fn: () => Promise<T>, describe: (r: T) => string): Promise<T> => {
    step = name;
    const result = await fn();
    console.log(`  ok  ${name}: ${describe(result)}`);
    return result;
  };

  try {
    await run(
      "accounts",
      () => runner.call<Array<{ name: string; emailAddresses: string[] }>>("listAccounts"),
      (a) => a.map((x) => `${x.name} <${x.emailAddresses.join(", ") || "no address"}>`).join("; ") || "none",
    );
    await run(
      "mailboxes",
      () => runner.call<Array<{ mailboxes: unknown[] }>>("listMailboxes", {}),
      (a) => `${a.reduce((n, x) => n + x.mailboxes.length, 0)} across ${a.length} account(s)`,
    );
    const inbox = await run(
      "combined inbox",
      () =>
        runner.call<{ total: number; messages: Array<{ id: number; account: string; mailbox: string[]; subject: string }> }>(
          "listMessages",
          { limit: 1, offset: 0 },
        ),
      (r) => `${r.total} messages` + (r.messages[0] ? `, newest in ${r.messages[0].account}/${r.messages[0].mailbox.join("/")}` : ""),
    );
    await run(
      "filtered search (unread, last 30 days)",
      () =>
        runner.call<{ total: number }>("listMessages", {
          unreadOnly: true,
          since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          limit: 1,
          offset: 0,
        }),
      (r) => `${r.total} matches`,
    );
    const newest = inbox.messages[0];
    if (newest) {
      await run(
        "read newest message",
        () =>
          runner.call<{ bodyLength: number; subject: string }>("getMessage", {
            ref: { account: newest.account, mailbox: newest.mailbox, id: newest.id },
            maxChars: 500,
          }),
        (m) => `"${m.subject}" (${m.bodyLength} chars)`,
      );
    } else {
      console.log("  --  read newest message: skipped (inbox is empty)");
    }
    console.log("\nOK: Mail is reachable and every read path works.");
    return 0;
  } catch (e) {
    console.error(`\nFAILED at step "${step}": ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

function printConfig(): void {
  const config = {
    mcpServers: {
      "apple-mail": {
        command: process.execPath,
        args: [fileURLToPath(import.meta.url)],
        env: { APPLE_MAIL_MCP_MODE: "draft" },
      },
    },
  };
  console.log(JSON.stringify(config, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (args.includes("--version")) {
    console.log(SERVER_VERSION);
    return;
  }
  if (args.includes("--print-config")) {
    printConfig();
    return;
  }
  if (args.includes("--check")) {
    process.exitCode = await check();
    return;
  }

  const config = loadConfig();
  const server = createServer(config, new OsascriptRunner(config));
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; diagnostics go to stderr only.
  console.error(`${SERVER_NAME} MCP server running on stdio (mode: ${config.mode})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
