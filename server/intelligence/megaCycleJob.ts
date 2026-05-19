import { jobQueue } from "../jobQueue";
import { runMegaCycle, type MegaCyclePayload } from "./megaCycle";

let registered = false;

export function registerMegaCycleJobHandler(): void {
  if (registered) return;
  registered = true;
  jobQueue.registerHandler("mega_cycle_tick", async (payload: Record<string, any>) => {
    return runMegaCycle(payload as MegaCyclePayload);
  });
}

