/**
 * In-memory stand-in for the slice of Mail.app's scripting dictionary that
 * src/jxa/mail.js uses, exposed with JXA-style specifier semantics:
 *
 *   collection()          -> array of elements       collection.name()   -> bulk property
 *   collection[i]         -> element                 collection.byId(n)  -> element (throws on use if missing)
 *   collection.whose(f)   -> filtered collection     element.prop()      -> value;  element.prop = v  -> set
 *
 * It lets the real driver script run end to end on any OS. It encodes our
 * assumptions about Mail's API, so it catches logic bugs, not API surprises.
 */
import { readFileSync } from "node:fs";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Rcpt {
  name?: string | null;
  address: string;
}

export interface Msg {
  id: number;
  subject: string;
  sender: string;
  dateReceived: Date;
  dateSent: Date;
  readStatus: boolean;
  flaggedStatus: boolean;
  content: string;
  messageId: string;
  replyTo: string;
  to: Rcpt[];
  cc: Rcpt[];
  bcc: Rcpt[];
  attachments: Array<{ name: string; fileSize: number; mimeType: string }>;
  mailbox: Box;
}

export interface Box {
  name: string;
  messages: Msg[];
  children: Box[];
  parent: Box | Acct;
  account: Acct;
}

export interface Acct {
  isAccount: true;
  name: string;
  fullName: string;
  emailAddresses: string[];
  enabled: boolean;
  accountType: string;
  mailboxes: Box[];
}

export interface Outgoing {
  subject: string;
  content: string;
  visible: boolean;
  sender: string;
  to: Rcpt[];
  cc: Rcpt[];
  bcc: Rcpt[];
  state: "new" | "saved" | "sent";
  registered: boolean;
  replyAll?: boolean;
}

export interface FakeMail {
  Mail: any;
  accounts: Acct[];
  outgoing: Outgoing[];
  activated: number;
  checked: number;
  find(account: string, ...path: string[]): Box;
  message(account: string, path: string[], subject: string): Msg;
}

const ITEMS = new WeakMap<object, any>();
const unwrap = (el: any) => ITEMS.get(el);

function matches(item: any, f: any): boolean {
  if (f._and) return f._and.every((x: any) => matches(item, x));
  return Object.entries(f).every(([prop, cond]: [string, any]) => {
    const v = item[prop];
    if ("_equals" in cond) return v === cond._equals;
    if ("_contains" in cond) return String(v).toLowerCase().includes(String(cond._contains).toLowerCase());
    if ("_greaterThan" in cond) return +v > +cond._greaterThan;
    throw new Error(`fake: unsupported filter ${JSON.stringify(cond)}`);
  });
}

function element(
  item: any,
  spec: {
    collections?: Record<string, () => any>;
    calls?: Record<string, () => any>;
    methods?: Record<string, (...a: any[]) => any>;
  } = {},
): any {
  const proxy: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (spec.collections && prop in spec.collections) return spec.collections[prop]();
        if (spec.calls && prop in spec.calls) return spec.calls[prop];
        if (spec.methods && prop in spec.methods) return spec.methods[prop];
        return () => {
          if (!(prop in item)) throw new Error(`Can't get ${prop}. (-1728)`);
          return item[prop];
        };
      },
      set(_t, prop, value) {
        item[String(prop)] = value;
        return true;
      },
    },
  );
  ITEMS.set(proxy, item);
  return proxy;
}

function collection(getItems: () => any[], wrap: (item: any) => any, extra: Record<string, any> = {}): any {
  const fn = () => getItems().map(wrap);
  return new Proxy(fn, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop in extra) return extra[prop];
      if (/^\d+$/.test(prop)) {
        const it = getItems()[Number(prop)];
        if (!it) throw new Error(`Can't get item ${prop}. (-1728)`);
        return wrap(it);
      }
      if (prop === "byId") {
        return (id: number) => {
          const it = getItems().find((x) => x.id === id);
          return it ? wrap(it) : element({});
        };
      }
      if (prop === "whose") return (f: any) => collection(() => getItems().filter((i) => matches(i, f)), wrap, extra);
      return () => getItems().map((i) => {
        if (!(prop in i)) throw new Error(`Can't get ${prop}. (-1728)`);
        return i[prop];
      });
    },
  });
}

