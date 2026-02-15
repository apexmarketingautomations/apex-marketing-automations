import { getUncachableStripeClient } from "./stripeClient";

async function seedCreatorProducts() {
  const stripe = await getUncachableStripeClient();

  const tiers = [
    {
      name: "Basic Access",
      description: "Entry-level subscription for fans",
      price: 999,
      metadata: { tier: "basic", category: "creator" },
    },
    {
      name: "Premium Access",
      description: "Full content access with messaging",
      price: 2500,
      metadata: { tier: "premium", category: "creator" },
    },
    {
      name: "VIP Access",
      description: "Everything unlocked with custom requests",
      price: 5000,
      metadata: { tier: "vip", category: "creator" },
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

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: tier.price,
      currency: "usd",
      recurring: { interval: "month" },
    });

    console.log(`Created: ${tier.name} - ${product.id} / ${price.id}`);
  }

  console.log("Done seeding creator products");
}

seedCreatorProducts().catch(console.error);
