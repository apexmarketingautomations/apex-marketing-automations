// Runner: npx tsx server/runNimbleSetup.ts
import { setupAllBookingAgents } from "./nimbleAgentSetup.js";
setupAllBookingAgents().catch(err => { console.error(err); process.exit(1); });
