import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { CASES, getDebtor, getOrg } from "@/lib/mock-data";
import { formatInr } from "@/lib/utils";

export const metadata = { title: "DD / Hearings — Debtrecover" };

export default function MsmeIndexPage() {
  const rows = CASES.filter(
    (c) =>
      c.eligibilityRoute === "msme" ||
      ["msme_odr_filed", "msefc_dd", "hearing_scheduled", "adjourned"].includes(c.status),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="DD / Hearings — MSME ODR"
        description="Cases in MSME ODR / MSEFC. Open one for the seven-stage filing wizard and hearing tracking."
      />
      {rows.length === 0 ? (
        <EmptyState title="No cases in MSME ODR right now" />
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
                  <LinkButton href={`/msme/${c.id}`} variant="primary">
                    Open wizard
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
