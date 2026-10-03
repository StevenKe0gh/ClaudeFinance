/**
 * Runtime configuration, read from environment variables.
 *
 *   APPLE_MAIL_MCP_MODE        read-only | draft (default) | full
 *   APPLE_MAIL_MCP_TIMEOUT_MS  per-call osascript timeout (default 60000)
 *   APPLE_MAIL_MCP_OSASCRIPT   osascript binary to run (default "osascript"; tests override it)
 */

export const MODES = ["read-only", "draft", "full"] as const;
export type Mode = (typeof MODES)[number];

export interface Config {
  mode: Mode;
  timeoutMs: number;
  osascript: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawMode = (env.APPLE_MAIL_MCP_MODE ?? "draft").trim().toLowerCase();
  if (!(MODES as readonly string[]).includes(rawMode)) {
    throw new Error(
      `APPLE_MAIL_MCP_MODE must be one of ${MODES.join(", ")} (got "${env.APPLE_MAIL_MCP_MODE}")`,
    );
  }

  const rawTimeout = env.APPLE_MAIL_MCP_TIMEOUT_MS;
  const timeoutMs = rawTimeout === undefined || rawTimeout === "" ? 60_000 : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
    throw new Error(`APPLE_MAIL_MCP_TIMEOUT_MS must be an integer >= 1000 (got "${rawTimeout}")`);
  }

  return {
    mode: rawMode as Mode,
    timeoutMs,
    osascript: env.APPLE_MAIL_MCP_OSASCRIPT || "osascript",
  };
}

/** True when the configured mode permits changing mailbox state (flags, moves, drafts). */
export function canModify(mode: Mode): boolean {
  return mode !== "read-only";
}

/** True only when the mode permits actually sending mail. */
export function canSend(mode: Mode): boolean {
  return mode === "full";
}