export function createFakeMail(): FakeMail {
  let nextId = 1000;
  const accounts: Acct[] = [];
  const outgoing: Outgoing[] = [];
  const state = { activated: 0, checked: 0 };

  const addAccount = (name: string, fullName: string, emailAddresses: string[], accountType: string): Acct => {
    const a: Acct = { isAccount: true, name, fullName, emailAddresses, enabled: true, accountType, mailboxes: [] };
    accounts.push(a);
    return a;
  };
  const addBox = (parent: Acct | Box, name: string): Box => {
    const account = "isAccount" in parent ? parent : parent.account;
    const b: Box = { name, messages: [], children: [], parent, account };
    ("isAccount" in parent ? parent.mailboxes : parent.children).push(b);
    return b;
  };
  const addMsg = (
    box: Box,
    m: Partial<Omit<Msg, "dateReceived">> & { subject: string; sender: string; dateReceived: string },
  ): Msg => {
    const msg: Msg = {
      id: ++nextId,
      dateSent: new Date(m.dateReceived),
      readStatus: false,
      flaggedStatus: false,
      content: `Body of ${m.subject}`,
      messageId: `<${nextId}@example.test>`,
      replyTo: "",
      to: [],
      cc: [],
      bcc: [],
      attachments: [],
      ...m,
      dateReceived: new Date(m.dateReceived),
      mailbox: box,
    };
    box.messages.push(msg);
    return msg;
  };

  // --- seed data -----------------------------------------------------------
  const icloud = addAccount("iCloud", "Ada Lovelace", ["ada@icloud.com"], "iCloud");
  const iInbox = addBox(icloud, "INBOX");
  addBox(icloud, "Sent Messages");
  addBox(icloud, "Drafts");
  addBox(icloud, "Deleted Messages");
  addBox(icloud, "Archive");
  const work = addBox(icloud, "Work");
  const clients = addBox(work, "Clients");

  const gmail = addAccount("Gmail", "Ada L", ["ada@gmail.com", "ada.l@gmail.com"], "imap");
  const gInbox = addBox(gmail, "INBOX");
  addBox(gmail, "Archive");
  const gRoot = addBox(gmail, "[Gmail]");
  addBox(gRoot, "Trash");

  addMsg(iInbox, {
    subject: "Quarterly report",
    sender: "Grace Hopper <grace@navy.test>",
    dateReceived: "2026-09-30T10:00:00Z",
    readStatus: false,
    to: [{ name: "Ada Lovelace", address: "ada@icloud.com" }],
    cc: [{ name: null, address: "bob@example.test" }],
    attachments: [{ name: "q3.pdf", fileSize: 2048, mimeType: "application/pdf" }],
    content: "Please review the attached report.\n".repeat(100),
  });
  addMsg(iInbox, {
    subject: "Lunch?",
    sender: "Alan Turing <alan@bletchley.test>",
    dateReceived: "2026-09-28T12:00:00Z",
    readStatus: true,
    flaggedStatus: true,
    to: [{ name: null, address: "ada@icloud.com" }],
  });
  addMsg(iInbox, {
    subject: "Old newsletter",
    sender: "News <news@example.test>",
    dateReceived: "2026-08-01T08:00:00Z",
    readStatus: true,
  });
  addMsg(gInbox, {
    subject: "Quarterly invoice",
    sender: "Billing <billing@vendor.test>",
    dateReceived: "2026-10-01T09:00:00Z",
    readStatus: false,
    to: [{ name: null, address: "ada@gmail.com" }],
  });
  addMsg(gInbox, {
    subject: "Weekend plans",
    sender: "Katherine Johnson <kj@nasa.test>",
    dateReceived: "2026-09-29T18:30:00Z",
    readStatus: false,
  });
  addMsg(clients, {
    subject: "Contract draft",
    sender: "Client <client@bigco.test>",
    dateReceived: "2026-09-25T15:00:00Z",
    readStatus: false,
  });

  // --- specifier wrappers ----------------------------------------------------
  const rcptEl = (r: Rcpt) => element(r);
  const rcptColl = (list: Rcpt[]) =>
    collection(() => list, rcptEl, { push: (rec: any) => list.push(unwrap(rec)) });

  const msgEl = (m: Msg): any =>
    element(m, {
      collections: {
        toRecipients: () => rcptColl(m.to),
        ccRecipients: () => rcptColl(m.cc),
        bccRecipients: () => rcptColl(m.bcc),
        mailAttachments: () => collection(() => m.attachments, (a) => element(a)),
      },
      calls: { mailbox: () => boxEl(m.mailbox) },
    });

  const acctEl = (a: Acct): any =>
    element(a, { collections: { mailboxes: () => collection(() => a.mailboxes, boxEl) } });

  const boxEl = (b: Box): any =>
    element(b, {
      collections: {
        messages: () => collection(() => b.messages, msgEl),
        mailboxes: () => collection(() => b.children, boxEl),
      },
      calls: {
        container: () => ("isAccount" in b.parent ? acctEl(b.parent) : boxEl(b.parent)),
        account: () => acctEl(b.account),
        unreadCount: () => b.messages.filter((m) => !m.readStatus).length,
      },
    });

  const outEl = (o: Outgoing): any =>
    element(o, {
      collections: {
        toRecipients: () => rcptColl(o.to),
        ccRecipients: () => rcptColl(o.cc),
        bccRecipients: () => rcptColl(o.bcc),
      },
      methods: {
        save: () => {
          o.state = "saved";
        },
        send: () => {
          o.state = "sent";
        },
      },
    });

  const unifiedEl = (aliases: string[]): any => {
    const boxes = () => accounts.flatMap((a) => a.mailboxes.filter((b) => aliases.includes(b.name)));
    return element(
      { name: aliases[0] },
      {
        collections: {
          messages: () => collection(() => boxes().flatMap((b) => b.messages), msgEl),
          mailboxes: () => collection(() => [], boxEl),
        },
      },
    );
  };

  const parseSender = (s: string): Rcpt => {
    const m = /^(.*?)\s*<(.+)>$/.exec(s);
    return m ? { name: m[1] || null, address: m[2] } : { name: null, address: s };
  };

  const Mail = {
    accounts: collection(() => accounts, acctEl),
    inbox: unifiedEl(["INBOX"]),
    sentMailbox: unifiedEl(["Sent Messages"]),
    draftsMailbox: unifiedEl(["Drafts"]),
    trashMailbox: unifiedEl(["Deleted Messages", "Trash"]),
    junkMailbox: unifiedEl(["Junk"]),
    outbox: unifiedEl(["Outbox"]),
    outgoingMessages: {
      push: (el: any) => {
        const o: Outgoing = unwrap(el);
        o.registered = true;
        outgoing.push(o);
      },
    },
    OutgoingMessage: (props: any) =>
      outEl({
        subject: "",
        content: "",
        visible: false,
        sender: "",
        ...props,
        to: [],
        cc: [],
        bcc: [],
        state: "new",
        registered: false,
      }),
    Recipient: (props: any) => element({ ...props }),
    reply: (m: any, opts: any) => {
      const orig: Msg = unwrap(m);
      const own = orig.mailbox.account.emailAddresses;
      const o: Outgoing = {
        subject: `Re: ${orig.subject}`,
        content: `\n\nOn ${orig.dateReceived.toISOString()}, ${orig.sender} wrote:\n> ${orig.content}`,
        visible: !!opts?.openingWindow,
        sender: own[0],
        to: [parseSender(orig.sender)],
        cc: opts?.replyToAll ? [...orig.to, ...orig.cc].filter((r) => !own.includes(r.address)) : [],
        bcc: [],
        state: "new",
        registered: true,
        replyAll: !!opts?.replyToAll,
      };
      outgoing.push(o);
      return outEl(o);
    },
    move: (m: any, opts: any) => {
      const msg: Msg = unwrap(m);
      const dest: Box = unwrap(opts.to);
      msg.mailbox.messages.splice(msg.mailbox.messages.indexOf(msg), 1);
      msg.id = ++nextId; // servers assign a new id on move
      msg.mailbox = dest;
      dest.messages.push(msg);
    },
    delete: (m: any) => {
      const msg: Msg = unwrap(m);
      const trash =
        msg.mailbox.account.mailboxes.find((b) => b.name === "Deleted Messages") ??
        msg.mailbox.account.mailboxes.flatMap((b) => b.children).find((b) => b.name === "Trash");
      if (!trash) throw new Error("fake: account has no trash");
      Mail.move(m, { to: boxEl(trash) });
    },
    checkForNewMail: () => {
      state.checked++;
    },
    activate: () => {
      state.activated++;
    },
  };

  const fake: FakeMail = {
    Mail,
    accounts,
    outgoing,
    get activated() {
      return state.activated;
    },
    get checked() {
      return state.checked;
    },
    find(account, ...path) {
      let cur: Box | undefined;
      let list = accounts.find((a) => a.name === account)!.mailboxes;
      for (const seg of path) {
        cur = list.find((b) => b.name === seg);
        if (!cur) throw new Error(`fake: no mailbox ${path.join("/")}`);
        list = cur.children;
      }
      return cur!;
    },
    message(account, path, subject) {
      const m = fake.find(account, ...path).messages.find((x) => x.subject === subject);
      if (!m) throw new Error(`fake: no message ${subject}`);
      return m;
    },
  };
  return fake;
}

const DRIVER_SOURCE = readFileSync(new URL("../jxa/mail.js", import.meta.url), "utf8");

/** Evaluate the real driver script against a fake Mail. Returns `run(requestJson) -> responseJson`. */
export function loadDriver(fake: FakeMail, source: string = DRIVER_SOURCE): (request: string) => string {
  const factory = new Function("Application", `${source}\nreturn run;`);
  const run = factory((name: string) => {
    if (name !== "Mail") throw new Error(`fake: unexpected application ${name}`);
    return fake.Mail;
  });
  return (request: string) => run([request]);
}
