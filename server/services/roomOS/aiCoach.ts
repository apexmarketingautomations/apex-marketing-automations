import { aiChat, isAIConfigured } from "../../aiGateway";
import type { RoomContext } from "./contextBuilder";

const FALLBACK_MESSAGES: Record<string, string[]> = {
  hot: [
    "Keep that energy going!",
    "You're on fire right now!",
    "This room is lit, ride the wave!",
  ],
  warm: [
    "Ask them what they want to see next",
    "Shout out your top tipper by name",
    "Tease the next goal reward",
  ],
  cooling: [
    "Time for a game or challenge",
    "Ask the room a spicy question",
    "Remind them about the goal",
  ],
  dead: [
    "Do a countdown from 10",
    "Change the vibe — try some music",
    "Ask who's lurking and say hi",
    "Flash a smile and ask how everyone's night is going",
  ],
};

export async function getRoomCoachingSuggestion(
  context: RoomContext,
  account: { cbPersonaPrompt?: string | null }
): Promise<string | null> {
  if (context.roomEnergy === "hot" && context.triggerType === "tip") {
    return null;
  }

  if (!isAIConfigured()) {
    const bank = FALLBACK_MESSAGES[context.roomEnergy] || FALLBACK_MESSAGES.dead;
    return bank[Math.floor(Math.random() * bank.length)];
  }

  try {
    const personaNote = account.cbPersonaPrompt
      ? `\nPerformer style notes: ${account.cbPersonaPrompt}`
      : "";

    const systemPrompt = `You are a real-time room coach for a Chaturbate performer. Your job is to suggest the single best chat message the performer should type right now based on the current room state. Keep it under 12 words. Natural, conversational tone. Never be cringe or robotic. Never use emojis. One suggestion only, no quotes.${personaNote}`;

    const userPrompt = `Room state:
- Energy: ${context.roomEnergy}
- Total tokens: ${context.totalTokens}/${context.goalTokens} (${context.goalProgress}%)
- Tips: ${context.tipCount} total, last tip: ${context.lastTipAmount} from ${context.lastTipUser}
- Top tipper: ${context.topTipper} (${context.topTipAmount} tokens)
- Goals completed: ${context.goalCount}
- Session: ${Math.round(context.sessionDurationMs / 60000)} min
- Trigger: ${context.triggerType} from ${context.triggerUser}

Suggest one chat message:`;

    const response = await aiChat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      route: "roomos-coach",
    });

    if (response && response.trim().length > 0 && response.trim().length < 100) {
      return response.trim().replace(/^["']|["']$/g, "");
    }
  } catch (e: any) {
    console.error("[ROOMOS-COACH] AI suggestion failed:", e.message);
  }

  const bank = FALLBACK_MESSAGES[context.roomEnergy] || FALLBACK_MESSAGES.dead;
  return bank[Math.floor(Math.random() * bank.length)];
}
