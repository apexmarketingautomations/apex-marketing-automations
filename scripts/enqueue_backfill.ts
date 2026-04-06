import crypto from "crypto";

const AGENT_WEBHOOK = process.env.AGENT_WEBHOOK || "http://localhost:3001/api/agent/tasks";
const AGENT_SECRET = process.env.AGENT_SECRET;

if (!AGENT_SECRET) {
  console.error("[ENQUEUE] AGENT_SECRET is not set");
  process.exit(1);
}

const subAccountId = parseInt(process.argv[2] || "22", 10);

interface EnqueueBody {
  job_type: string;
  payload: { sub_account_id: number };
  created_by: string;
  sub_account_id: number;
}

const body: EnqueueBody = {
  job_type: "run_backfill_for_subaccount",
  payload: { sub_account_id: subAccountId },
  created_by: "owner@apex",
  sub_account_id: subAccountId,
};

const bodyStr = JSON.stringify(body);
const sig = "sha256=" + crypto.createHmac("sha256", AGENT_SECRET).update(bodyStr).digest("hex");

async function enqueue() {
  console.log(`[ENQUEUE] Submitting backfill job for sub_account ${subAccountId} to ${AGENT_WEBHOOK}`);

  const resp = await fetch(AGENT_WEBHOOK, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-signature": sig,
    },
    body: bodyStr,
  });

  console.log("Status:", resp.status);
  const result = await resp.json();
  console.log("Response:", JSON.stringify(result, null, 2));
}

enqueue().catch((err: unknown) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error("[ENQUEUE] Error:", errMsg);
  process.exit(1);
});
