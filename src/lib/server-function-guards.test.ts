/**
 * Read-boundary regression tests. These run the REAL server-function
 * handlers (createServerFn is stubbed to hand back the bare handler) with
 * the REAL session/authorization code (tanstack-session + context.ts) over a
 * fake Supabase auth client and the in-memory repository, so what is proven
 * is the actual ordering: the role guard fails BEFORE any repository is even
 * obtained -- not that a page hides a control.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Scenario = {
  user: { id: string } | null;
  appUser: { role: "staff" | "admin" | "client"; email: string | null; display_name: string } | null;
  orgIds: string[];
  cookies: Record<string, string>;
  request: object;
  getUserCalls: number;
};
const scenario: Scenario = { user: null, appUser: null, orgIds: [], cookies: {}, request: {}, getUserCalls: 0 };

vi.mock("@tanstack/react-start/server", () => ({
  getCookies: () => scenario.cookies,
  getRequest: () => scenario.request,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {};
    chain.validator = () => chain;
    chain.middleware = () => chain;
    chain.handler = (fn: unknown) => fn;
    return chain;
  },
}));

vi.mock("@/lib/supabase/tanstack-server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        scenario.getUserCalls += 1;
        return { data: { user: scenario.user }, error: scenario.user ? null : new Error("session_not_found") };
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "app_users" ? scenario.appUser : null }),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: scenario.orgIds.map((organisation_id) => ({ organisation_id })) }),
        }),
      }),
    }),
  }),
}));

import { MemoryRepository } from "@/server/repositories/memory";
const repo = new MemoryRepository();
const getRepo = vi.fn(async () => repo);
vi.mock("@/server/repo.tanstack", () => ({ getRepo: () => getRepo() }));

import { getAuditData } from "./audit.functions";
import { getCasesListData } from "./cases.functions";
import { getCaseDetailData } from "./case-detail.functions";
import { getClientsPolicyData, getNewClientPageAccess } from "./clients.functions";
import { getCommunicationsData } from "./communications.functions";
import { getDashboardData } from "./dashboard.functions";
import { getGstDetailData } from "./gst-detail.functions";
import { getGstListData } from "./gst-list.functions";
import { getIntakeData } from "./intake.functions";
import { getMsmeDetailData } from "./msme-detail.functions";
import { getMsmeListData } from "./msme-list.functions";
import { getPaymentsPageData } from "./payments-page.functions";
import { getTodayData } from "./today.functions";
import { getClientCasesData, getClientOverviewData } from "./client-portal.functions";
import { getClientShellData } from "./auth/tanstack-client-shell.functions";
import { getInternalShellData } from "./auth/tanstack-shell.functions";
import { getLandingRedirect } from "./root-landing.functions";

const call = (fn: unknown, arg?: unknown) => (fn as (a?: unknown) => Promise<unknown>)(arg);

const SESSION_COOKIES = { "sb-projectref-auth-token": "opaque" };
const asStaff = () => Object.assign(scenario, { user: { id: "s1" }, appUser: { role: "staff", email: "s@x.in", display_name: "Staff" }, orgIds: [], cookies: SESSION_COOKIES, request: {} });
const asAdmin = () => Object.assign(scenario, { user: { id: "a1" }, appUser: { role: "admin", email: "a@x.in", display_name: "Admin" }, orgIds: [], cookies: SESSION_COOKIES, request: {} });
const asClient = (orgId: string) => Object.assign(scenario, { user: { id: "c1" }, appUser: { role: "client", email: null, display_name: "Client" }, orgIds: [orgId], cookies: SESSION_COOKIES, request: {} });
const asNobody = () => Object.assign(scenario, { user: null, appUser: null, orgIds: [], cookies: {}, request: {} });
/** A logged-out user replaying an old cookie: the cookie is present but Auth says the session is gone. */
const asRevoked = () => Object.assign(scenario, { user: null, appUser: null, orgIds: [], cookies: SESSION_COOKIES, request: {} });
/** Authenticated with Supabase (public sign-up) but never provisioned as an app user. */
const asUnprovisioned = () => Object.assign(scenario, { user: { id: "u9" }, appUser: null, orgIds: [], cookies: SESSION_COOKIES, request: {} });

