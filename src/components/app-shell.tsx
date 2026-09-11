"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  Search,
  PanelLeftClose,
  PanelLeft,
  CalendarClock,
  FolderKanban,
  ScanText,
  MessageSquare,
  Wallet,
  ShieldCheck,
  Gavel,
  Building2,
  ScrollText,
  LayoutDashboard,
  Upload,
  CheckCircle2,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Organisation } from "@/contract/types";

type Surface = "internal" | "client";
type NavItem = { href: string; label: string; Icon: React.ComponentType<{ className?: string }> };

const INTERNAL_NAV: NavItem[] = [
  { href: "/today", label: "Today / Urgent", Icon: CalendarClock },
  { href: "/cases", label: "Cases", Icon: FolderKanban },
  { href: "/intake", label: "Intake / OCR", Icon: ScanText },
  { href: "/communications", label: "Communications", Icon: MessageSquare },
  { href: "/payments", label: "Replies / Payments", Icon: Wallet },
  { href: "/gst", label: "GST portal runs", Icon: ShieldCheck },
  { href: "/msme", label: "MSME ODR / DD / Hearings", Icon: Gavel },
  { href: "/clients", label: "Clients / Policy", Icon: Building2 },
  { href: "/audit", label: "Audit / Security", Icon: ScrollText },
];

const CLIENT_NAV: NavItem[] = [
  { href: "/client", label: "Overview", Icon: LayoutDashboard },
  { href: "/client/cases", label: "Cases", Icon: FolderKanban },
  { href: "/client/upload", label: "Upload", Icon: Upload },
  { href: "/client/confirmations", label: "Confirmations", Icon: CheckCircle2 },
  { href: "/client/statements", label: "Statements / Fees", Icon: FileSpreadsheet },
];

function NavLinks({
  items,
  collapsed,
  counts,
  onNavigate,
}: {
  items: NavItem[];
  collapsed: boolean;
  counts?: Partial<Record<string, number>>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Primary">
      {items.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        const count = counts?.[href];
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="truncate">{label}</span>
                {count ? (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 text-[11px] tabular-nums",
                      active ? "bg-accent-foreground/15" : "bg-muted",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  surface,
  organisations,
  counts,
  children,
}: {
  surface: Surface;
  /** fetched server-side (getRepo().listOrganisations()) and passed down --
   * this client component never imports mock/data-access modules directly. */
  organisations: Organisation[];
  /** nav-item href -> badge count, computed server-side in the layout. */
  counts?: Partial<Record<string, number>>;
  children: React.ReactNode;
}) {
  const items = surface === "internal" ? INTERNAL_NAV : CLIENT_NAV;
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [org, setOrg] = React.useState(organisations[0]);

  return (
    <div className="flex min-h-screen w-full flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-card px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:inline-flex"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>

        <Link href={surface === "internal" ? "/today" : "/client"} className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            D
          </span>
          <span className="text-sm font-semibold tracking-tight hidden sm:inline">Debtrecover</span>
        </Link>

        {surface === "client" && (
          <div className="ml-1">
            <DropdownMenu
              trigger={
                <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="max-w-32 truncate">{org?.legalEntityName ?? "Select client"}</span>
                </span>
              }
              align="start"
            >
              <DropdownMenuLabel>Switch organisation</DropdownMenuLabel>
              {organisations.map((o) => (
                <DropdownMenuItem key={o.id} onClick={() => setOrg(o)}>
                  {o.legalEntityName}
                </DropdownMenuItem>
              ))}
            </DropdownMenu>
          </div>
        )}

        <div className="relative ml-auto hidden w-64 sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search cases, debtors, GSTIN…"
            aria-label="Search"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="ml-auto flex items-center gap-1 sm:ml-2">
          <ThemeToggle />
          <DropdownMenu
            trigger={<Avatar name="Priya Sharma" />}
          >
            <DropdownMenuLabel>Priya Sharma</DropdownMenuLabel>
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden shrink-0 border-r border-border bg-card lg:block",
            collapsed ? "w-14" : "w-60",
          )}
        >
          <div className="sticky top-14">
            <NavLinks items={items} collapsed={collapsed} counts={counts} />
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute left-0 top-0 h-full w-64 border-r border-border bg-card">
              <div className="flex h-14 items-center justify-between border-b border-border px-3">
                <span className="text-sm font-semibold">Menu</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close navigation"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <NavLinks items={items} collapsed={false} counts={counts} onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 bg-background">
          <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
