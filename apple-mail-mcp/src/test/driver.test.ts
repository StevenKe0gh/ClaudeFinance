import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { createFakeMail, type FakeMail } from "./fakeMail.js";
import { inProcessRunner } from "./helpers.js";
import type { JxaRunner } from "../runner.js";

let fake: FakeMail;
let r: JxaRunner;

beforeEach(() => {
  fake = createFakeMail();
  r = inProcessRunner(fake);
});

const loc = (account: string, mailbox: string[], id: number) => ({ account, mailbox, id });

describe("accounts and mailboxes", () => {
  test("listAccounts", async () => {
    const accounts = await r.call<any[]>("listAccounts");
    assert.deepEqual(
      accounts.map((a) => [a.name, a.emailAddresses]),
      [
        ["iCloud", ["ada@icloud.com"]],
        ["Gmail", ["ada@gmail.com", "ada.l@gmail.com"]],
      ],
    );
  });

  test("listMailboxes flattens nested mailboxes into paths with unread counts", async () => {
    const [icloud] = await r.call<any[]>("listMailboxes", { account: "icloud" });
    const byPath = new Map(icloud.mailboxes.map((m: any) => [m.path.join("/"), m.unread]));
    assert.equal(byPath.get("INBOX"), 1);
    assert.equal(byPath.get("Work/Clients"), 1);
    assert.ok(byPath.has("Work"));
  });

  test("unknown account lists the real ones", async () => {
    await assert.rejects(r.call("listMailboxes", { account: "nope" }), /No account named "nope".*iCloud, Gmail/);
  });
});

describe("listMessages", () => {
  test("combined inbox merges accounts, newest first, with real locations", async () => {
    const res = await r.call<any>("listMessages", { limit: 10 });
    assert.equal(res.total, 5);
    assert.deepEqual(
      res.messages.map((m: any) => m.subject),
      ["Quarterly invoice", "Quarterly report", "Weekend plans", "Lunch?", "Old newsletter"],
    );
    const invoice = res.messages[0];
    assert.equal(invoice.account, "Gmail");
    assert.deepEqual(invoice.mailbox, ["INBOX"]);
    assert.equal(invoice.read, false);
  });

  test("account + nested mailbox, case-insensitive path", async () => {
    const res = await r.call<any>("listMessages", { account: "iCloud", mailbox: "work/clients", limit: 5 });
    assert.equal(res.total, 1);
    assert.deepEqual(res.messages[0].mailbox, ["Work", "Clients"]);
    assert.equal(res.messages[0].subject, "Contract draft");
  });

  test("account without mailbox means its inbox; INBOX alias resolves", async () => {
    const res = await r.call<any>("listMessages", { account: "Gmail", limit: 5 });
    assert.equal(res.total, 2);
  });

  test("a unique mailbox name is found without naming the account", async () => {
    const res = await r.call<any>("listMessages", { mailbox: "Work/Clients", limit: 5 });
    assert.equal(res.messages[0].account, "iCloud");
  });

  test("an ambiguous mailbox name asks for the account", async () => {
    await assert.rejects(r.call("listMessages", { mailbox: "Archive", limit: 5 }), /several accounts \(iCloud, Gmail\)/);
  });

  test("missing mailbox explains how to recover", async () => {
    await assert.rejects(r.call("listMessages", { account: "iCloud", mailbox: "Nope", limit: 5 }), /list_mailboxes/);
  });

  test("filters: unread, flagged, subject, sender, since, and combinations", async () => {
    const subjects = async (p: object) =>
      (await r.call<any>("listMessages", { limit: 10, ...p })).messages.map((m: any) => m.subject);

    assert.deepEqual(await subjects({ unreadOnly: true }), ["Quarterly invoice", "Quarterly report", "Weekend plans"]);
    assert.deepEqual(await subjects({ flaggedOnly: true }), ["Lunch?"]);
    assert.deepEqual(await subjects({ subjectContains: "QUARTERLY" }), ["Quarterly invoice", "Quarterly report"]);
    assert.deepEqual(await subjects({ senderContains: "turing" }), ["Lunch?"]);
    assert.deepEqual(await subjects({ since: "2026-09-29T00:00:00Z" }), [
      "Quarterly invoice",
      "Quarterly report",
      "Weekend plans",
    ]);
    assert.deepEqual(await subjects({ unreadOnly: true, subjectContains: "report", since: "2026-09-01T00:00:00Z" }), [
      "Quarterly report",
    ]);
    assert.deepEqual(await subjects({ subjectContains: "no such subject" }), []);
  });

  test("limit and offset page through matches while total stays fixed", async () => {
    const page1 = await r.call<any>("listMessages", { limit: 2, offset: 0 });
    const page2 = await r.call<any>("listMessages", { limit: 2, offset: 2 });
    assert.equal(page1.total, 5);
    assert.equal(page2.total, 5);
    assert.deepEqual(page1.messages.map((m: any) => m.subject), ["Quarterly invoice", "Quarterly report"]);
    assert.deepEqual(page2.messages.map((m: any) => m.subject), ["Weekend plans", "Lunch?"]);
  });
});