let orgA: string;
let orgB: string;
let ownCaseId: string;
let otherCaseId: string;

beforeEach(async () => {
  vi.unstubAllEnvs();
  scenario.request = {}; // a fresh request per test (the auth memo is per request)
  scenario.getUserCalls = 0;
  getRepo.mockClear();
  const orgs = await repo.listOrganisations();
  [orgA, orgB] = [orgs[0].id, orgs[1].id];
  ownCaseId = (await repo.listCasesForOrg(orgA))[0].id;
  otherCaseId = (await repo.listCasesForOrg(orgB))[0].id;
});

const INTERNAL_READS: Array<[string, () => Promise<unknown>]> = [
  ["getAuditData", () => call(getAuditData)],
  ["getCasesListData", () => call(getCasesListData)],
  ["getCommunicationsData", () => call(getCommunicationsData)],
  ["getDashboardData", () => call(getDashboardData)],
  ["getIntakeData", () => call(getIntakeData)],
  ["getTodayData", () => call(getTodayData)],
  ["getGstListData", () => call(getGstListData)],
  ["getMsmeListData", () => call(getMsmeListData)],
  ["getPaymentsPageData", () => call(getPaymentsPageData)],
  ["getClientsPolicyData", () => call(getClientsPolicyData)],
  ["getCaseDetailData (own-org id)", () => call(getCaseDetailData, { data: { id: ownCaseId } })],
  ["getCaseDetailData (other-org id)", () => call(getCaseDetailData, { data: { id: otherCaseId } })],
  ["getGstDetailData (own-org id)", () => call(getGstDetailData, { data: { caseId: ownCaseId } })],
  ["getMsmeDetailData (own-org id)", () => call(getMsmeDetailData, { data: { caseId: ownCaseId } })],
];

describe("internal read server functions", () => {
  describe.each(INTERNAL_READS)("%s", (_name, run) => {
    it("works for staff", async () => {
      asStaff();
      await expect(run()).resolves.toBeDefined();
      expect(getRepo).toHaveBeenCalled();
    });

    it("works for admin", async () => {
      asAdmin();
      await expect(run()).resolves.toBeDefined();
      expect(getRepo).toHaveBeenCalled();
    });

    it("rejects a client session before any data is loaded (dev and production)", async () => {
      asClient(orgA);
      await expect(run()).rejects.toThrow("Staff/admin session required");
      vi.stubEnv("NODE_ENV", "production");
      await expect(run()).rejects.toThrow("Staff/admin session required");
      expect(getRepo).not.toHaveBeenCalled();
    });

    it("fails closed with no session in production, before any data is loaded", async () => {
      asNobody();
      vi.stubEnv("NODE_ENV", "production");
      await expect(run()).rejects.toThrow("Authentication required");
      expect(getRepo).not.toHaveBeenCalled();
    });
  });

  it("keeps the documented non-production demo fallback when there is no session", async () => {
    asNobody();
    await expect(call(getDashboardData)).resolves.toBeDefined();
  });

  it("still tells staff vs admin apart for the render-only admin flag", async () => {
    asStaff();
    expect((await call(getClientsPolicyData) as { isAdmin: boolean }).isAdmin).toBe(false);
    asAdmin();
    expect((await call(getClientsPolicyData) as { isAdmin: boolean }).isAdmin).toBe(true);
  });

  it("does not let a client reach the audit feed (staff reasons / staff user ids)", async () => {
    asClient(orgA);
    await expect(call(getAuditData)).rejects.toThrow();
    asStaff();
    const audit = (await call(getAuditData)) as { entries: unknown[] };
    expect(Array.isArray(audit.entries)).toBe(true);
  });
});

