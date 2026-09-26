import { describe, expect, it } from "vitest";
import { base64Url, buildMimeMessage, encodeHeaderValue } from "./mime";

const decodeB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
const fromB64Url = (s: string) => decodeB64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

const input = {
  fromName: "N K Lodha & Co",
  fromEmail: "sender@example.com",
  to: "debtor@example.com",
  subject: "Payment reminder — Invoice INV-1 (Acme)",
  text: "Plain ₹1,180 outstanding\nSecond line",
  html: "<!DOCTYPE html><p>Rich ₹1,180</p>",
  boundary: "BOUNDARY123",
};

function parts(mime: string) {
  const [head, ...rest] = mime.split("\r\n\r\n");
  const bodies = rest.join("\r\n\r\n").split(/--BOUNDARY123(?:--)?\r\n?/).filter((p) => p.trim());
  return { head, bodies: bodies.map((b) => { const [h, ...c] = b.split("\r\n\r\n"); return { h, content: decodeB64(c.join("")) }; }) };
}

describe("buildMimeMessage", () => {
  const mime = buildMimeMessage(input);
  const { head, bodies } = parts(mime);

  it("has the required headers and multipart/alternative structure", () => {
    expect(head).toContain("From: \"N K Lodha & Co\" <sender@example.com>");
    expect(head).toContain("To: debtor@example.com");
    expect(head).toContain("MIME-Version: 1.0");
    expect(head).toContain('Content-Type: multipart/alternative; boundary="BOUNDARY123"');
    expect(mime.endsWith("--BOUNDARY123--\r\n")).toBe(true);
    expect(mime).toMatch(/\r\n/);
    expect(mime.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("puts text/plain first and text/html second, both UTF-8 base64", () => {
    expect(bodies).toHaveLength(2);
    expect(bodies[0].h).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(bodies[1].h).toContain('Content-Type: text/html; charset="UTF-8"');
    for (const b of bodies) expect(b.h).toContain("Content-Transfer-Encoding: base64");
  });

  it("preserves the plain-text and HTML bodies including the rupee sign", () => {
    expect(bodies[0].content).toBe("Plain ₹1,180 outstanding\r\nSecond line");
    expect(bodies[1].content).toBe("<!DOCTYPE html><p>Rich ₹1,180</p>");
  });

  it("encodes a non-ASCII subject as RFC 2047 words that decode back exactly", () => {
    const line = head.split("\r\n").filter((l) => l.startsWith("Subject:") || l.startsWith(" =?"));
    const joined = line.join("").replace("Subject: ", "");
    const decoded = [...joined.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)].map((m) => decodeB64(m[1])).join("");
    expect(decoded).toBe(input.subject);
    for (const l of head.split("\r\n")) expect(l.length).toBeLessThanOrEqual(78);
  });

  it("keeps a plain ASCII subject unencoded", () => {
    expect(buildMimeMessage({ ...input, subject: "Payment reminder (Acme)" })).toContain("Subject: Payment reminder (Acme)\r\n");
  });

  it("cannot be header-injected through subject, recipient or sender name", () => {
    const m = buildMimeMessage({ ...input, subject: "Hi\r\nBcc: evil@example.com", to: "a@example.com\r\nBcc: evil@example.com", fromName: 'X"\r\nBcc: e@e.com' });
    const headers = m.split("\r\n\r\n")[0].split("\r\n");
    expect(headers.some((l) => /^Bcc:/i.test(l))).toBe(false);
    expect(headers.filter((l) => /^(From|To|Subject):/.test(l))).toHaveLength(3);
  });

  it("uses a fresh random boundary by default", () => {
    const a = buildMimeMessage({ ...input, boundary: undefined });
    const b = buildMimeMessage({ ...input, boundary: undefined });
    expect(a.match(/boundary="([^"]+)"/)![1]).not.toBe(b.match(/boundary="([^"]+)"/)![1]);
  });
});

describe("base64Url / encodeHeaderValue", () => {
  it("base64url uses -_ and no padding, and round-trips UTF-8", () => {
    const s = "₹ ??>>~~ — नमस्ते";
    const enc = base64Url(s);
    expect(enc).not.toMatch(/[+/=]/);
    expect(fromB64Url(enc)).toBe(s);
  });

  it("splits long non-ASCII header values into <=75 char encoded words without cutting a character", () => {
    const v = "₹".repeat(60);
    const enc = encodeHeaderValue(v);
    const words = enc.split(/\r\n /);
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    expect(words.map((w) => decodeB64(w.slice(10, -2))).join("")).toBe(v);
  });
});
