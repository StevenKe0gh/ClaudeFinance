import { z } from "zod";

/** Where a message lives in Mail. `mailbox` is the path of nested mailbox names. */
export interface MessageLocator {
  account: string;
  mailbox: string[];
  id: number;
}

const locatorSchema = z.tuple([z.string().min(1), z.array(z.string().min(1)).min(1), z.number().int()]);

const PREFIX = "msg_";

/** Opaque handle handed to the model; decoded again on the way back in. */
export function encodeRef(loc: MessageLocator): string {
  return PREFIX + Buffer.from(JSON.stringify([loc.account, loc.mailbox, loc.id])).toString("base64url");
}

export function decodeRef(ref: string): MessageLocator {
  const bad = new Error(
    `Invalid message ref "${ref.slice(0, 40)}". Use a ref returned by list_messages.`,
  );
  if (!ref.startsWith(PREFIX)) throw bad;
  try {
    const raw: unknown = JSON.parse(Buffer.from(ref.slice(PREFIX.length), "base64url").toString("utf8"));
    const [account, mailbox, id] = locatorSchema.parse(raw);
    return { account, mailbox, id };
  } catch {
    throw bad;
  }
}
