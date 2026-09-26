/**
 * Client-facing wording for items that need attention. Client-side payment /
 * contact confirmation is deferred for V1 (the recovery team records and
 * confirms on the client's behalf), so the client is only ever told what is
 * happening and to contact the team -- never asked to confirm something in the
 * portal, which has no way to do it.
 */
export function clientAttentionNotice(count: number): { title: string; body: string } {
  return {
    title: `${count} item${count === 1 ? " is" : "s are"} being reviewed by your recovery team`,
    body: "No action is needed in this portal. If you have questions about a payment or a contact detail, please get in touch with your recovery team.",
  };
}

export const CLIENT_NOTHING_PENDING_NOTE = "We'll keep this page updated as your recovery progresses.";
