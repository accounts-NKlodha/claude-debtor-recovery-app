/**
 * Shared API / type contract barrel (api-and-interface-design).
 * Parallel UI and API agents import from "@/contract" only — never reach into
 * sibling modules. Changes here are serialized, not parallelised.
 */
export * from "./enums";
export * from "./types";
export * from "./adapters";
export * from "./schemas";
