import { PageHeader } from "@/components/ui/page-header";
import { SettingsScreen } from "@/components/screens/settings-screen";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Clients / Policy — Debtrecover" };

const PORTAL_RUN_STATUSES = ["gst_eligibility_review", "gst_notification_prepared", "msme_eligibility_review"];

export default async function ClientsPolicyPage() {
  const repo = getRepo();
  const [{ enabled }, cases] = await Promise.all([repo.getAutomationState(), repo.listAllCases()]);
  const preparedCount = cases.filter((c) => c.status === "initial_communication_sent").length;
  const portalRunCount = cases.filter((c) => PORTAL_RUN_STATUSES.includes(c.status)).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Clients & policy"
        title="Automation and safety controls"
        description="Admin only. Every change requires a reason and creates an audit event."
      />
      <SettingsScreen enabled={enabled} preparedCount={preparedCount} portalRunCount={portalRunCount} />
    </div>
  );
}
