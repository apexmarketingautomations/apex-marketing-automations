// @ts-nocheck
import type { Request, Response } from "express";

interface SSEClient {
  id: string;
  res: Response;
  subAccountId: number;
  connectedAt: number;
}

const clients: Map<string, SSEClient> = new Map();
let clientCounter = 0;

export function addSSEClient(req: Request, res: Response, subAccountId: number): string {
  const clientId = `sse-${++clientCounter}-${Date.now()}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });

  res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

  const client: SSEClient = { id: clientId, res, subAccountId, connectedAt: Date.now() };
  clients.set(clientId, client);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (err) {
      console.warn("[SSE] caught:", err instanceof Error ? err.message : err);
      clearInterval(heartbeat);
      clients.delete(clientId);
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });

  return clientId;
}

export function broadcastToAccount(subAccountId: number, eventType: string, data: any) {
  const payload = `data: ${JSON.stringify({ type: eventType, ...data })}\n\n`;
  for (const client of clients.values()) {
    if (client.subAccountId === subAccountId) {
      try {
        client.res.write(payload);
      } catch (err) {
        console.warn("[SSE] caught:", err instanceof Error ? err.message : err);
        clients.delete(client.id);
      }
    }
  }
}

export function broadcastNewMessage(subAccountId: number, message: any) {
  broadcastToAccount(subAccountId, "new_message", { message });
}

export function broadcastNewComment(subAccountId: number, comment: any) {
  broadcastToAccount(subAccountId, "new_comment", { comment });
}

export function getSSEClientCount(subAccountId?: number): number {
  if (subAccountId === undefined) return clients.size;
  let count = 0;
  for (const c of clients.values()) {
    if (c.subAccountId === subAccountId) count++;
  }
  return count;
}
