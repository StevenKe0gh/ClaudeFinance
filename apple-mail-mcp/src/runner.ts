import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Config } from "./config.js";

/** Calls an operation in the Mail JXA driver. Abstracted so tests can run it in-process. */
export interface JxaRunner {
  call<T = unknown>(op: string, params?: unknown): Promise<T>;
}

export class MailError extends Error {}

interface DriverResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const SCRIPT_URL = new URL("./jxa/mail.js", import.meta.url);
let scriptCache: Promise<string> | undefined;

function loadScript(): Promise<string> {
  scriptCache ??= readFile(SCRIPT_URL, "utf8");
  return scriptCache;
}

/** Turn the raw failure text from osascript/Mail into something actionable. */
export function explainFailure(text: string): string {
  if (/-1743|not authori[sz]ed to send apple events/i.test(text)) {
    return (
      "macOS has not allowed this app to control Mail. Open System Settings > Privacy & Security > " +
      "Automation, enable Mail for the app that launched this server (Claude, Terminal, ...), then retry. " +
      "If it was denied earlier, run `tccutil reset AppleEvents` and retry to get the prompt again."
    );
  }
  if (/-1712|timed out/i.test(text)) {
    return (
      "Mail did not answer in time. The mailbox may be large or Mail may still be syncing; " +
      "narrow the request (since/since_days, unread_only, a smaller limit) and retry. " +
      `Details: ${text.trim()}`
    );
  }
  if (/-600|isn.t running/i.test(text)) {
    return `Mail is not running or quit during the request. Open Mail and retry. Details: ${text.trim()}`;
  }
  return text.trim();
}

export class OsascriptRunner implements JxaRunner {
  constructor(private readonly config: Config) {}

  async call<T = unknown>(op: string, params: unknown = {}): Promise<T> {
    if (process.platform !== "darwin" && this.config.osascript === "osascript") {
      throw new MailError("Apple Mail is only available on macOS; run this server on your Mac.");
    }
    const script = await loadScript();
    const request = JSON.stringify({ op, params });

    const { stdout, stderr, error } = await new Promise<{ stdout: string; stderr: string; error: Error | null }>(
      (resolve) => {
        execFile(
          this.config.osascript,
          ["-l", "JavaScript", "-e", script, request],
          { timeout: this.config.timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
          (err, out, errOut) => resolve({ stdout: out, stderr: errOut, error: err }),
        );
      },
    );

    if (error) {
      const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed;
      if (killed) {
        throw new MailError(explainFailure(`No answer within ${this.config.timeoutMs} ms (-1712).`));
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MailError(`Could not run "${this.config.osascript}". Is this a Mac?`);
      }
      throw new MailError(explainFailure(stderr || error.message));
    }

    const response = parseResponse(stdout);
    if (!response.ok) throw new MailError(explainFailure(response.error ?? "Unknown Mail error"));
    return response.result as T;
  }
}

/** osascript prints the JSON string `run` returned; tolerate it arriving quoted. */
export function parseResponse(stdout: string): DriverResponse {
  const text = stdout.trim();
  try {
    let value: unknown = JSON.parse(text);
    if (typeof value === "string") value = JSON.parse(value);
    if (value && typeof value === "object" && "ok" in value) return value as DriverResponse;
  } catch {
    // fall through
  }
  throw new MailError(`Unexpected output from osascript: ${text.slice(0, 300) || "(empty)"}`);
}
