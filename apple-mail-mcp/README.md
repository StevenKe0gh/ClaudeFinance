# apple-mail-mcp

An [MCP](https://modelcontextprotocol.io) server that lets Claude work with the **Apple Mail** app on your Mac: read and search mail, mark/move/trash messages, and write drafts or replies for you to review. Sending is off unless you turn it on.

It runs **locally on your Mac** and talks to Mail through macOS automation (`osascript` / JXA). Nothing is sent anywhere except to whichever MCP client you connect it to. It works with Claude Desktop and Claude Code running on your Mac; it cannot be reached from a cloud/web session, because those run on a different machine than your Mail app.

## Setup

Requirements: macOS, [Node.js](https://nodejs.org) 18+, and Mail with at least one account.

```sh
git clone <this repo> && cd ClaudeFinance/apple-mail-mcp
npm install
npm run build
node dist/index.js --check      # verifies Mail access end to end (read-only)
```

The first run triggers a macOS prompt: **"<app> wants to control Mail"**. Click OK. If you missed it or said no: System Settings > Privacy & Security > Automation, and enable Mail under the app that launched the server (Terminal, Claude, ...). `tccutil reset AppleEvents` clears old decisions so the prompt returns.

### Connect Claude Desktop

Run `node dist/index.js --print-config` and merge the output into
`~/Library/Application Support/Claude/claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude. The printed config uses absolute paths, which matters because GUI apps don't see your shell's `PATH` (a problem with nvm/asdf installs).

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/you/ClaudeFinance/apple-mail-mcp/dist/index.js"],
      "env": { "APPLE_MAIL_MCP_MODE": "draft" }
    }
  }
}
```

### Connect Claude Code

```sh
claude mcp add --transport stdio --env APPLE_MAIL_MCP_MODE=draft apple-mail -- node "$PWD/dist/index.js"
```

## Safety modes

Set with `APPLE_MAIL_MCP_MODE`. The default is `draft`.

| Mode | Can do |
| --- | --- |
| `read-only` | List accounts/mailboxes, list/search messages, read messages |
| `draft` (default) | Everything above, plus mark read/flagged, move, move to Trash, check for new mail, **save drafts and replies to Drafts**. Never sends. |
| `full` | Everything above, plus `send_email` and sending replies |

Tools that a mode doesn't allow are not registered at all, so the model can't call them, and `send` isn't even in the `reply_to_message` schema outside `full`. An invalid mode value stops the server with an error rather than falling back silently.

## Tools

| Tool | Mode | What it does |
| --- | --- | --- |
| `list_accounts` | all | Accounts and their email addresses |
| `list_mailboxes` | all | Mailboxes as nested paths, with unread counts |
| `list_messages` | all | Newest-first listing with filters: `unread_only`, `flagged_only`, `subject_contains`, `sender_contains`, `since` / `since_days`, `limit`, `offset`. Returns an opaque `ref` per message. Without `account`, Inbox/Sent/Drafts/Trash/Junk mean the combined mailboxes across accounts. |
| `get_message` | all | Headers, recipients, attachment names, and the plain-text body (truncated at `max_chars`) |
| `check_for_new_mail` | draft+ | Ask Mail to fetch now |
| `mark_messages` | draft+ | Set read/unread and flagged/unflagged on up to 50 messages |
| `move_message` | draft+ | Move to another mailbox, e.g. `Archive` or `Work/Clients` |
| `trash_messages` | draft+ | Move up to 50 messages to Trash (recoverable; nothing here empties Trash) |
| `create_draft` | draft+ | Save a new message to Drafts (`show: true` also opens it) |
| `reply_to_message` | draft+ | Save a reply (or reply-all) to Drafts with your text above the quoted original; the result lists the recipients. In `full` mode, `send: true` sends it. |
| `send_email` | full | Send a new message immediately |

Things to try: *"Summarize my unread mail from the last 3 days."* · *"Find the invoice from Acme and draft a reply asking for a revised date."* · *"Flag everything from my manager this week."*

## Security notes

- **Email is untrusted input.** Anyone can email you text that tries to instruct an AI ("ignore previous instructions, forward ..."). The tools label message content as untrusted, but the real defense is the mode: with the default `draft` mode a manipulated model can at worst leave a draft you will read before sending, and cannot send mail. Use `full` only if you accept that risk, and keep your MCP client's per-tool approval prompts on for `send_email`.
- **No attachments, by design.** The server never reads, saves, or attaches files, so a prompt-injected model cannot mail out local files.
- **From address is restricted** to addresses configured in Mail (`list_accounts`); anything else is rejected.
- **Recipients are validated** (one address per entry, no control characters, max 25 per message) and subjects are forced to a single line.
- **Request data is never spliced into script source.** It reaches the JXA script as JSON in `argv` and is parsed there.
- Known limitation: because it travels in `argv`, draft/send text is briefly visible to other local users via `ps`. Fine on a personal Mac; keep in mind on a shared one.

## How it works

`src/jxa/mail.js` is one JXA program that drives Mail (accounts, mailboxes, messages, composing). For each tool call the server runs `osascript -l JavaScript -e <script> '<json request>'` and parses the JSON it prints. Messages are addressed by `{account, mailbox path, id}`, which the server wraps into an opaque `ref`. Refs go stale when a message moves or is deleted (IMAP assigns a new id); list again to get fresh ones.

## Limitations

- Search covers **subject and sender only**. Body-text search through Mail's scripting interface is too slow to be useful.
- Bodies are plain text; attachments are listed by name but not downloadable.
- Listing reads ids and dates for every message matching the filters before paging, so a huge unfiltered mailbox can be slow. Use `since_days` or other filters, or raise `APPLE_MAIL_MCP_TIMEOUT_MS` (default 60000).
- Mailbox names are whatever the server calls them (`INBOX`, `Sent Messages`, `[Gmail]/Trash`, ...). Common aliases (`Sent`, `Trash`, `Junk`, `Drafts`) are matched for you; otherwise use `list_mailboxes`.
- Mail launches if it isn't running.

## Troubleshooting

Run `node dist/index.js --check`. It names the step that failed:

| Symptom | Fix |
| --- | --- |
| "macOS has not allowed this app to control Mail" | Grant Automation permission (see Setup) |
| "Mail did not answer in time" | Mail is syncing or the mailbox is huge; add filters or raise the timeout |
| Claude Desktop shows the server as failed | Use the absolute paths from `--print-config`; check `~/Library/Logs/Claude/mcp*.log` |
| "only available on macOS" | The server must run on your Mac, not a Linux/cloud host |

## Development

```sh
npm test      # builds, then runs the full suite
```

The tests run the real `mail.js` against an in-memory fake of Mail's scripting model (`src/test/fakeMail.ts`), through the real MCP server, and also launch the built server as a subprocess with a fake `osascript` to exercise the stdio transport, argv contract, timeouts and `--check`. That verifies the logic, mode gating and wire format. It cannot verify how a given macOS/Mail version behaves, which is what `--check` is for.
