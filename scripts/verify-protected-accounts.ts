import { db } from "../server/db";
import { subAccounts, featureFlags } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";
import { isProtectedAccountId, isMutating, ensureNotProtectedAccount } from "../server/middleware/protectedAccount";

async function verify() {
  console.log("=== Protected Account Sanity Check ===\n");
  let allGood = true;

  const protectedIds = [22, 13];
  const accounts = await db.select({ id: subAccounts.id, name: subAccounts.name, isProtected: subAccounts.isProtected })
    .from(subAccounts)
    .where(inArray(subAccounts.id, protectedIds));

  for (const id of protectedIds) {
    const account = accounts.find(a => a.id === id);
    if (!account) {
      console.log(`  [WARN] Account ${id} not found in database`);
      continue;
    }
    if (account.isProtected) {
      console.log(`  [OK] Account ${id} (${account.name}) is_protected = true`);
    } else {
      console.log(`  [FAIL] Account ${id} (${account.name}) is_protected = false`);
      allGood = false;
    }
  }

  const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.featureName, "meta_messaging_2027"));
  if (flag) {
    console.log(`\n  [OK] Feature flag 'meta_messaging_2027' exists (enabled=${flag.enabled})`);
    if (flag.enabled) {
      console.log(`  [WARN] Feature flag is currently ENABLED - expected OFF for initial deployment`);
    }
  } else {
    console.log(`\n  [FAIL] Feature flag 'meta_messaging_2027' not found`);
    allGood = false;
  }

  console.log("\n--- Write-Block Verification ---");

  for (const id of protectedIds) {
    const isBlocked = await isProtectedAccountId(id);
    if (isBlocked) {
      console.log(`  [OK] isProtectedAccountId(${id}) = true (writes blocked)`);
    } else {
      console.log(`  [FAIL] isProtectedAccountId(${id}) = false (writes NOT blocked)`);
      allGood = false;
    }
  }

  const nonProtectedId = 1;
  const isNonBlocked = await isProtectedAccountId(nonProtectedId);
  if (!isNonBlocked) {
    console.log(`  [OK] isProtectedAccountId(${nonProtectedId}) = false (writes allowed for non-protected)`);
  } else {
    console.log(`  [FAIL] isProtectedAccountId(${nonProtectedId}) = true (incorrectly blocking non-protected)`);
    allGood = false;
  }

  console.log("\n--- isMutating Helper Verification ---");
  const mutatingCases = [
    { method: "POST", url: "/api/test", expected: true },
    { method: "PUT", url: "/api/test", expected: true },
    { method: "DELETE", url: "/api/test", expected: true },
    { method: "GET", url: "/api/test", expected: false },
    { method: "GET", url: "/api/seed-demo/22", expected: true },
  ];
  for (const tc of mutatingCases) {
    const result = isMutating({ method: tc.method, originalUrl: tc.url, url: tc.url } as any);
    const pass = result === tc.expected;
    console.log(`  [${pass ? "OK" : "FAIL"}] ${tc.method} ${tc.url} -> mutating=${result} (expected=${tc.expected})`);
    if (!pass) allGood = false;
  }

  console.log("\n--- Middleware Write-Block Enforcement ---");
  const extractId = (req: any) => req.params?.subAccountId ? parseInt(req.params.subAccountId, 10) : null;
  const guard = ensureNotProtectedAccount(extractId);

  const blocked = await new Promise<{ statusCode: number; body: any }>((resolve) => {
    let statusCode = 200;
    let body: any = null;
    const fakeReq = {
      method: "POST",
      originalUrl: "/api/test/22",
      url: "/api/test/22",
      params: { subAccountId: "22" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {},
      user: { id: "sanity-check", claims: { sub: "sanity-check" } },
    } as any;
    const fakeRes = {
      status(c: number) { statusCode = c; return fakeRes; },
      json(d: any) { body = d; resolve({ statusCode, body }); return fakeRes; },
    } as any;
    guard(fakeReq, fakeRes, () => { resolve({ statusCode: 200, body: null }); });
  });

  if (blocked.statusCode === 403 && blocked.body?.error_code === "sub_account_protected" && blocked.body?.ticketId) {
    console.log(`  [OK] POST to protected account 22 returned 403 with error_code=sub_account_protected, ticketId=${blocked.body.ticketId}`);
  } else {
    console.log(`  [FAIL] Expected 403 + sub_account_protected, got status=${blocked.statusCode} body=${JSON.stringify(blocked.body)}`);
    allGood = false;
  }

  const allowed = await new Promise<{ statusCode: number }>((resolve) => {
    const fakeReq = {
      method: "POST",
      originalUrl: "/api/test/1",
      url: "/api/test/1",
      params: { subAccountId: "1" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {},
      user: { id: "sanity-check", claims: { sub: "sanity-check" } },
    } as any;
    const fakeRes = {
      status(c: number) { return { json() { resolve({ statusCode: c }); return fakeRes; } }; },
    } as any;
    guard(fakeReq, fakeRes, () => { resolve({ statusCode: 200 }); });
  });

  if (allowed.statusCode === 200) {
    console.log(`  [OK] POST to non-protected account 1 passed through (200)`);
  } else {
    console.log(`  [FAIL] Expected pass-through for non-protected account, got status=${allowed.statusCode}`);
    allGood = false;
  }

  console.log(`\n=== Result: ${allGood ? "PASS" : "FAIL"} ===`);
  process.exit(allGood ? 0 : 1);
}

verify().catch(e => { console.error(e); process.exit(1); });