const CLIENT_CASE_KEYS = ["closed", "debtorName", "id", "principalOutstanding", "recoveredToDate", "reference", "stage"];
const OVERVIEW_KEYS = ["actionsRequired", "ageing", "feeSummary", "recovered", "recoveryRatePct", "totalOutstanding", "upcomingAction"];
const INTERNAL_KEYS = ["nextScheduledAction", "currentStep", "blocker", "assigneeId", "automationMode", "waitingOn", "eligibilityRoute", "debtorId", "organisationId", "clientCode", "creditorGstin", "udyamNumber", "jitoMember", "upiId", "orgId", "stageWise"];

describe("client-safe read server functions", () => {
  it("getClientCasesData returns only the session organisation's cases with approved fields", async () => {
    asClient(orgA);
    const res = (await call(getClientCasesData)) as { org: Record<string, unknown>; cases: Array<Record<string, unknown>> };
    expect(Object.keys(res.org)).toEqual(["legalEntityName"]);
    expect(res.cases.length).toBeGreaterThan(0);
    for (const c of res.cases) expect(Object.keys(c).sort()).toEqual(CLIENT_CASE_KEYS);
    const ownIds = new Set((await repo.listCasesForOrg(orgA)).map((c) => c.id));
    expect(res.cases.every((c) => ownIds.has(c.id as string))).toBe(true);
    expect(JSON.stringify(res)).not.toContain(otherCaseId);
    for (const k of INTERNAL_KEYS) expect(JSON.stringify(res)).not.toContain(`"${k}"`);
  });

  it("getClientOverviewData exposes only whitelisted overview fields and no organisation metadata", async () => {
    asClient(orgA);
    const res = (await call(getClientOverviewData)) as {
      org: Record<string, unknown>;
      overview: Record<string, unknown>;
      cases: Array<Record<string, unknown>>;
    };
    expect(Object.keys(res.org)).toEqual(["legalEntityName"]);
    expect(Object.keys(res.overview).sort()).toEqual(OVERVIEW_KEYS);
    expect(Object.keys(res.overview.feeSummary as object)).toEqual(["estimatedFee"]);
    for (const c of res.cases) expect(Object.keys(c).sort()).toEqual(CLIENT_CASE_KEYS);
    expect(JSON.stringify(res)).not.toContain(otherCaseId);
    for (const k of INTERNAL_KEYS) expect(JSON.stringify(res)).not.toContain(`"${k}"`);
  });

  it("scopes to the session organisation, never a caller-supplied one", async () => {
    asClient(orgB);
    const res = (await call(getClientCasesData)) as { cases: Array<{ id: string }> };
    const bIds = new Set((await repo.listCasesForOrg(orgB)).map((c) => c.id));
    expect(res.cases.length).toBeGreaterThan(0);
    expect(res.cases.every((c) => bIds.has(c.id))).toBe(true);
    expect(res.cases.some((c) => c.id === ownCaseId)).toBe(false);
  });

  it("fails closed in production for no session and for staff/admin sessions", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const who of [asNobody, asStaff, asAdmin]) {
      who();
      getRepo.mockClear();
      await expect(call(getClientCasesData)).rejects.toThrow();
      await expect(call(getClientOverviewData)).rejects.toThrow();
    }
  });

  it("client shell sends only id + display name for the client's own organisations", async () => {
    asClient(orgA);
    const res = (await call(getClientShellData)) as { kind: string; organisations: Array<Record<string, unknown>> };
    expect(res.kind).toBe("ok");
    expect(res.organisations).toHaveLength(1);
    expect(Object.keys(res.organisations[0]).sort()).toEqual(["id", "legalEntityName"]);
    expect(res.organisations[0].id).toBe(orgA);
  });

  it("surface guards: client is redirected off the internal shell before any data, staff off the client shell", async () => {
    asClient(orgA);
    getRepo.mockClear();
    expect(await call(getInternalShellData)).toEqual({ kind: "redirect", to: "/client" });
    expect(getRepo).not.toHaveBeenCalled();
    asStaff();
    expect(await call(getClientShellData)).toEqual({ kind: "redirect", to: "/dashboard" });
    vi.stubEnv("NODE_ENV", "production");
    asNobody();
    expect(await call(getInternalShellData)).toEqual({ kind: "redirect", to: "/sign-in" });
    expect(await call(getClientShellData)).toEqual({ kind: "redirect", to: "/sign-in" });
  });

  it("shared-safe reads reveal no data to a client", async () => {
    asClient(orgA);
    getRepo.mockClear();
    expect(await call(getLandingRedirect)).toEqual({ to: "/client" });
    expect(await call(getNewClientPageAccess)).toEqual({ isAdmin: false });
    expect(getRepo).not.toHaveBeenCalled();
  });
});

