"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { flexRender } from "@tanstack/react-table";
import {
  useLegacyTable,
  legacyCreateColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table/legacy";
import { ArrowUpDown, Search } from "lucide-react";
import type { CaseRow } from "@/lib/mock-data";
import type { CaseStatus, WaitingOn } from "@/contract/enums";
import { CASE_STATUS } from "@/contract/enums";
import { formatInr } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill, WaitingOnPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

const col = legacyCreateColumnHelper<CaseRow>();

const columns = [
  col.accessor("client", {
    header: "Client",
    cell: (c) => <span className="font-medium">{c.getValue<string>()}</span>,
  }),
  col.accessor("debtor", { header: "Debtor" }),
  col.accessor("gstin", {
    header: "GSTIN",
    cell: (c) => (
      <span className="font-mono text-xs text-muted-foreground">
        {c.getValue<string | null>() ?? "—"}
      </span>
    ),
    enableSorting: false,
  }),
  col.accessor("status", {
    header: "Status",
    cell: (c) => <StatusPill status={c.getValue<CaseStatus>()} />,
  }),
  col.accessor("nextAction", {
    header: "Next action",
    cell: (c) => (
      <span className="text-xs text-muted-foreground">{c.getValue<string | null>() ?? "—"}</span>
    ),
    enableSorting: false,
  }),
  col.accessor("overdueDays", {
    header: "Overdue",
    cell: (c) => {
      const d = c.getValue<number>();
      return d > 0 ? (
        <Badge tone={d > 60 ? "danger" : "warning"}>{d}d</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">On time</span>
      );
    },
  }),
  col.accessor("value", {
    header: "Value",
    cell: (c) => <span className="tabular-nums">{formatInr(c.getValue<number>())}</span>,
  }),
  col.accessor("assignee", { header: "Assignee" }),
  col.accessor("waitingOn", {
    header: "Waiting on",
    cell: (c) => <WaitingOnPill value={c.getValue<WaitingOn>()} />,
    enableSorting: false,
  }),
];

export function CasesTable({ rows }: { rows: CaseRow[] }) {
  const router = useRouter();
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"" | CaseStatus>("");
  const [sorting, setSorting] = React.useState<{ id: string; desc: boolean }[]>([
    { id: "overdueDays", desc: true },
  ]);

  const data = React.useMemo(
    () => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows),
    [rows, statusFilter],
  );

  const table = useLegacyTable<CaseRow>({
    data,
    state: { sorting, globalFilter },
    onSortingChange: setSorting as never,
    onGlobalFilterChange: setGlobalFilter as never,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // v9-alpha column-helper unions don't collapse to ColumnDef[]; safe at runtime.
    columns: columns as unknown as never,
  });

  const bodyRows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter by client, debtor, GSTIN…"
            aria-label="Filter cases"
            className="pl-8"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | CaseStatus)}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">All statuses</option>
          {CASE_STATUS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {bodyRows.length} of {rows.length} cases
        </span>
      </div>

      {bodyRows.length === 0 ? (
        <EmptyState title="No cases match these filters" description="Clear the search or status filter to see all cases." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => {
                    const canSort = h.column.getCanSort();
                    return (
                      <TableHead key={h.id}>
                        {canSort ? (
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {bodyRows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  role="link"
                  onClick={() => router.push(`/cases/${r.original.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/cases/${r.original.id}`);
                  }}
                >
                  {r.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
