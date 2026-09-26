/**
 * The transport is unchanged (nodemailer via the same Gmail SMTP config); the
 * only difference is that a supplied HTML body is sent alongside the plain-text
 * body. No network: nodemailer is faked, so nothing is ever sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }));

import { gmailSmtp } from "./gmail-smtp";

const input = {
  idempotencyKey: "k",
  caseId: "case-1",
  channel: "email" as const,
  to: "debtor@example.com",
  subject: "Payment reminder — Invoice X (Acme)",
  body: "Plain text body",
};

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: "<id@mail>", rejected: [] });
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USER = "sender@example.com";
  process.env.SMTP_APP_PASSWORD = "abcdefghijklmnop";
  process.env.SMTP_FROM_ADDRESS = "sender@example.com";
  process.env.SMTP_FROM_NAME = "Debtor Recovery";
});

describe("gmailSmtp.send with an HTML body", () => {
  it("sends both html and text through the same transport, subject unchanged", async () => {
    const result = await gmailSmtp.send({ ...input, html: "<!DOCTYPE html><p>Rich</p>" });
    expect(result.outcome).toBe("success");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: "debtor@example.com",
      subject: "Payment reminder — Invoice X (Acme)",
      text: "Plain text body",
      html: "<!DOCTYPE html><p>Rich</p>",
    });
    expect(sendMail.mock.calls[0][0].from).toBe('"Debtor Recovery" <sender@example.com>');
  });

  it("without an html body it still sends the previous escaped-paragraph fallback", async () => {
    await gmailSmtp.send({ ...input, body: "a <b> & c" });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ text: "a <b> & c", html: "<p>a &lt;b&gt; &amp; c</p>" });
  });

  it("failure handling is unchanged: a rejected recipient is a permanent failure, not a success", async () => {
    sendMail.mockResolvedValue({ messageId: "<id@mail>", rejected: ["debtor@example.com"] });
    const result = await gmailSmtp.send({ ...input, html: "<p>x</p>" });
    expect(result.outcome).toBe("permanent_failure");
    expect(result.errorCode).toBe("SMTP_RECIPIENT_REJECTED");
  });
});
