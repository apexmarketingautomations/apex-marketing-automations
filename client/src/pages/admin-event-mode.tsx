import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface Fulfillment {
  id: number;
  email: string;
  fullName: string;
  status: string;
  paymentMethodValidated: boolean;
  isHotLead: boolean;
  digitalCardSlug: string | null;
  programmedAt: string | null;
  trialEndsAt: string | null;
  createdAt: string;
}
interface Campaign {
  id: number;
  slug: string;
  name: string;
  total: number;
  totalInventory: number;
  remainingInventory: number;
}

export default function AdminEventMode() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = (user as any)?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate("/");
    }
  }, [authLoading, isAdmin, navigate]);

  useEffect(() => { document.title = "Event Mode — Apex"; }, []);

  const { data, isLoading } = useQuery<{ campaign: Campaign | null; signups: Fulfillment[] }>({
    queryKey: ["/api/event/admin/signups"],
    queryFn: async () => (await apiRequest("GET", "/api/event/admin/signups")).json(),
    refetchInterval: 5000,
    enabled: isAdmin,
  });

  const programMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/event/admin/fulfillment/${id}/programmed`, {})).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/event/admin/signups"] }),
  });
  const deliveredMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/event/admin/fulfillment/${id}/delivered`, {})).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/event/admin/signups"] }),
  });
  const hotMut = useMutation({
    mutationFn: async ({ id, isHotLead }: { id: number; isHotLead: boolean }) =>
      (await apiRequest("POST", `/api/event/admin/fulfillment/${id}/hot`, { isHotLead })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/event/admin/signups"] }),
  });

  if (isLoading) return <div className="p-6">Loading event mode…</div>;
  const campaign = data?.campaign;
  const signups = data?.signups || [];
  const hotCount = signups.filter(s => s.isHotLead).length;

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="max-w-3xl mx-auto">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 text-center">
            <div className="text-[10px] uppercase tracking-widest text-cyan-400">Inventory</div>
            <div className="text-3xl font-black" data-testid="text-inventory-count">
              {campaign ? `${campaign.remainingInventory} / ${campaign.totalInventory}` : "—"}
            </div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 text-center">
            <div className="text-[10px] uppercase tracking-widest text-orange-400">Hot leads</div>
            <div className="text-3xl font-black" data-testid="text-hot-count">{hotCount}</div>
          </div>
        </div>

        <div className="text-xs text-gray-500 mb-2">{campaign?.name} — auto-refresh 5s</div>

        <div className="space-y-2">
          {signups.length === 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center text-gray-400 text-sm">
              No signups yet. Hand out a card and watch this list.
            </div>
          )}
          {signups.map(s => (
            <Row key={s.id} f={s}
              onProgram={() => programMut.mutate(s.id)}
              onDelivered={() => deliveredMut.mutate(s.id)}
              onHot={() => hotMut.mutate({ id: s.id, isHotLead: !s.isHotLead })}
              busy={programMut.isPending || deliveredMut.isPending || hotMut.isPending}
            />
          ))}
        </div>

        <p className="text-[10px] text-gray-600 mt-6 text-center">
          Mark Programmed creates the digital card and assigns the slug. Mark Delivered after the card is in their hand.
        </p>
      </div>
    </div>
  );
}

function Row({ f, onProgram, onDelivered, onHot, busy }: {
  f: Fulfillment;
  onProgram: () => void;
  onDelivered: () => void;
  onHot: () => void;
  busy: boolean;
}) {
  const isPaid = f.paymentMethodValidated;
  const isProgrammed = f.status === "programmed" || f.status === "delivered";
  const isDelivered = f.status === "delivered";
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3" data-testid={`row-fulfillment-${f.id}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate" data-testid={`text-name-${f.id}`}>{f.fullName}</div>
          <div className="text-xs text-gray-500 truncate">{f.email}</div>
        </div>
        <button onClick={onHot} disabled={busy}
          className={`text-2xl ${f.isHotLead ? "" : "grayscale opacity-30"}`}
          data-testid={`button-hot-${f.id}`}
          aria-label="Hot lead toggle">🔥</button>
      </div>

      <div className="flex items-center gap-2 text-xs mb-2">
        <Pill ok={isPaid} label={isPaid ? "Paid validated" : "Card pending"} />
        <Pill ok={isProgrammed} label={isProgrammed ? "Programmed" : "Not programmed"} />
        {isDelivered && <Pill ok label="Delivered" />}
      </div>

      <div className="flex gap-2">
        {!isProgrammed && (
          <button onClick={onProgram} disabled={!isPaid || busy}
            className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 text-black text-sm font-bold rounded-lg"
            data-testid={`button-program-${f.id}`}>
            Mark Programmed
          </button>
        )}
        {isProgrammed && !isDelivered && (
          <button onClick={onDelivered} disabled={busy}
            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-bold rounded-lg"
            data-testid={`button-delivered-${f.id}`}>
            Mark Delivered
          </button>
        )}
        {f.digitalCardSlug && (
          <a href={`/card/${f.digitalCardSlug}`} target="_blank"
            className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg"
            data-testid={`link-card-${f.id}`}>View</a>
        )}
      </div>
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest ${ok ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-500/20 text-gray-400"}`}>
      {label}
    </span>
  );
}
