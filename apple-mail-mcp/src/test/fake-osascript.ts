#!/usr/bin/env node
/**
 * Stand-in for /usr/bin/osascript used by the stdio tests. It enforces the exact argv
 * contract the server relies on (`-l JavaScript -e <script> <request-json>`), then runs the
 * script it was given against the in-memory fake Mail, printing the result like osascript does.
 *
 * FAKE_OSASCRIPT_FAIL=<text>  print <text> to stderr and exit 1
 * FAKE_OSASCRIPT_HANG=1       never answer (to exercise the timeout)
 */
import { createFakeMail, loadDriver } from "./fakeMail.js";

const args = process.argv.slice(2);

if (process.env.FAKE_OSASCRIPT_HANG) {
  setTimeout(() => {}, 60_000);
} else if (process.env.FAKE_OSASCRIPT_FAIL) {
  console.error(process.env.FAKE_OSASCRIPT_FAIL);
  process.exit(1);
} else {
  if (args.length !== 5 || args[0] !== "-l" || args[1] !== "JavaScript" || args[2] !== "-e") {
    console.error(`fake osascript: unexpected argv shape: ${JSON.stringify(args.slice(0, 3))} (${args.length} args)`);
    process.exit(2);
  }
  const [, , , script, request] = args;
  const run = loadDriver(createFakeMail(), script);
  process.stdout.write(run(request) + "\n");
}
