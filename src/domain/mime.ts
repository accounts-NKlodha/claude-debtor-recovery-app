/**
 * Standards-compliant MIME builder for the Gmail API (`users.messages.send`
 * takes a base64url RFC 2822 message). Pure and runtime-agnostic: only
 * TextEncoder / btoa / crypto.randomUUID, so it runs unchanged in Node and in
 * Cloudflare Workers. No I/O, no logging, no dependency.
 *
 * Output: multipart/alternative with a text/plain part FIRST and a text/html
 * part second (clients render the last alternative they support), both UTF-8
 * and base64 transfer-encoded so the rupee sign and em dash survive any relay.
 * Non-ASCII header values use RFC 2047 encoded-words. Header values are
 * single-lined, so no user-controlled value can inject a header.
 */

export interface MimeInput {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Test hook; production uses a random boundary. */
  boundary?: string;
}

const CRLF = "\r\n";
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
const isAscii = (v: string) => /^[\x20-\x7e]*$/.test(v);

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, `$1${CRLF}`).replace(new RegExp(`${CRLF}$`), "");

/** RFC 2047 "B" encoded-words, split on code-point boundaries so each word stays <= 75 chars. */
export function encodeHeaderValue(value: string): string {
  const v = oneLine(value);
  if (isAscii(v)) return v;
  const words: string[] = [];
  let chunk = "";
  const flush = () => {
    if (chunk) words.push(`=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(chunk))}?=`);
    chunk = "";
  };
  for (const ch of v) {
    // ~45 raw bytes -> 60 base64 chars + 12 framing = 72 (< 75)
    if (new TextEncoder().encode(chunk + ch).length > 45) flush();
    chunk += ch;
  }
  flush();
  return words.join(`${CRLF} `);
}

function formatAddress(name: string, email: string): string {
  const n = oneLine(name);
  const addr = oneLine(email);
  if (!n) return addr;
  if (!isAscii(n)) return `${encodeHeaderValue(n)} <${addr}>`;
  return `"${n.replace(/(["\\])/g, "\\$1")}" <${addr}>`;
}

export function buildMimeMessage(input: MimeInput): string {
  const boundary = input.boundary ?? `nkl_${crypto.randomUUID().replace(/-/g, "")}`;
  const enc = (s: string) => wrap76(bytesToBase64(new TextEncoder().encode(s.replace(/\r?\n/g, CRLF))));
  const headers = [
    `From: ${formatAddress(input.fromName, input.fromEmail)}`,
    `To: ${oneLine(input.to)}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    headers.join(CRLF),
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    enc(input.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    enc(input.html),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}
