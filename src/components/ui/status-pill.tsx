import * as React from "react";
import {
  Circle,
  CircleCheck,
  CircleAlert,
  TriangleAlert,
  Clock,
  Gavel,
  ShieldCheck,
  Ban,
  Server,
  User,
  Building2,
} from "lucide-react";
import type { CaseStatus, WaitingOn } from "@/contract/enums";
import { Badge, type Tone } from "./badge";

type Meta = { label: string; tone: Tone; Icon: React.ComponentType<{ className?: string }> };

const CASE_META: Record<CaseStatus, Meta> = {
  received: { label: "Received", tone: "neutral", Icon: Circle },
  under_validation: { label: "Under validation", tone: "info", Icon: Clock },
  correction_required: { label: "Correction required", tone: "warning", Icon: CircleAlert },
  active: { label: "Active", tone: "info", Icon: Circle },
  initial_communication_sent: { label: "Initial reminder sent", tone: "info", Icon: Clock },
  contact_update_required: { label: "Contact update required", tone: "warning", Icon: CircleAlert },
  payment_confirmation_required: {
    label: "Payment confirmation required",
    tone: "warning",
    Icon: CircleAlert,
  },
  promise_to_pay: { label: "Promise to pay", tone: "info", Icon: Clock },
  dispute_settlement: { label: "Dispute / settlement", tone: "warning", Icon: TriangleAlert },
  gst_eligibility_review: { label: "GST eligibility review", tone: "info", Icon: Clock },
  gst_notification_prepared: { label: "GST notification prepared", tone: "info", Icon: ShieldCheck },
  gst_notification_filed: { label: "GST notification filed", tone: "primary", Icon: ShieldCheck },
  msme_eligibility_review: { label: "MSME eligibility review", tone: "info", Icon: Clock },
  msme_odr_filed: { label: "MSME ODR filed", tone: "primary", Icon: Gavel },
  msefc_dd: { label: "MSEFC / DD", tone: "primary", Icon: Gavel },
  hearing_scheduled: { label: "Hearing scheduled", tone: "primary", Icon: Gavel },
  adjourned: { label: "Adjourned", tone: "warning", Icon: Clock },
  recovered: { label: "Recovered", tone: "success", Icon: CircleCheck },
  withdrawn: { label: "Withdrawn", tone: "neutral", Icon: Ban },
  closed: { label: "Closed", tone: "neutral", Icon: CircleCheck },
  automation_failed: { label: "Automation failed", tone: "danger", Icon: TriangleAlert },
  archived: { label: "Archived", tone: "neutral", Icon: Circle },
};

const WAITING_META: Record<WaitingOn, Meta> = {
  system: { label: "System", tone: "neutral", Icon: Server },
  client: { label: "Client", tone: "info", Icon: Building2 },
  staff: { label: "Staff", tone: "warning", Icon: User },
  portal: { label: "Portal", tone: "primary", Icon: ShieldCheck },
};

export function StatusPill({ status, className }: { status: CaseStatus; className?: string }) {
  const m = CASE_META[status];
  return (
    <Badge tone={m.tone} className={className} icon={<m.Icon />}>
      {m.label}
    </Badge>
  );
}

export function WaitingOnPill({ value, className }: { value: WaitingOn; className?: string }) {
  const m = WAITING_META[value];
  return (
    <Badge tone={m.tone} className={className} icon={<m.Icon />}>
      Waiting on {m.label.toLowerCase()}
    </Badge>
  );
}

export function caseStatusLabel(status: CaseStatus): string {
  return CASE_META[status].label;
}
