import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config, Mode } from "../config.js";
import { MailError, explainFailure, parseResponse, type JxaRunner } from "../runner.js";
import { createServer } from "../server.js";
import { createFakeMail, loadDriver, type FakeMail } from "./fakeMail.js";

/** Runs the real mail.js against the fake, with the same JSON in / JSON out contract as osascript. */
export function inProcessRunner(fake: FakeMail): JxaRunner {
  const run = loadDriver(fake);
  return {
    async call<T>(op: string, params: unknown = {}): Promise<T> {
      const response = parseResponse(run(JSON.stringify({ op, params })));
      if (!response.ok) throw new MailError(explainFailure(response.error ?? "Unknown Mail error"));
      return response.result as T;
    },
  };
}

export function testConfig(mode: Mode): Config {
  return { mode, timeoutMs: 5000, osascript: "osascript" };
}

export interface Harness {
  fake: FakeMail;
  client: Client;
  /** Call a tool and return {isError, text, json} (json is undefined when text isn't JSON). */
  call(name: string, args?: Record<string, unknown>): Promise<{ isError: boolean; text: string; json: any }>;
  close(): Promise<void>;
}

export async function startHarness(mode: Mode): Promise<Harness> {
  const fake = createFakeMail();
  const server = createServer(testConfig(mode), inProcessRunner(fake));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    fake,
    client,
    async call(name, args = {}) {
      const res = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
      const text = res.content.map((c) => c.text).join("\n");
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { isError: res.isError === true, text, json };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
