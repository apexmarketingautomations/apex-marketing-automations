import { describe, it, expect, afterAll } from "vitest";
import { db } from "../db";
import { storage } from "../storage";
import { apexModuleCoverage, subAccounts } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { seedBaselineCoverageForAccounts } from "../intelligence/productionSeed";

const TEST_MODULE_GROUP = "__test_idempotency_module__";

async function pickAccountId(): Promise<number> {
  const [row] = await db.select({ id: subAccounts.id }).from(subAccounts).limit(1);
  if (!row) throw new Error("No sub_accounts available for test");
  return row.id;
}

async function cleanup(accountId: number) {
  await db
    .delete(apexModuleCoverage)
    .where(and(
      eq(apexModuleCoverage.accountId, accountId),
      eq(apexModuleCoverage.moduleGroup, TEST_MODULE_GROUP),
    ));
}

describe("apex_module_coverage upsert idempotency", () => {
  let accountId: number;

  afterAll(async () => {
    if (accountId !== undefined) {
      await cleanup(accountId);
    }
  });

  it("incrementModuleCoverageCount never produces duplicate rows under repeated calls", async () => {
    accountId = await pickAccountId();
    await cleanup(accountId);

    for (let i = 0; i < 5; i++) {
      await storage.incrementModuleCoverageCount(accountId, TEST_MODULE_GROUP, "test.event");
    }

    const rows = await db
      .select()
      .from(apexModuleCoverage)
      .where(and(
        eq(apexModuleCoverage.accountId, accountId),
        eq(apexModuleCoverage.moduleGroup, TEST_MODULE_GROUP),
      ));

    expect(rows).toHaveLength(1);
    expect(rows[0].eventCount).toBe(5);
    expect(rows[0].lastEventAt).not.toBeNull();
  });

  it("incrementModuleCoverageCount tolerates concurrent calls without unique-constraint failures", async () => {
    accountId = await pickAccountId();
    await cleanup(accountId);

    const N = 10;
    await Promise.all(
      Array.from({ length: N }, () =>
        storage.incrementModuleCoverageCount(accountId, TEST_MODULE_GROUP, "test.event"),
      ),
    );

    const rows = await db
      .select()
      .from(apexModuleCoverage)
      .where(and(
        eq(apexModuleCoverage.accountId, accountId),
        eq(apexModuleCoverage.moduleGroup, TEST_MODULE_GROUP),
      ));

    expect(rows).toHaveLength(1);
    expect(rows[0].eventCount).toBe(N);
  });

  it("upsertModuleCoverage is idempotent on (accountId, moduleGroup)", async () => {
    accountId = await pickAccountId();
    await cleanup(accountId);

    const payload = {
      accountId,
      moduleGroup: TEST_MODULE_GROUP,
      totalEventTypes: 4,
      observedEventTypes: 2,
      eventCount: 7,
      coverageScore: 50,
    };

    await storage.upsertModuleCoverage(payload);
    await storage.upsertModuleCoverage({ ...payload, observedEventTypes: 3, coverageScore: 75 });
    await storage.upsertModuleCoverage({ ...payload, observedEventTypes: 4, coverageScore: 100 });

    const rows = await db
      .select()
      .from(apexModuleCoverage)
      .where(and(
        eq(apexModuleCoverage.accountId, accountId),
        eq(apexModuleCoverage.moduleGroup, TEST_MODULE_GROUP),
      ));

    expect(rows).toHaveLength(1);
    expect(rows[0].observedEventTypes).toBe(4);
    expect(rows[0].coverageScore).toBe(100);
  });

  it("seedBaselineCoverageForAccounts is safe to re-run and never throws on the unique index", async () => {
    await expect(seedBaselineCoverageForAccounts()).resolves.toMatchObject({
      table: "apex_module_coverage",
    });
    await expect(seedBaselineCoverageForAccounts()).resolves.toMatchObject({
      table: "apex_module_coverage",
    });
  });
});
