/**
 * Client portal case list (V1): read-only, the session's own organisation
 * only, client-safe stage labels, no internal steps/notes/actions.
 * Authorization is enforced by the parent /client layout route; data is
 * projected server-side by getClientCasesData.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getClientCasesData, type ClientCaseView } from "@/lib/client-portal.functions";
import { cn, formatInr } from "@/lib/utils";

export const Route = createFileRoute("/client/cases")({
  loader: () => getClientCasesData(),
  component: ClientCasesPage,
  head: () => ({ meta: [{ title: "Cases — Debtrecover" }] }),
});

function ClientCasesPage() {
  const { org, cases } = Route.useLoaderData();
  const open = cases.filter((c) => !c.closed);
  const done = cases.filter((c) => c.closed);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={org.legalEntityName} title="Cases" description="Your cases and the current stage of each." />
      {cases.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No cases yet"
          description="Cases appear here once your recovery team has taken them on."
        />
      ) : (
        <>
          <CaseTable title="In progress" rows={open} empty="No cases in progress." />
          {done.length > 0 ? <CaseTable title="Completed" rows={done} /> : null}
        </>
      )}
    </div>
  );
}

function CaseTable({ title, rows, empty }: { title: string; rows: ClientCaseView[]; empty?: string }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-sm font-semibold tracking-tight">
        {title} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Debtor</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Recovered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <span className="block font-medium">{c.debtorName}</span>
                    {c.reference ? (
                      <span className="block text-[11px] text-muted-foreground">Ref. {c.reference}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge tone={c.closed ? "success" : "info"}>{c.stage}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                    {formatInr(c.principalOutstanding)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "hidden whitespace-nowrap text-right tabular-nums sm:table-cell",
                      c.recoveredToDate > 0 ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {formatInr(c.recoveredToDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
