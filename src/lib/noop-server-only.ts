// SSR-only alias target for the "server-only" package (see vite.config.ts).
// That package's guard only resolves to its harmless no-op when the bundler
// declares the "react-server" condition, which Vite's SSR build doesn't set
// -- without this alias it throws unconditionally, even for genuinely
// server-side code during SSR. This file intentionally does nothing.
export {};
