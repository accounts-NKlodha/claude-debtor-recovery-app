# Graph Report - Claude-Debtor recovery  (2026-09-11)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 420 nodes · 675 edges · 24 communities (16 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `43dc0702`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 23

## God Nodes (most connected - your core abstractions)
1. `cn()` - 52 edges
2. `react` - 19 edges
3. `compilerOptions` - 16 edges
4. `Database` - 15 edges
5. `scripts` - 15 edges
6. `WaitingOn` - 12 edges
7. `EligibilityRoute` - 10 edges
8. `CaseStatus` - 9 edges
9. `CHANNEL` - 8 edges
10. `AdapterSet` - 8 edges

## Surprising Connections (you probably didn't know these)
- `WorkflowState` --references--> `CaseStatus`  [EXTRACTED]
  src/domain/workflow.ts → src/contract/enums.ts
- `SendMessageInput` --references--> `CHANNEL`  [EXTRACTED]
  src/contract/adapters.ts → src/contract/enums.ts
- `EligibilityAssessment` --references--> `EligibilityRoute`  [EXTRACTED]
  src/domain/eligibility.ts → src/contract/enums.ts
- `WorkflowState` --references--> `EligibilityRoute`  [EXTRACTED]
  src/domain/workflow.ts → src/contract/enums.ts
- `PaymentRecord` --references--> `PaymentKind`  [EXTRACTED]
  src/contract/types.ts → src/contract/enums.ts

## Import Cycles
- None detected.

## Communities (24 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (51): clsx, lucide-react, react, tailwind-merge, @tanstack/react-query, AppShell(), CLIENT_NAV, INTERNAL_NAV (+43 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (53): @supabase/ssr, ADAPTER_OUTCOME, AUTOMATION_MODE, AutomationMode, CASE_STATUS, CaseStatus, CHANNEL, CLIENT_SAFE_LABEL (+45 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (30): AdapterSet, mockSet, mockCalendar, mockGmail, mockGstPortal, mockMsmePortal, mockOcr, mockPaymentGateway (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (39): routes, nextConfig, name, private, version, @axe-core/playwright, class-variance-authority, cross-env (+31 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (20): RFC-4180, zod, BULK_IMPORT_COLUMNS, debtorSchema, flexibleDate, GstComposeInput, gstComposeSchema, gstinSchema (+12 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (21): devDependencies, @axe-core/playwright, cross-env, eslint, eslint-config-next, jsdom, @playwright/test, prettier (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (19): dependencies, class-variance-authority, clsx, date-fns, framer-motion, @hookform/resolvers, lucide-react, nanoid (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (15): scripts, build, build:desktop, desktop:build, desktop:dev, dev, e2e, format (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.20
Nodes (7): Badge(), BadgeProps, Tone, tones, CASE_META, Meta, WAITING_META

### Community 11 - "Community 11"
Cohesion: 0.35
Nodes (9): addCalendarDays(), addHours(), gstTimerDeadline(), isOverdueForAdminEscalation(), istParts(), istWallClockToUtc(), nextSendWindow(), reminderTimerDeadline() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.31
Nodes (8): advance(), gateCheck(), handleReply(), initialState(), partialPayment(), drive(), WorkflowEvent, WorkflowState

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (5): AllocatableInvoice, allocateRecovery(), Allocation, AllocationOutcome, invoices

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 15 - "Community 15"
Cohesion: 0.50
Nodes (3): hooks, Stop, $schema

## Knowledge Gaps
- **192 isolated node(s):** `NavItem`, `Surface`, `ButtonProps`, `Size`, `Variant` (+187 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 226 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Community 0` to `Community 10`, `Community 3`?**
  _High betweenness centrality (0.178) - this node is a cross-community bridge._
- **Why does `vitest` connect `Community 3` to `Community 2`, `Community 4`, `Community 11`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Community 5` to `Community 3`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **What connects `NavItem`, `Surface`, `ButtonProps` to the rest of the system?**
  _192 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.057297297297297295 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06400409626216078 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08078431372549019 - nodes in this community are weakly interconnected._