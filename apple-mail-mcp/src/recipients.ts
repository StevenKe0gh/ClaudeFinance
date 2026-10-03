export interface Recipient {
  name: string | null;
  address: string;
}

const BARE = /^[^\s<>@,;:"()[\]\\]+@[^\s<>@,;:"()[\]\\]+\.[^\s<>@,;:"()[\]\\]+$/;
const NAMED = /^\s*"?([^"<>\r\n]*?)"?\s*<([^\s<>@,;]+@[^\s<>@,;]+)>\s*$/;

/**
 * Accepts `user@example.com` or `Display Name <user@example.com>`.
 * Anything else (multiple addresses in one string, control characters) is rejected,
 * which also rules out header injection through a recipient field.
 */
export function parseRecipient(input: string): Recipient {
  const s = input.trim();
  if (/[\r\n\0]/.test(s)) throw new Error(`Invalid recipient (control characters): ${JSON.stringify(input)}`);
  if (BARE.test(s)) return { name: null, address: s };
  const m = NAMED.exec(s);
  if (m && BARE.test(m[2])) return { name: m[1].trim() || null, address: m[2] };
  throw new Error(
    `Invalid recipient "${input}". Use one address per entry: "a@b.com" or "Name <a@b.com>".`,
  );
}

export function parseRecipients(list: string[] | undefined): Recipient[] {
  return (list ?? []).map(parseRecipient);
}

/** Subjects are single-line; fold any line breaks into spaces. */
export function cleanSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").trim();
}
