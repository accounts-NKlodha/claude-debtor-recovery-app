import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { getRepo } from "@/server/repo";
import { formatInr } from "@/lib/utils";

export const metadata = { title: "Portal runs — Debtrecover" };

export default async function GstIndexPage() {
  const repo = getRepo();
  const cases = await repo.listAllCases();
  const eligible = cases.filter((c) => c.eligibilityRoute === "gst" || c.status.startsWith("gst"));
  const rows = await Promise.all(
    eligible.map(async (c) => ({
      c,
      debtor: await repo.getDebtor(c.debtorId),
      org: await repo.getOrg(c.organisationId),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Portal runs · GST communication"
        title="GST assisted notification"
        description="Operator-assisted only — staff completes CAPTCHA and final Send. Open a case to prepare and file."
      />
      {rows.length === 0 ? (
        <EmptyState title="No cases on the GST route right now" />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ c, debtor, org }) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">{debtor?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {org?.legalEntityName} &middot; {formatInr(c.principalOutstanding)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={c.status} />
                  <LinkButton href={`/gst/${c.id}`} variant="primary">
                    Open
                  </LinkButton>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
