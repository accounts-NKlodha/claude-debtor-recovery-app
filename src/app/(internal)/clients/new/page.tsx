import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { NewClientForm } from "@/components/screens/new-client-form";
import { getAuthContext } from "@/lib/auth/session";

export const metadata = { title: "Add client — Debtrecover" };

/**
 * Admin-only page (authorization hardening task #6/#15): onboarding a new
 * client organisation is an Admin operation per the accepted V1 role
 * model. The server action already enforces this independently
 * (authorizeAdminMutation, src/app/actions/organisations.ts) -- this page-
 * level check additionally stops a Staff session from ever rendering the
 * form at all, per "prefer not to render Admin-only controls for Staff".
 * Demo fallback outside production is treated as admin, matching
 * requireAdminContext's own existing demo-bypass behavior.
 */
export default async function NewClientPage() {
  const actor = await getAuthContext();
  const isAdmin = !actor || (actor.kind === "staff" && actor.role === "admin");
  if (!isAdmin) {
    redirect("/clients");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Clients & policy"
        title="Add a new client"
        description="Onboards the client organisation record so cases, invoices and debtors can be scoped to it."
      />
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-warning">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Admin-only</p>
          <p className="text-xs opacity-90">
            Onboarding a new client requires an authenticated admin session in production;
            an ordinary staff session is rejected. Outside production this runs under the
            demo staff/admin fallback.
          </p>
        </div>
      </div>
      <NewClientForm />
    </div>
  );
}
