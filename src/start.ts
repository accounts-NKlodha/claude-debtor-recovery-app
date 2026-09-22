import { createStart } from "@tanstack/react-start";

// Minimal bootstrap -- proves the toolchain boots. Security headers, CSRF and
// error-wrapping middleware get added once the foundation is verified working.
export const startInstance = createStart(() => ({}));