describe("getMessage", () => {
  test("returns headers, recipients, attachments and a truncated body", async () => {
    const m = fake.message("iCloud", ["INBOX"], "Quarterly report");
    const res = await r.call<any>("getMessage", { ref: loc("iCloud", ["INBOX"], m.id), maxChars: 500 });
    assert.equal(res.subject, "Quarterly report");
    assert.equal(res.sender, "Grace Hopper <grace@navy.test>");
    assert.deepEqual(res.to, [{ name: "Ada Lovelace", address: "ada@icloud.com" }]);
    assert.deepEqual(res.cc, [{ name: null, address: "bob@example.test" }]);
    assert.deepEqual(res.attachments, [{ name: "q3.pdf", bytes: 2048, mimeType: "application/pdf" }]);
    assert.equal(res.body.length, 500);
    assert.equal(res.bodyTruncated, true);
    assert.equal(res.bodyLength, m.content.length);
    assert.equal(res.account, "iCloud");
  });

  test("stale ref gives a recoverable error", async () => {
    await assert.rejects(r.call("getMessage", { ref: loc("iCloud", ["INBOX"], 424242), maxChars: 500 }), /Message not found/);
  });
});

describe("organizing", () => {
  test("markMessages sets read/flagged per ref and reports failures individually", async () => {
    const report = fake.message("iCloud", ["INBOX"], "Quarterly report");
    const res = await r.call<any[]>("markMessages", {
      refs: [loc("iCloud", ["INBOX"], report.id), loc("iCloud", ["INBOX"], 999999)],
      read: true,
      flagged: true,
    });
    assert.equal(res[0].ok, true);
    assert.equal(res[1].ok, false);
    assert.match(res[1].error, /Message not found/);
    assert.equal(report.readStatus, true);
    assert.equal(report.flaggedStatus, true);
  });

  test("markMessages leaves unspecified fields alone", async () => {
    const lunch = fake.message("iCloud", ["INBOX"], "Lunch?");
    await r.call("markMessages", { refs: [loc("iCloud", ["INBOX"], lunch.id)], read: false });
    assert.equal(lunch.readStatus, false);
    assert.equal(lunch.flaggedStatus, true);
  });

  test("moveMessage moves within the account and invalidates the old id", async () => {
    const m = fake.message("iCloud", ["INBOX"], "Old newsletter");
    const oldId = m.id;
    const res = await r.call<any>("moveMessage", { ref: loc("iCloud", ["INBOX"], oldId), mailbox: "Archive" });
    assert.deepEqual(res.destination, { account: "iCloud", path: ["Archive"] });
    assert.equal(fake.find("iCloud", "Archive").messages.length, 1);
    await assert.rejects(r.call("getMessage", { ref: loc("iCloud", ["INBOX"], oldId), maxChars: 500 }), /Message not found/);
  });

  test("moveMessage can target a nested mailbox in another account", async () => {
    const m = fake.message("iCloud", ["INBOX"], "Lunch?");
    const res = await r.call<any>("moveMessage", {
      ref: loc("iCloud", ["INBOX"], m.id),
      mailbox: "[Gmail]/Trash",
      account: "Gmail",
    });
    assert.deepEqual(res.destination, { account: "Gmail", path: ["[Gmail]", "Trash"] });
  });

  test("trashMessages moves to the account's trash, never deleting", async () => {
    const m = fake.message("iCloud", ["INBOX"], "Old newsletter");
    const res = await r.call<any[]>("trashMessages", { refs: [loc("iCloud", ["INBOX"], m.id)] });
    assert.equal(res[0].ok, true);
    assert.equal(fake.find("iCloud", "Deleted Messages").messages.length, 1);
    assert.equal(fake.find("iCloud", "INBOX").messages.length, 2);
  });

  test("checkForNewMail", async () => {
    await r.call("checkForNewMail");
    assert.equal(fake.checked, 1);
  });
});

