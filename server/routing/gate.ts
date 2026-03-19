import { resolveSubAccount, isRoutingFailure } from "./resolver";
import { persistRoutingFailure } from "./failureQueue";

export interface GateContext {
  subAccountId?: number;
  source?: string;
  channel?: string;
  phone?: string;
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
  resolvedSubAccountId?: number;
}

export async function validateRouting(ctx: GateContext): Promise<GateResult> {
  const { subAccountId, source, channel, phone } = ctx;

  if (!channel) {
    const reason = "Routing gate rejected: missing required field 'channel'";
    console.error(`[ROUTING-GATE] ${reason}`, { subAccountId, source, phone });
    return { allowed: false, reason };
  }

  if (!subAccountId) {
    const reason = "Routing gate rejected: missing required field 'subAccountId'";
    console.error(`[ROUTING-GATE] ${reason}`, { channel, source, phone });
    await persistRoutingFailure({ phone, channel, source, reason });
    return { allowed: false, reason };
  }

  const resolution = await resolveSubAccount({
    phone,
    explicitSubAccountId: subAccountId,
    channel,
    source,
  });

  if (isRoutingFailure(resolution)) {
    const reason = `Routing gate rejected: ${resolution.reason}`;
    console.error(`[ROUTING-GATE] ${reason}`, { subAccountId, channel, source, phone });
    await persistRoutingFailure({ phone, channel, source, reason: resolution.reason });
    return { allowed: false, reason };
  }

  if (resolution.subAccountId !== subAccountId) {
    const reason = `Routing gate rejected: declared subAccountId=${subAccountId} does not match resolved subAccountId=${resolution.subAccountId} (via ${resolution.method})`;
    console.error(`[ROUTING-GATE] ${reason}`);
    await persistRoutingFailure({ phone, channel, source, reason });
    return { allowed: false, reason };
  }

  return { allowed: true, resolvedSubAccountId: resolution.subAccountId };
}
