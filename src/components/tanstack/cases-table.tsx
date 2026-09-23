/**
 * TanStack Start adapter for src/components/screens/cases-table.tsx --
 * same columns, sorting and filtering; `next/navigation`'s useRouter().push
 * swapped for TanStack Router's useNavigate(). Presentation differs from
 * the Next.js original (responsive column visibility, sort indicators).
 */
"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { flexRender } from "@tanstack/react-table";
import {
  useLegacyTable,
  legacyCreateColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table/legacy";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import type { CaseRow } from "@/lib/mock-data";
import type { CaseStatus, WaitingOn } from "@/contract/enums";
import { CASE_STATUS } from "@/contract/enums";
import { cn, formatInr } from "@/lib/utils";
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
import { ChipFilterRow, type ChipOption } from "@/components/ui/chip-filter";

const BLOCKED_STATUSES: CaseStatus[] = [
  "correction_required",
  "contact_update_required",
  "dispute_settlement",
  "automation_failed",
];

type QuickFilter = "all" | "urgent" | "blocked" | "client" | "portal";

const col = legacyCreateColumnHelper<CaseRow>();

// Per-column cell/header classes. GSTIN, assignee and waiting-on keep their
// own columns (sorting/global filter use them) but only show on very wide
// screens; narrower, each is folded into a neighbouring cell instead.
const COL_CLASS: Record<string, string> = {
  gstin: "hidden 2xl:table-cell",
  value: "text-right",
  assignee: "hidden 2xl:table-cell",
  waitingOn: "hidden 2xl:table-cell",
};

const columns = [
  col.accessor("client", {
    header: "Client",
    cell: (c) => <span className="block min-w-32 max-w-48 font-medium leading-snug">{c.getValue<string>()}</span>,
  }),
  col.accessor("debtor", {
    header: "Debtor",
    cell: (c) => (
      <span className="block min-w-32 max-w-48 leading-snug">
        {c.getValue<string>()}
        <span className="block font-mono text-[11px] text-muted-foreground 2xl:hidden">
          {c.row.original.gstin ?? "No GSTIN"}
        </span>
      </span>
    ),
  }),
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
    cell: (c) => (
      <span className="flex flex-col items-start gap-1">
        <StatusPill status={c.getValue<CaseStatus>()} />
        <WaitingOnPill value={c.row.original.waitingOn} className="2xl:hidden" />
      </span>
    ),
  }),
  col.accessor("nextAction", {
    header: "Next action",
    cell: (c) => (
      <span className="block min-w-36 max-w-56">
        <span className="line-clamp-2 text-xs text-foreground/80" title={c.getValue<string | null>() ?? undefined}>
          {c.getValue<string | null>() ?? "—"}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground 2xl:hidden">{c.row.original.assignee}</span>
      </span>
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
        <span className="whitespace-nowrap text-xs text-muted-foreground">On time</span>
      );
    },
  }),
  col.accessor("value", {
    header: "Value",
    cell: (c) => <span className="whitespace-nowrap font-medium tabular-nums">{formatInr(c.getValue<number>())}</span>,
  }),
  col.accessor("assignee", {
    header: "Assignee",
    cell: (c) => <span className="whitespace-nowrap text-sm">{c.getValue<string>()}</span>,
  }),
  col.accessor("waitingOn", {
    header: "Waiting on",
    cell: (c) => <WaitingOnPill value={c.getValue<WaitingOn>()} />,
    enableSorting: false,
  }),
];

export function CasesTable({ rows }: { rows: CaseRow[] }) {
  const navigate = useNavigate();
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"" | CaseStatus>("");
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all");
  const [sorting, setSorting] = React.useState<{ id: string; desc: boolean }[]>([
    { id: "overdueDays", desc: true },
  ]);

  const quickFiltered = React.useMemo(() => {
    switch (quickFilter) {
      case "urgent":
        return rows.filter((r) => r.overdueDays > 30);
      case "blocked":
        return rows.filter((r) => BLOCKED_STATUSES.includes(r.status));
      case "client":
        return rows.filter((r) => r.waitingOn === "client");
      case "portal":
        return rows.filter((r) => r.waitingOn === "portal");
      default:
        return rows;
    }
  }, [rows, quickFilter]);

  const quickOptions: ChipOption<QuickFilter>[] = [
    { value: "all", label: "All active", count: rows.length },
    { value: "urgent", label: "Urgent", count: rows.filter((r) => r.overdueDays > 30).length },
    { value: "blocked", label: "Blocked", count: rows.filter((r) => BLOCKED_STATUSES.includes(r.status)).length },
    { value: "client", label: "Waiting on client", count: rows.filter((r) => r.waitingOn === "client").length },
    { value: "portal", label: "Waiting on portal", count: rows.filter((r) => r.waitingOn === "portal").length },
  ];

  const data = React.useMemo(
    () => (statusFilter ? quickFiltered.filter((r) => r.status === statusFilter) : quickFiltered),
    [quickFiltered, statusFilter],
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
      <ChipFilterRow
        aria-label="Quick-filter cases"
        options={quickOptions}
        value={quickFilter}
        onChange={setQuickFilter}
      />
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
          className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground shadow-xs"
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
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => {
                    const canSort = h.column.getCanSort();
                    const sorted = h.column.getIsSorted();
                    const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                    return (
                      <TableHead
                        key={h.id}
                        className={COL_CLASS[h.column.id]}
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined}
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                              sorted && "text-foreground",
                            )}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <SortIcon className={cn("h-3 w-3", !sorted && "opacity-50")} />
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
                  className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  tabIndex={0}
                  role="link"
                  aria-label={`Open case for ${r.original.debtor} (${r.original.client})`}
                  onClick={() => navigate({ to: `/cases/${r.original.id}` })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate({ to: `/cases/${r.original.id}` });
                  }}
                >
                  {r.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={COL_CLASS[cell.column.id]}>
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
