/**
 * Type declarations for the .mjs scanner so tests can import its exports
 * without `// @ts-ignore` or `any` casts.
 */
export interface SecretLogViolation {
  file: string;
  line: number;
  leak: string;
  snippet: string;
}

export interface TaintSets {
  taintedVars: Set<string>;
  taintedFuncs: Set<string>;
}

export function isSecretEnvName(name: string): boolean;
export function buildTaintSets(src: string): TaintSets;
export function expressionLeaks(
  expr: string,
  taintedVars: Set<string>,
  taintedFuncs: Set<string>,
): string | null;
export function enumerateExpressions(args: string): IterableIterator<string>;
export function scanFile(file: string): SecretLogViolation[];
export function listTsFiles(dir: string): string[];
export const SCAN_DIR: string;
export const ROOT: string;