describe("revoked / unprovisioned sessions fail closed (every environment)", () => {
  const revokedCases: Array<[string, () => Promise<unknown>]> = [
    ...INTERNAL_READS,
    ["getClientCasesData", () => call(getClientCasesData)],
    ["getClientOverviewData", () => call(getClientOverviewData)],
  ];

  describe.each(revokedCases)("%s", (_name, run) => {
    it.each([
      ["development", "development"],
      ["production", "production"],
    ])("rejects a replayed revoked cookie in %s before any data is loaded", async (_l, env) => {
      asRevoked();
      vi.stubEnv("NODE_ENV", env);
      await expect(run()).rejects.toThrow(/Authentication required|Client session required/);
      expect(getRepo).not.toHaveBeenCalled();
    });

    it("rejects an authenticated-but-unprovisioned user (public sign-up account)", async () => {
      asUnprovisioned();
      vi.stubEnv("NODE_ENV", "production");
      await expect(run()).rejects.toThrow(/Authentication required|Client session required/);
      expect(getRepo).not.toHaveBeenCalled();
    });
  });

  it("does not offer the demo actor against real Supabase data, even with no session in development", async () => {
    asNobody();
    vi.stubEnv("DATA_PROFILE", "supabase");
    await expect(call(getDashboardData)).rejects.toThrow("Authentication required");
    await expect(call(getClientCasesData)).rejects.toThrow("Client session required");
    expect(getRepo).not.toHaveBeenCalled();
  });

  it("never lets a presented-but-invalid session degrade to the demo actor on demo data", async () => {
    asRevoked();
    await expect(call(getDashboardData)).rejects.toThrow("Authentication required");
  });

  it("does not let a staff session act as a client in development either", async () => {
    asStaff();
    await expect(call(getClientCasesData)).rejects.toThrow("Client session required");
  });

  it("surface guards send a revoked or session-less request to /sign-in in every environment", async () => {
    asRevoked();
    expect(await call(getInternalShellData)).toEqual({ kind: "redirect", to: "/sign-in" });
    expect(await call(getClientShellData)).toEqual({ kind: "redirect", to: "/sign-in" });
    expect(await call(getLandingRedirect)).toEqual({ to: "/sign-in" });
    expect(await call(getNewClientPageAccess)).toEqual({ isAdmin: false });
    expect(getRepo).not.toHaveBeenCalled();
  });
});

describe("request-scoped session validation", () => {
  it("validates the session once per request, however many guarded reads it makes", async () => {
    asStaff();
    await call(getDashboardData);
    await call(getCasesListData);
    await call(getTodayData);
    expect(scenario.getUserCalls).toBe(1);
  });

  it("re-validates on every new request -- nothing is cached across requests", async () => {
    asStaff();
    await call(getDashboardData);
    scenario.request = {}; // next HTTP request
    await call(getDashboardData);
    expect(scenario.getUserCalls).toBe(2);
  });

  it("a session revoked between two requests is caught by the second request", async () => {
    asStaff();
    await expect(call(getDashboardData)).resolves.toBeDefined();
    scenario.request = {};
    Object.assign(scenario, { user: null, appUser: null }); // logout elsewhere: cookie replayed
    vi.stubEnv("NODE_ENV", "production");
    await expect(call(getDashboardData)).rejects.toThrow("Authentication required");
  });
});
