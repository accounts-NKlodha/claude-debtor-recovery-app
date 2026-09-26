import { describe, expect, it } from "vitest";
import { CLIENT_NOTHING_PENDING_NOTE, clientAttentionNotice } from "./client-notice";

describe("client attention notice (client confirmations deferred for V1)", () => {
  it("is informational and never asks the client to confirm anything", () => {
    for (const n of [1, 2, 7]) {
      const { title, body } = clientAttentionNotice(n);
      expect(`${title} ${body}`).not.toMatch(/need your confirmation|please confirm|confirm these|confirming/i);
      expect(body).toMatch(/recovery team/i);
    }
    expect(CLIENT_NOTHING_PENDING_NOTE).not.toMatch(/confirm/i);
  });
  it("pluralises", () => {
    expect(clientAttentionNotice(1).title).toBe("1 item is being reviewed by your recovery team");
    expect(clientAttentionNotice(3).title).toBe("3 items are being reviewed by your recovery team");
  });
});
