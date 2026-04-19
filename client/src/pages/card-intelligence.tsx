import { useParams } from "wouter";
import { CardIntelligencePanel } from "@/components/intelligence/CardIntelligencePanel";

export default function CardIntelligencePage() {
  const params = useParams<{ id: string }>();
  const cardId = Number(params.id);

  if (!Number.isFinite(cardId) || cardId <= 0) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-white" data-testid="page-card-intelligence-invalid">
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
          Invalid card id.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6" data-testid="page-card-intelligence">
      <CardIntelligencePanel cardId={cardId} />
    </div>
  );
}
