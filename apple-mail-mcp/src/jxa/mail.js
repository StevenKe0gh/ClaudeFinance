// JXA (JavaScript for Automation) driver for Mail.app.
//
// Run as:  osascript -l JavaScript -e "<this file>" '<json request>'
//   request  = {"op": "<name>", "params": {...}}
//   response = {"ok": true, "result": ...} | {"ok": false, "error": "..."}
//
// All caller-supplied data arrives as JSON in argv and is never spliced into
// script source, so message text cannot inject script code.
//
// Messages are addressed by a locator {account, mailbox: [path...], id}; the
// TypeScript side wraps that into an opaque ref for the model.

var Mail = Application('Mail');
var OPS = {};

// Mailboxes Mail exposes at application level (combined across accounts) plus
// the names servers commonly use for them inside a single account.
var SPECIAL = {
  inbox: { app: 'inbox', names: ['INBOX', 'Inbox'] },
  sent: { app: 'sentMailbox', names: ['Sent', 'Sent Messages', 'Sent Mail', 'Sent Items'] },
  drafts: { app: 'draftsMailbox', names: ['Drafts', 'Draft'] },
  trash: { app: 'trashMailbox', names: ['Trash', 'Deleted Messages', 'Deleted Items', 'Bin'] },
  junk: { app: 'junkMailbox', names: ['Junk', 'Junk E-mail', 'Junk Email', 'Spam'] },
  outbox: { app: 'outbox', names: [] }
};

// ---------------------------------------------------------------- helpers

function fail(message) {
  throw new Error(message);
}

function errText(e) {
  return String(e && e.message ? e.message : e);
}