describe("composing", () => {
  const draft = {
    to: [{ name: "Grace Hopper", address: "grace@navy.test" }],
    cc: [{ name: null, address: "bob@example.test" }],
    bcc: [],
    subject: "Hello",
    body: "Hi Grace",
    show: false,
  };

  test("createDraft saves without sending", async () => {
    const res = await r.call<any>("createDraft", draft);
    assert.equal(res.saved, true);
    assert.deepEqual(res.to, [{ name: "Grace Hopper", address: "grace@navy.test" }]);
    assert.equal(fake.outgoing.length, 1);
    assert.equal(fake.outgoing[0].state, "saved");
    assert.equal(fake.outgoing[0].visible, false);
    assert.equal(fake.activated, 0);
  });

  test("createDraft with show opens the window", async () => {
    await r.call("createDraft", { ...draft, show: true });
    assert.equal(fake.outgoing[0].visible, true);
    assert.equal(fake.activated, 1);
  });

  test("sender must be an address configured in Mail, and failure leaves nothing behind", async () => {
    await assert.rejects(
      r.call("createDraft", { ...draft, from: "ceo@evil.test" }),
      /not an address configured in Mail.*ada@icloud.com/,
    );
    assert.equal(fake.outgoing.length, 0);

    await r.call("createDraft", { ...draft, from: "ADA.L@gmail.com" });
    assert.equal(fake.outgoing[0].sender, "Ada L <ada.l@gmail.com>");
  });

  test("sendEmail sends", async () => {
    const res = await r.call<any>("sendEmail", draft);
    assert.equal(res.sent, true);
    assert.equal(fake.outgoing[0].state, "sent");
  });

  test("replyToMessage saves a draft with the body above the quote", async () => {
    const m = fake.message("iCloud", ["INBOX"], "Quarterly report");
    const res = await r.call<any>("replyToMessage", {
      ref: loc("iCloud", ["INBOX"], m.id),
      body: "Thanks, looks good.",
      replyAll: false,
      show: false,
      send: false,
    });
    assert.equal(res.saved, true);
    assert.equal(res.subject, "Re: Quarterly report");
    assert.deepEqual(res.to, [{ name: "Grace Hopper", address: "grace@navy.test" }]);
    assert.deepEqual(res.cc, []);
    const out = fake.outgoing[0];
    assert.equal(out.state, "saved");
    assert.ok(out.content.startsWith("Thanks, looks good.\n\n"));
    assert.match(out.content, /wrote:/);
  });

  test("replyToMessage reply-all adds the other recipients but not me", async () => {
    const m = fake.message("iCloud", ["INBOX"], "Quarterly report");
    const res = await r.call<any>("replyToMessage", {
      ref: loc("iCloud", ["INBOX"], m.id),
      body: "ok",
      replyAll: true,
      send: false,
    });
    assert.deepEqual(res.cc.map((c: any) => c.address), ["bob@example.test"]);
  });

  test("replyToMessage send=true sends", async () => {
    const m = fake.message("iCloud", ["INBOX"], "Lunch?");
    const res = await r.call<any>("replyToMessage", { ref: loc("iCloud", ["INBOX"], m.id), body: "Yes", send: true });
    assert.equal(res.sent, true);
    assert.equal(fake.outgoing[0].state, "sent");
  });
});

describe("driver robustness", () => {
  test("unknown operations and malformed requests fail cleanly", async () => {
    await assert.rejects(r.call("dropTables"), /Unknown operation: dropTables/);
  });

  test("request data is treated as data, never code", async () => {
    const hostile = `"); Mail.delete(Mail.inbox); ("`;
    const res = await r.call<any>("listMessages", { subjectContains: hostile, limit: 5 });
    assert.equal(res.total, 0);
    assert.equal(fake.find("iCloud", "INBOX").messages.length, 3);
  });
});
