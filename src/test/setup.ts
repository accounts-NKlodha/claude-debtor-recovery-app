import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// The real `server-only` package unconditionally throws when required
// outside Next.js's webpack client/server aliasing (see
// src/app/actions/security.test.ts's original per-file mock of the same
// package). Mocked globally here so any test that transitively imports a
// server-only module (repo.ts, production.ts, email.ts, gmail-smtp.ts, ...)
// -- including via `new MemoryRepository()`, which now pulls in
// src/adapters/index.ts's real Gmail SMTP adapter import -- doesn't need
// its own copy of this boilerplate.
vi.mock("server-only", () => ({}));

afterEach(() => cleanup());