function attempt(fn, fallback) {
  try {
    var v = fn();
    return v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function lower(s) {
  return String(s).toLowerCase();
}

function indexOfName(names, wanted) {
  var i;
  for (i = 0; i < names.length; i++) {
    if (names[i] === wanted) return i;
  }
  var w = lower(wanted);
  for (i = 0; i < names.length; i++) {
    if (lower(names[i]) === w) return i;
  }
  return -1;
}

function specialKey(name) {
  var n = lower(name).replace(/^\s+|\s+$/g, '');
  var keys = Object.keys(SPECIAL);
  for (var i = 0; i < keys.length; i++) {
    if (n === keys[i]) return keys[i];
    var names = SPECIAL[keys[i]].names;
    for (var j = 0; j < names.length; j++) {
      if (n === lower(names[j])) return keys[i];
    }
  }
  return null;
}

function splitPath(name) {
  return String(name).split('/').filter(function (s) {
    return s.length > 0;
  });
}

// ------------------------------------------------- accounts and mailboxes

function findAccount(wanted) {
  var names = Mail.accounts.name();
  var i = indexOfName(names, wanted);
  if (i < 0) {
    var emails = attempt(function () { return Mail.accounts.emailAddresses(); }, []);
    var w = lower(wanted);
    for (var a = 0; a < emails.length && i < 0; a++) {
      for (var b = 0; b < emails[a].length; b++) {
        if (lower(emails[a][b]) === w) {
          i = a;
          break;
        }
      }
    }
  }
  if (i < 0) fail('No account named "' + wanted + '". Accounts: ' + names.join(', '));
  return Mail.accounts[i];
}

function isAccount(x) {
  return attempt(function () { x.emailAddresses(); return true; }, false);
}

// Walks `path` (array of names) down from an account. Returns null if absent.
// At the first level, well-known names (Sent, Trash, ...) match their aliases.
function mailboxIn(account, path) {
  var parent = account;
  for (var depth = 0; depth < path.length; depth++) {
    var names = parent.mailboxes.name();
    var i = indexOfName(names, path[depth]);
    if (i < 0 && depth === 0) {
      var key = specialKey(path[0]);
      if (key) {
        var aliases = SPECIAL[key].names;
        for (var n = 0; n < aliases.length && i < 0; n++) {
          i = indexOfName(names, aliases[n]);
        }
      }
    }
    if (i < 0) return null;
    parent = parent.mailboxes[i];
  }
  return parent;
}

// Returns {mb, unified}. Without an account, well-known names resolve to the
// combined mailboxes Mail shows in its sidebar (e.g. "All Inboxes").
function resolveMailbox(accountName, mailboxName) {
  var name = mailboxName || 'Inbox';
  var path = splitPath(name);
  if (path.length === 0) fail('Mailbox name is empty');

  if (accountName) {
    var account = findAccount(accountName);
    var mb = mailboxIn(account, path);
    if (!mb) {
      fail('No mailbox "' + name + '" in account "' + account.name() + '". Use list_mailboxes to see what exists.');
    }
    return { mb: mb, unified: false };
  }

  var key = path.length === 1 ? specialKey(path[0]) : null;
  if (key) return { mb: Mail[SPECIAL[key].app], unified: true };

  var accounts = Mail.accounts();
  var found = [];
  for (var i = 0; i < accounts.length; i++) {
    var hit = mailboxIn(accounts[i], path);
    if (hit) found.push({ mb: hit, account: accounts[i].name() });
  }
  if (found.length === 0) {
    fail('No mailbox "' + name + '" in any account. Use list_mailboxes to see what exists.');
  }
  if (found.length > 1) {
    fail('Mailbox "' + name + '" exists in several accounts (' +
      found.map(function (f) { return f.account; }).join(', ') + '). Specify account.');
  }
  return { mb: found[0].mb, unified: false };
}

// {account, path} for a mailbox specifier, climbing container links.
function describeMailbox(mb) {
  var path = [];
  var cur = mb;
  var account = null;
  for (var depth = 0; depth < 32; depth++) {
    path.unshift(cur.name());
    var parent = attempt(function () { return cur.container(); }, null);
    if (!parent) break;
    if (isAccount(parent)) {
      account = parent.name();
      break;
    }
    cur = parent;
  }
  if (account === null) account = attempt(function () { return mb.account().name(); }, '');
  return { account: account, path: path };
}

function mailboxNode(mb, name, path) {
  var here = path.concat([name]);
  var children = attempt(function () { return mb.mailboxes.name(); }, []);
  var out = [{
    path: here,
    unread: attempt(function () { return mb.unreadCount(); }, null)
  }];
  for (var i = 0; i < children.length; i++) {
    out = out.concat(mailboxNode(mb.mailboxes[i], children[i], here));
  }
  return out;
}

OPS.listAccounts = function () {
  return Mail.accounts().map(function (a) {
    return {
      name: a.name(),
      fullName: attempt(function () { return a.fullName(); }, null),
      emailAddresses: attempt(function () { return a.emailAddresses(); }, []),
      enabled: attempt(function () { return a.enabled(); }, null),
      type: attempt(function () { return String(a.accountType()); }, null)
    };
  });
};

OPS.listMailboxes = function (p) {
  var accounts = p.account ? [findAccount(p.account)] : Mail.accounts();
  return accounts.map(function (a) {
    var names = a.mailboxes.name();
    var list = [];
    for (var i = 0; i < names.length; i++) {
      list = list.concat(mailboxNode(a.mailboxes[i], names[i], []));
    }
    return { account: a.name(), mailboxes: list };
  });
};

// ---------------------------------------------------------------- messages

function messageFor(loc) {
  var account = findAccount(loc.account);
  var mb = mailboxIn(account, loc.mailbox);
  if (!mb) fail('Mailbox "' + loc.mailbox.join('/') + '" no longer exists in "' + loc.account + '".');
  var m = mb.messages.byId(loc.id);
  try {
    m.id();
  } catch (e) {
    fail('Message not found. It may have been moved or deleted; list the mailbox again for a fresh ref.');
  }
  return m;
}

function recipientsOf(coll) {
  var addrs = attempt(function () { return coll.address(); }, []);
  var names = attempt(function () { return coll.name(); }, []);
  return addrs.map(function (a, i) {
    return { name: names[i] || null, address: a };
  });
}

OPS.listMessages = function (p) {
  var target = resolveMailbox(p.account, p.mailbox);
  var filters = [];
  if (p.unreadOnly) filters.push({ readStatus: { _equals: false } });
  if (p.flaggedOnly) filters.push({ flaggedStatus: { _equals: true } });
  if (p.since) filters.push({ dateReceived: { _greaterThan: new Date(p.since) } });
  if (p.subjectContains) filters.push({ subject: { _contains: p.subjectContains } });
  if (p.senderContains) filters.push({ sender: { _contains: p.senderContains } });

  var all = target.mb.messages;
  var scope = filters.length === 0 ? all : all.whose(filters.length === 1 ? filters[0] : { _and: filters });
  var ids = scope.id();
  var dates = scope.dateReceived();

  var order = ids.map(function (_, i) { return i; });
  order.sort(function (a, b) { return (+dates[b] || 0) - (+dates[a] || 0); });
  var offset = p.offset || 0;
  var page = order.slice(offset, offset + p.limit);

  var fixedLoc = target.unified ? null : describeMailbox(target.mb);
  var messages = page.map(function (idx) {
    var m = all.byId(ids[idx]);
    var where = fixedLoc || describeMailbox(m.mailbox());
    return {
      id: ids[idx],
      subject: attempt(function () { return m.subject(); }, ''),
      sender: attempt(function () { return m.sender(); }, ''),
      dateReceived: dates[idx],
      read: attempt(function () { return m.readStatus(); }, null),
      flagged: attempt(function () { return m.flaggedStatus(); }, null),
      account: where.account,
      mailbox: where.path
    };
  });
  return { total: ids.length, offset: offset, returned: messages.length, messages: messages };
};

OPS.getMessage = function (p) {
  var m = messageFor(p.ref);
  var content = attempt(function () { return m.content(); }, '');
  var truncated = content.length > p.maxChars;
  var attachmentNames = attempt(function () { return m.mailAttachments.name(); }, []);
  var attachmentSizes = attempt(function () { return m.mailAttachments.fileSize(); }, []);
  var attachmentTypes = attempt(function () { return m.mailAttachments.mimeType(); }, []);
  var where = describeMailbox(m.mailbox());
  return {
    id: m.id(),
    account: where.account,
    mailbox: where.path,
    subject: attempt(function () { return m.subject(); }, ''),
    sender: attempt(function () { return m.sender(); }, ''),
    replyTo: attempt(function () { return m.replyTo(); }, ''),
    to: recipientsOf(m.toRecipients),
    cc: recipientsOf(m.ccRecipients),
    dateReceived: attempt(function () { return m.dateReceived(); }, null),
    dateSent: attempt(function () { return m.dateSent(); }, null),
    read: attempt(function () { return m.readStatus(); }, null),
    flagged: attempt(function () { return m.flaggedStatus(); }, null),
    messageId: attempt(function () { return m.messageId(); }, ''),
    attachments: attachmentNames.map(function (n, i) {
      return { name: n, bytes: attachmentSizes[i] === undefined ? null : attachmentSizes[i], mimeType: attachmentTypes[i] || null };
    }),
    body: truncated ? content.slice(0, p.maxChars) : content,
    bodyTruncated: truncated,
    bodyLength: content.length
  };
};

OPS.markMessages = function (p) {
  return p.refs.map(function (ref) {
    try {
      var m = messageFor(ref);
      if (typeof p.read === 'boolean') m.readStatus = p.read;
      if (typeof p.flagged === 'boolean') m.flaggedStatus = p.flagged;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  });
};

OPS.moveMessage = function (p) {
  var m = messageFor(p.ref);
  var dest = resolveMailbox(p.account || p.ref.account, p.mailbox);
  Mail.move(m, { to: dest.mb });
  return { moved: true, destination: describeMailbox(dest.mb) };
};

OPS.trashMessages = function (p) {
  return p.refs.map(function (ref) {
    try {
      Mail.delete(messageFor(ref));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  });
};

// ------------------------------------------------------ composing and sending

// Only addresses configured in Mail may be used as sender, so the model cannot
// put an arbitrary identity in the From line.
function resolveSender(address) {
  var lists = attempt(function () { return Mail.accounts.emailAddresses(); }, []);
  var fulls = attempt(function () { return Mail.accounts.fullName(); }, []);
  var known = [];
  var w = lower(address);
  for (var a = 0; a < lists.length; a++) {
    for (var b = 0; b < lists[a].length; b++) {
      known.push(lists[a][b]);
      if (lower(lists[a][b]) === w) {
        return fulls[a] ? fulls[a] + ' <' + lists[a][b] + '>' : lists[a][b];
      }
    }
  }
  fail('"' + address + '" is not an address configured in Mail. Available: ' + known.join(', '));
}

function addRecipients(msg, list, collection) {
  (list || []).forEach(function (r) {
    var props = { address: r.address };
    if (r.name) props.name = r.name;
    msg[collection].push(Mail.Recipient(props));
  });
}

function summarize(msg) {
  return {
    subject: attempt(function () { return msg.subject(); }, ''),
    to: recipientsOf(msg.toRecipients),
    cc: recipientsOf(msg.ccRecipients),
    bcc: recipientsOf(msg.bccRecipients)
  };
}

function composeOutgoing(p) {
  var sender = p.from ? resolveSender(p.from) : null; // validate before creating anything
  var msg = Mail.OutgoingMessage({ subject: p.subject, content: p.body, visible: !!p.show });
  Mail.outgoingMessages.push(msg);
  if (sender) msg.sender = sender;
  addRecipients(msg, p.to, 'toRecipients');
  addRecipients(msg, p.cc, 'ccRecipients');
  addRecipients(msg, p.bcc, 'bccRecipients');
  return msg;
}

OPS.createDraft = function (p) {
  var msg = composeOutgoing(p);
  msg.save();
  if (p.show) Mail.activate();
  var out = summarize(msg);
  out.saved = true;
  return out;
};

OPS.sendEmail = function (p) {
  var msg = composeOutgoing(p);
  var out = summarize(msg);
  msg.send();
  out.sent = true;
  return out;
};

OPS.replyToMessage = function (p) {
  var original = messageFor(p.ref);
  var sender = p.from ? resolveSender(p.from) : null;
  var reply = Mail.reply(original, { openingWindow: !!p.show, replyToAll: !!p.replyAll });
  if (sender) reply.sender = sender;
  var quoted = attempt(function () { return reply.content(); }, '');
  reply.content = p.body + '\n\n' + quoted;
  var out = summarize(reply);
  if (p.send) {
    reply.send();
    out.sent = true;
  } else {
    reply.save();
    if (p.show) Mail.activate();
    out.saved = true;
  }
  return out;
};

OPS.checkForNewMail = function () {
  Mail.checkForNewMail();
  return { requested: true };
};

// ------------------------------------------------------------------- entry

function run(argv) {
  var req;
  try {
    req = JSON.parse(argv[0]);
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'Invalid request JSON' });
  }
  var op = OPS[req.op];
  if (!op) return JSON.stringify({ ok: false, error: 'Unknown operation: ' + req.op });
  try {
    return JSON.stringify({ ok: true, result: op(req.params || {}) });
  } catch (e) {
    return JSON.stringify({ ok: false, error: errText(e) });
  }
}
