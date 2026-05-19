import { describe, expect, test } from "vitest";
import { deriveSeverity, isCrashNature, mapLeeRowsToIncidents } from "../countyCrashFeeds";

describe("countyCrashFeeds (LEE)", () => {
  test("isCrashNature matches typical crash strings", () => {
    expect(isCrashNature("TRAFFIC CRASH")).toBe(true);
    expect(isCrashNature("CRASH W/INJURIES")).toBe(true);
    expect(isCrashNature("Hit and Run")).toBe(true);
    expect(isCrashNature("MEDICAL")).toBe(false);
  });

  test("deriveSeverity promotes injury signals", () => {
    expect(deriveSeverity("CRASH W/INJURIES", "")).toBe("high");
    expect(deriveSeverity("TRAFFIC CRASH", "possible injuries")).toBe("high");
    expect(deriveSeverity("TRAFFIC CRASH", "minor fender bender")).toBe("medium");
  });

  test("mapLeeRowsToIncidents filters and normalizes", () => {
    const rows: any[] = [
      { id: 123, nature: "MEDICAL", address: "1 A St", city: "Cape Coral", date: "2026-05-19 10:11:12", remarks: "" },
      { id: "  ", nature: "TRAFFIC CRASH", address: "2 B St", city: "Fort Myers", date: "2026-05-19 10:11:12", remarks: "" },
      { id: "abc", nature: "TRAFFIC CRASH", address: "  ", city: "Fort Myers", date: "2026-05-19 10:11:12", remarks: "" },
      { id: 456, nature: "TRAFFIC CRASH W/INJURIES", address: "3 C St", city: "Fort Myers", date: " 2026-05-19 10:11:12 ", remarks: "INJURY" },
    ];

    const incidents = mapLeeRowsToIncidents(rows as any);
    expect(incidents.length).toBe(1);
    expect(incidents[0].id).toBe("456");
    expect(incidents[0].county).toBe("LEE");
    expect(incidents[0].source).toBe("lcso_cad");
    expect(incidents[0].received).toBe("2026-05-19 10:11:12");
    expect(incidents[0].severity).toBe("high");
    expect(incidents[0].location).toContain("LEE County, FL");
  });
});

