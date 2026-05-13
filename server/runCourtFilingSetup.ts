// Runner: npx tsx server/runCourtFilingSetup.ts
import { setupAllCourtFilingAgents } from "./courtFilingAgentSetup.js";
setupAllCourtFilingAgents().catch(err => { console.error(err); process.exit(1); });
