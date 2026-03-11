import { getUncachableStripeClient } from "./stripeClient";

async function seedProducts() {
  const stripe = await getUncachableStripeClient();

  const tiers = [
    {
      name: "Starter AI",
      description: "Complete automation for the solo entrepreneur.",
      metadata: { tier: "starter", category: "subscription" },
      prices: [
        { nickname: "Starter AI Monthly", amount: 9700, interval: "month" as const },
        { nickname: "Starter AI Yearly", amount: 7700, interval: "year" as const },
        { nickname: "Starter AI Blitz", amount: 4800, interval: "month" as const },
      ],
    },
    {
      name: "Agency Pro",
      description: "Build an empire with unlimited sub-accounts.",
      metadata: { tier: "agency_pro", category: "subscription" },
      prices: [
        { nickname: "Agency Pro Monthly", amount: 29700, interval: "month" as const },
        { nickname: "Agency Pro Yearly", amount: 23700, interval: "year" as const },
        { nickname: "Agency Pro Blitz", amount: 14800, interval: "month" as const },
      ],
    },
    {
      name: "God Mode",
      description: "Total White-Label dominance. Zero limits.",
      metadata: { tier: "god_mode", category: "subscription" },
      prices: [
        { nickname: "God Mode Monthly", amount: 49700, interval: "month" as const },
        { nickname: "God Mode Yearly", amount: 39700, interval: "year" as const },
        { nickname: "God Mode Blitz", amount: 24800, interval: "month" as const },
      ],
    },
  ];

  for (const tier of tiers) {
    const existing = await stripe.products.search({ query: `name:'${tier.name}'` });
    if (existing.data.length > 0) {
      console.log(`${tier.name} already exists, skipping`);
      continue;
    }

    const product = await stripe.products.create({
      name: tier.name,
      description: tier.description,
      metadata: tier.metadata,
    });

    for (const p of tier.prices) {
      const price = await stripe.prices.create({
        product: product.id,
        nickname: p.nickname,
        unit_amount: p.amount,
        currency: "usd",
        recurring: { interval: p.interval },
      });
      console.log(`  Price created: ${p.nickname} — ${price.id}`);
    }

    console.log(`Created product: ${tier.name} — ${product.id}`);
  }

  console.log("Done seeding products");
}

seedProducts().catch(console.error);
