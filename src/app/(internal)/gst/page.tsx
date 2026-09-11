import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { CASES, getDebtor, getOrg } from "@/lib/mock-data";
import { formatInr } from "@/lib/utils";

export const metadata = { title: "Portal runs — Debtrecover" };

export default function GstIndexPage() {
  const rows = CASES.filter(
    (c) => c.eligibilityRoute === "gst" || c.status.startsWith("gst"),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Portal runs — GST"
        description="Cases on the GST communication route. Open one to prepare and file an assisted portal session."
      />
      {rows.length === 0 ? (
        <EmptyState title="No cases on the GST route right now" />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">{getDebtor(c.debtorId)?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {getOrg(c.organisationId)?.legalEntityName} &middot;{" "}
                    {formatInr(c.principalOutstanding)}
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
