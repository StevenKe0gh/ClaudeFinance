import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { startHarness, type Harness } from "./helpers.js";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const names = async (hh: Harness) => (await hh.client.listTools()).tools.map((t) => t.name).sort();

const READ = ["get_message", "list_accounts", "list_mailboxes", "list_messages"];
const ORGANIZE = ["check_for_new_mail", "create_draft", "mark_messages", "move_message", "reply_to_message", "trash_messages"];

describe("mode gating", () => {
  test("read-only exposes only read tools", async () => {
    h = await startHarness("read-only");
    assert.deepEqual(await names(h), READ);
  });

  test("draft (default) adds organizing and drafting but never sending", async () => {
    h = await startHarness("draft");
    assert.deepEqual(await names(h), [...READ, ...ORGANIZE].sort());
    const reply = (await h.client.listTools()).tools.find((t) => t.name === "reply_to_message")!;
    assert.ok(!("send" in (reply.inputSchema.properties ?? {})), "draft mode must not advertise send");
  });

  test("full adds send_email and reply send", async () => {
    h = await startHarness("full");
    assert.deepEqual(await names(h), [...READ, ...ORGANIZE, "send_email"].sort());
    const reply = (await h.client.listTools()).tools.find((t) => t.name === "reply_to_message")!;
    assert.ok("send" in (reply.inputSchema.properties ?? {}));
  });

  test("draft mode cannot be talked into sending a reply", async () => {
    h = await startHarness("draft");
    const list = await h.call("list_messages", { account: "iCloud" });
    const ref = list.json.messages.find((m: any) => m.subject === "Lunch?").ref;
    const res = await h.call("reply_to_message", { ref, body: "Sure", send: true });
    assert.equal(res.isError, false);
    assert.equal(res.json.saved, true);
    assert.equal(res.json.sent, undefined);
    assert.equal(h.fake.outgoing[0].state, "saved");
  });

  test("send_email does not exist in draft mode", async () => {
    h = await startHarness("draft");
    const res = await h.call("send_email", { to: ["a@b.com"], subject: "x", body: "y" });
    assert.equal(res.isError, true);
    assert.equal(h.fake.outgoing.length, 0);
  });

  test("annotations: reads are read-only, trash is destructive, send is open-world", async () => {
    h = await startHarness("full");
    const tools = new Map((await h.client.listTools()).tools.map((t) => [t.name, t.annotations ?? {}]));
    assert.equal(tools.get("list_messages")!.readOnlyHint, true);
    assert.equal(tools.get("trash_messages")!.destructiveHint, true);
    assert.equal(tools.get("send_email")!.openWorldHint, true);
    assert.equal(tools.get("create_draft")!.openWorldHint, false);
  });
});

describe("reading", () => {
  test("list_messages -> get_message via opaque refs, with untrusted-content note", async () => {
    h = await startHarness("read-only");
    const list = await h.call("list_messages", { unread_only: true, limit: 2 });
    assert.equal(list.isError, false);
    assert.equal(list.json.total, 3);
    assert.equal(list.json.messages.length, 2);
    assert.match(list.json.note, /untrusted/);
    const first = list.json.messages[0];
    assert.match(first.ref, /^msg_/);

    const got = await h.call("get_message", { ref: first.ref });
    assert.equal(got.isError, false);
    assert.equal(got.json.subject, first.subject);
    assert.match(got.json.note, /untrusted/);
    assert.equal(got.json.ref, first.ref);
  });

  test("since_days and since combine, taking the stricter cutoff", async () => {
    h = await startHarness("read-only");
    const veryRecent = await h.call("list_messages", { since_days: 1 });
    assert.equal(veryRecent.json.total, 0); // fixture data is older than a day
    const strict = await h.call("list_messages", { since: "2999-01-01", since_days: 3650 });
    assert.equal(strict.json.total, 0);
    const bad = await h.call("list_messages", { since: "not a date" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Could not parse since/);
  });

  test("bad refs and out-of-range arguments are errors, not crashes", async () => {
    h = await startHarness("read-only");
    assert.equal((await h.call("get_message", { ref: "msg_bogus" })).isError, true);
    assert.equal((await h.call("list_messages", { limit: 1000 })).isError, true);
  });
});

describe("organizing and composing over MCP", () => {
  test("mark_messages needs read or flagged", async () => {
    h = await startHarness("draft");
    const ref = (await h.call("list_messages", { limit: 1 })).json.messages[0].ref;
    const none = await h.call("mark_messages", { refs: [ref] });
    assert.equal(none.isError, true);
    assert.match(none.text, /read and\/or flagged/);

    const marked = await h.call("mark_messages", { refs: [ref], read: true });
    assert.equal(marked.json[0].ok, true);
    assert.equal(marked.json[0].ref, ref);
  });

  test("move then trash", async () => {
    h = await startHarness("draft");
    const list = await h.call("list_messages", { account: "iCloud", subject_contains: "newsletter" });
    const ref = list.json.messages[0].ref;
    const moved = await h.call("move_message", { ref, mailbox: "Archive" });
    assert.equal(moved.json.moved, true);

    const archived = await h.call("list_messages", { account: "iCloud", mailbox: "Archive" });
    const trashed = await h.call("trash_messages", { refs: [archived.json.messages[0].ref] });
    assert.equal(trashed.json[0].ok, true);
    assert.equal(h.fake.find("iCloud", "Deleted Messages").messages.length, 1);
  });

  test("create_draft validates recipients before touching Mail", async () => {
    h = await startHarness("draft");
    const bad = await h.call("create_draft", { to: ["a@b.com, c@d.com"], subject: "x", body: "y" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Invalid recipient/);
    assert.equal(h.fake.outgoing.length, 0);

    const good = await h.call("create_draft", { to: ["Grace <g@navy.test>"], subject: "Line1\nBcc: x@y.z", body: "hi" });
    assert.equal(good.json.saved, true);
    assert.equal(h.fake.outgoing[0].subject, "Line1 Bcc: x@y.z");
  });

  test("send_email in full mode sends and enforces the recipient cap", async () => {
    h = await startHarness("full");
    const sent = await h.call("send_email", { to: ["a@b.com"], subject: "s", body: "b" });
    assert.equal(sent.json.sent, true);
    assert.equal(h.fake.outgoing[0].state, "sent");

    const many = Array.from({ length: 20 }, (_, i) => `u${i}@x.test`);
    const tooMany = await h.call("send_email", { to: many, cc: many.map((a) => "c" + a), subject: "s", body: "b" });
    assert.equal(tooMany.isError, true);
    assert.equal(h.fake.outgoing.length, 1);
  });

  test("Mail errors surface as tool errors with the explanation", async () => {
    h = await startHarness("read-only");
    const res = await h.call("list_messages", { account: "Nope" });
    assert.equal(res.isError, true);
    assert.match(res.text, /No account named "Nope"/);
  });
});
