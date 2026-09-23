/**
 * TanStack Start adapter for src/components/app-shell.tsx. Navigation
 * targets/labels and the sign-out flow match the Next.js original; only
 * `next/link` -> TanStack <Link>, `usePathname` -> useLocation, and
 * signOutAction -> signOutFn (followed by a client-side navigate to
 * /sign-in, since a TanStack server function can't redirect across the RPC
 * boundary the way a Next Server Action does).
 */
import * as React from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
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
  CircleAlert,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutFn } from "@/lib/auth/tanstack-actions";
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
type NavSection = { heading?: string; items: NavItem[] };

const INTERNAL_NAV: NavSection[] = [
  {
    heading: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { href: "/today", label: "Today / Urgent", Icon: CalendarClock },
    ],
  },
  {
    heading: "Recovery",
    items: [
      { href: "/cases", label: "Cases", Icon: FolderKanban },
      { href: "/intake", label: "Intake / OCR", Icon: ScanText },
      { href: "/communications", label: "Communications", Icon: MessageSquare },
      { href: "/payments", label: "Replies / Payments", Icon: Wallet },
    ],
  },
  {
    heading: "Escalation",
    items: [
      { href: "/gst", label: "GST portal runs", Icon: ShieldCheck },
      { href: "/msme", label: "MSME ODR / DD / Hearings", Icon: Gavel },
    ],
  },
  {
    heading: "Administration",
    items: [
      { href: "/clients", label: "Clients / Policy", Icon: Building2 },
      { href: "/audit", label: "Audit / Security", Icon: ScrollText },
    ],
  },
];

const CLIENT_NAV: NavSection[] = [
  {
    items: [
      { href: "/client", label: "Overview", Icon: LayoutDashboard },
      { href: "/client/cases", label: "Cases", Icon: FolderKanban },
      { href: "/client/upload", label: "Upload", Icon: Upload },
      { href: "/client/confirmations", label: "Confirmations", Icon: CheckCircle2 },
      { href: "/client/statements", label: "Statements / Fees", Icon: FileSpreadsheet },
    ],
  },
];

// "/client" must not light up for "/client/cases" -- it's the surface root.
const ROOT_HREFS = new Set(["/client"]);

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  return !ROOT_HREFS.has(href) && pathname.startsWith(href + "/");
}

function NavLinks({
  sections,
  collapsed,
  counts,
  onNavigate,
}: {
  sections: NavSection[];
  collapsed: boolean;
  counts?: Partial<Record<string, number>>;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-col gap-4 px-2 py-3" aria-label="Primary">
      {sections.map((section, si) => (
        <div key={section.heading ?? si} className="flex flex-col gap-0.5">
          {section.heading && !collapsed ? (
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              {section.heading}
            </p>
          ) : null}
          {section.heading && collapsed && si > 0 ? (
            <div className="mx-2 mb-1 h-px bg-border" aria-hidden="true" />
          ) : null}
          {section.items.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            const count = counts?.[href];
            return (
              <Link
                key={href}
                to={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
                title={collapsed ? label : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  collapsed && "justify-center px-0 py-2",
                )}
              >
                {active ? (
                  <span aria-hidden="true" className="absolute inset-y-1.5 -left-2 w-0.5 rounded-full bg-primary" />
                ) : null}
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                {!collapsed && (
                  <>
                    <span className="truncate">{label}</span>
                    {count ? (
                      <span
                        className={cn(
                          "ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums",
                          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        )}
                        aria-label={`${count} open`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

const ROLE_LABEL: Record<string, string> = { staff: "Staff", admin: "Admin", client: "Client" };

export function AppShell({
  surface,
  organisations,
  counts,
  user,
  children,
}: {
  surface: Surface;
  organisations: Organisation[];
  counts?: Partial<Record<string, number>>;
  user: { displayName: string; email: string | null; role: string };
  children: React.ReactNode;
}) {
  const sections = surface === "internal" ? INTERNAL_NAV : CLIENT_NAV;
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [org, setOrg] = React.useState(organisations[0]);
  const [signingOut, setSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState(false);
  const closeDrawerRef = React.useRef<HTMLButtonElement>(null);

  const handleSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    void signOutFn()
      .then(() => navigate({ to: "/sign-in", search: { error: undefined } }))
      .catch(() => {
        // Stay put (the session may still be live) but say so, rather than
        // silently resetting the menu item.
        setSigningOut(false);
        setSignOutError(true);
      });
  };

  React.useEffect(() => {
    if (!mobileOpen) return;
    closeDrawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const roleLabel = ROLE_LABEL[user.role] ?? user.role;

  return (
    <div className="flex min-h-screen w-full flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-2 focus:outline-ring"
      >
        Skip to main content
      </a>

      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-card/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
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

        <Link
          to={surface === "internal" ? "/dashboard" : "/client"}
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground shadow-xs">
            D
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-semibold tracking-tight">Debtrecover</span>
            <span className="text-[11px] text-muted-foreground">
              {surface === "internal" ? "N K Lodha & Co · Recovery desk" : "Client portal"}
            </span>
          </span>
        </Link>

        {surface === "client" && (
          <div className="ml-1">
            <DropdownMenu
              triggerLabel="Switch organisation"
              trigger={
                <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs font-medium shadow-xs">
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

        <div className="relative ml-auto hidden w-72 md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search cases, debtors, GSTIN…"
            aria-label="Search"
            className="h-8 bg-muted/60 pl-8 text-xs shadow-none"
          />
        </div>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <ThemeToggle />
          <DropdownMenu triggerLabel={`Account menu for ${user.displayName}`} trigger={<Avatar name={user.displayName} />}>
            <DropdownMenuLabel>
              <span className="block text-sm font-medium text-foreground">{user.displayName}</span>
              {user.email ? (
                <span className="block truncate text-[11px] font-normal text-muted-foreground">{user.email}</span>
              ) : null}
              <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {roleLabel}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} disabled={signingOut}>
              <LogOut className="h-3.5 w-3.5" />
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </header>

      {signOutError ? (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-danger/30 bg-danger-bg px-4 py-2 text-sm text-danger"
        >
          <CircleAlert className="h-4 w-4 shrink-0" />
          <span className="flex-1">Sign-out could not be completed. You are still signed in — please try again.</span>
          <button
            type="button"
            onClick={() => setSignOutError(false)}
            className="rounded px-2 py-0.5 text-xs font-medium hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden shrink-0 border-r border-border bg-sidebar transition-[width] lg:block",
            collapsed ? "w-14" : "w-64",
          )}
        >
          <div className="sticky top-14 flex h-[calc(100vh-3.5rem)] flex-col overflow-y-auto">
            <NavLinks sections={sections} collapsed={collapsed} counts={counts} />
            {!collapsed ? (
              <div className="mt-auto border-t border-border px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={user.displayName} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{user.displayName}</p>
                    <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
            <div className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-sidebar shadow-xl">
              <div className="flex h-14 items-center justify-between border-b border-border px-3">
                <span className="text-sm font-semibold">Debtrecover</span>
                <Button
                  ref={closeDrawerRef}
                  variant="ghost"
                  size="icon"
                  aria-label="Close navigation"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NavLinks sections={sections} collapsed={false} counts={counts} onNavigate={() => setMobileOpen(false)} />
              </div>
            </div>
          </div>
        )}

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 bg-background focus:outline-none">
          <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
