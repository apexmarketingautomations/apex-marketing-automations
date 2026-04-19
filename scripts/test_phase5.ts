import { sendIntentAlert } from "/home/runner/workspace/server/services/trackingIntent";
import { db } from "/home/runner/workspace/server/db";
import { sql } from "drizzle-orm";

const VID = "abdaeba6-fccb-45f0-87cb-ca7b79860d11";

(async () => {
  await db.execute(sql`UPDATE tracking_visits SET is_high_intent=false, high_intent_at=NULL, high_intent_reason=NULL WHERE visit_id=${VID}`);
  await db.execute(sql`DELETE FROM universal_events WHERE source_record_id=${VID} AND event_type IN ('tracking.high_intent','tracking.followup_queued')`);
  console.log("[reset]");

  const results = await Promise.all([1,2,3,4,5].map(i =>
    sendIntentAlert({
      visitId: VID, contactId: null, cardId: 1, subAccountId: 13,
      reason: "repeat_visit_with_engagement", eventId: `t-${i}`, eventType: "cta_click",
    })
  ));
  console.log("alreadyFlagged map:", results.map(r => r.alreadyFlagged));

  await new Promise(r => setTimeout(r, 1500));

  const evt = await db.execute(sql`
    SELECT event_type, COUNT(*)::int as n FROM universal_events
    WHERE source_record_id=${VID} GROUP BY event_type ORDER BY event_type
  `);
  console.log("universal events:", (evt as any).rows);

  const visit = await db.execute(sql`SELECT is_high_intent, high_intent_reason FROM tracking_visits WHERE visit_id=${VID}`);
  console.log("visit state:", (visit as any).rows[0]);

  process.exit(0);
})();
