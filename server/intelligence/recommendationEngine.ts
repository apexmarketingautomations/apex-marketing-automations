import { storage } from "../storage";

type RecommendationInput = {
  accountId: number;
  entityType: string;
  entityId: string;
  recommendationType: string;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  whyThisExists: string;
  recommendedAction?: Record<string, unknown>;
  sourceScoreId?: number;
};

async function createIfNotDuplicate(input: RecommendationInput): Promise<void> {
  const existing = await storage.getRecommendations(input.accountId, { status: "pending", limit: 200 });
  const isDupe = existing.some(
    r => r.entityType === input.entityType &&
      r.entityId === input.entityId &&
      r.recommendationType === input.recommendationType
  );
  if (isDupe) return;
  await storage.createRecommendation(input);
}

export async function generateDomainRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const domainScores = await storage.getScoresByType(accountId, "domain_health_score");

  for (const score of domainScores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if (score.scoreValue < 40) {
      if (!inputs.dnsConfigured) {
        await createIfNotDuplicate({
          accountId,
          entityType: "domain",
          entityId: score.entityId,
          recommendationType: "fix_dns",
          priority: "high",
          title: "Configure DNS for your domain",
          description: "Your domain DNS is not configured. Set up CNAME and TXT records to activate it.",
          whyThisExists: `Domain health score is ${score.scoreValue}/100 — DNS not configured`,
          recommendedAction: { action: "navigate", target: "/domains", step: "dns_setup" },
          sourceScoreId: score.id,
        });
        count++;
      }

      if (!inputs.hasSite) {
        await createIfNotDuplicate({
          accountId,
          entityType: "domain",
          entityId: score.entityId,
          recommendationType: "attach_site",
          priority: "medium",
          title: "Attach a website to your domain",
          description: "Your domain has no website linked. Build and attach a site to make it useful.",
          whyThisExists: `Domain health score is ${score.scoreValue}/100 — no site attached`,
          recommendedAction: { action: "navigate", target: "/site-builder" },
          sourceScoreId: score.id,
        });
        count++;
      }

      if (!inputs.sslActive) {
        await createIfNotDuplicate({
          accountId,
          entityType: "domain",
          entityId: score.entityId,
          recommendationType: "activate_ssl",
          priority: "high",
          title: "Activate SSL for your domain",
          description: "Your domain doesn't have SSL active. SSL is required for security and search rankings.",
          whyThisExists: `Domain health score is ${score.scoreValue}/100 — SSL not active`,
          recommendedAction: { action: "navigate", target: "/domains" },
          sourceScoreId: score.id,
        });
        count++;
      }
    }
  }
  return count;
}

export async function generateSiteRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const siteScores = await storage.getScoresByType(accountId, "site_health_score");

  for (const score of siteScores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if (!inputs.isPublished) {
      await createIfNotDuplicate({
        accountId,
        entityType: "site",
        entityId: score.entityId,
        recommendationType: "publish_site",
        priority: "high",
        title: "Publish your website",
        description: "Your site is built but not published. Publish it to make it live and start receiving visitors.",
        whyThisExists: `Site health score is ${score.scoreValue}/100 — site not published`,
        recommendedAction: { action: "navigate", target: `/site-builder/${score.entityId}` },
        sourceScoreId: score.id,
      });
      count++;
    }

    if (!inputs.hasDomain) {
      await createIfNotDuplicate({
        accountId,
        entityType: "site",
        entityId: score.entityId,
        recommendationType: "add_domain",
        priority: "medium",
        title: "Add a custom domain to your site",
        description: "Your site doesn't have a custom domain. Adding one improves credibility and SEO.",
        whyThisExists: `Site health score is ${score.scoreValue}/100 — no custom domain`,
        recommendedAction: { action: "navigate", target: "/domains" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateLeadRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const leadScores = await storage.getScoresByType(accountId, "lead_intent_score");

  for (const score of leadScores) {
    if (score.scoreValue >= 60 && score.scoreBand !== "excellent") {
      await createIfNotDuplicate({
        accountId,
        entityType: "contact",
        entityId: score.entityId,
        recommendationType: "follow_up_high_intent",
        priority: "high",
        title: "Follow up with high-intent lead",
        description: `This contact has a lead intent score of ${score.scoreValue}. They've shown strong interest — follow up now before they go cold.`,
        whyThisExists: `Lead intent score ${score.scoreValue}/100 indicates active engagement`,
        recommendedAction: { action: "navigate", target: "/inbox", contactId: score.entityId },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateIntegrationRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const healthRows = await storage.getIntegrationHealth(accountId);

  for (const health of healthRows) {
    if (health.status === "error" || health.status === "disconnected") {
      await createIfNotDuplicate({
        accountId,
        entityType: "integration",
        entityId: `${health.integrationType}:${health.integrationKey}`,
        recommendationType: "fix_integration",
        priority: "critical",
        title: `Reconnect ${health.integrationType} integration`,
        description: `Your ${health.integrationType} integration (${health.integrationKey}) is ${health.status}. ${health.failureReason || 'Check configuration and reconnect.'}`,
        whyThisExists: `Integration health: ${health.status}, last failure: ${health.lastFailureAt?.toISOString() || 'unknown'}`,
        recommendedAction: { action: "navigate", target: "/integrations" },
      });
      count++;
    }
  }
  return count;
}

export async function generateAccountRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getIntelligenceScores(accountId, "account", String(accountId));

  for (const score of scores) {
    if (score.scoreType === "launch_readiness_score" && score.scoreValue < 50) {
      const inputs = score.inputs as Record<string, unknown> | null;
      if (inputs && !inputs.activeAutomations) {
        await createIfNotDuplicate({
          accountId,
          entityType: "account",
          entityId: String(accountId),
          recommendationType: "create_automation",
          priority: "medium",
          title: "Set up your first automation",
          description: "Automations save you time by handling repetitive tasks. Create a workflow to auto-respond to leads or schedule follow-ups.",
          whyThisExists: `Launch readiness is ${score.scoreValue}/100 — no active automations found`,
          recommendedAction: { action: "navigate", target: "/workflow-builder" },
          sourceScoreId: score.id,
        });
        count++;
      }
    }

    if (score.scoreType === "account_maturity_score" && score.scoreValue < 30) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "complete_setup",
        priority: "high",
        title: "Complete your account setup",
        description: "Your account is still in early stages. Add contacts, build a site, and connect integrations to unlock the platform's full potential.",
        whyThisExists: `Account maturity score is ${score.scoreValue}/100`,
        recommendedAction: { action: "navigate", target: "/onboarding" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateWorkflowRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "workflow_effectiveness_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.totalWorkflows as number) === 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "create_first_workflow",
        priority: "high",
        title: "Create your first automation workflow",
        description: "You have no workflows configured. Workflows automatically respond to leads, follow up on appointments, and nurture contacts — saving hours per week.",
        whyThisExists: `Workflow effectiveness score: ${score.scoreValue}/100 — 0 workflows found`,
        recommendedAction: { action: "navigate", target: "/workflow-builder" },
        sourceScoreId: score.id,
      });
      count++;
    } else if ((inputs.workflowsWithAI as number) === 0 && (inputs.totalWorkflows as number) > 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "add_ai_to_workflow",
        priority: "medium",
        title: "Add AI replies to your workflows",
        description: "Your workflows don't use AI responses yet. AI-powered replies dramatically improve response quality and speed.",
        whyThisExists: `${inputs.totalWorkflows} workflows active but none use AI auto-reply`,
        recommendedAction: { action: "navigate", target: "/workflow-builder" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateCampaignRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "campaign_effectiveness_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.totalCampaigns as number) === 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "create_first_campaign",
        priority: "medium",
        title: "Launch your first email campaign",
        description: "No email campaigns have been created. Email campaigns are one of the highest-ROI marketing channels.",
        whyThisExists: `Campaign effectiveness score: ${score.scoreValue}/100 — no campaigns found`,
        recommendedAction: { action: "navigate", target: "/email-campaigns" },
        sourceScoreId: score.id,
      });
      count++;
    } else if ((inputs.openRate as number) < 15 && (inputs.sentCampaigns as number) > 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "improve_campaign_open_rates",
        priority: "medium",
        title: "Improve email campaign open rates",
        description: `Your campaign open rate is ${inputs.openRate}% (industry average is 20-25%). Test better subject lines and send-time optimization.`,
        whyThisExists: `Open rate: ${inputs.openRate}% on ${inputs.totalSent} emails sent`,
        recommendedAction: { action: "navigate", target: "/email-campaigns" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generatePipelineRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "pipeline_health_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.totalDeals as number) === 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "create_first_deal",
        priority: "medium",
        title: "Add deals to your pipeline",
        description: "Your pipeline is empty. Track deals to measure revenue, conversion rates, and sales velocity.",
        whyThisExists: `Pipeline health score: ${score.scoreValue}/100 — no deals found`,
        recommendedAction: { action: "navigate", target: "/pipeline" },
        sourceScoreId: score.id,
      });
      count++;
    } else if ((inputs.conversionRate as number) < 10 && (inputs.totalDeals as number) > 5) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "improve_pipeline_conversion",
        priority: "high",
        title: "Improve deal conversion rate",
        description: `Your deal conversion rate is ${inputs.conversionRate}% (${inputs.wonDeals} won / ${inputs.totalDeals} total). Consider reviewing your sales process and follow-up strategy.`,
        whyThisExists: `Conversion rate ${inputs.conversionRate}% on ${inputs.totalDeals} deals — below 10% threshold`,
        recommendedAction: { action: "navigate", target: "/pipeline" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateReputationRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "reputation_health_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.totalReviews as number) === 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "collect_first_reviews",
        priority: "high",
        title: "Start collecting customer reviews",
        description: "You have no reviews. Reviews are essential for trust and conversion — activate the review request flow for new customers.",
        whyThisExists: `Reputation health score: ${score.scoreValue}/100 — 0 reviews collected`,
        recommendedAction: { action: "navigate", target: "/reputation" },
        sourceScoreId: score.id,
      });
      count++;
    } else if ((inputs.avgRating as number) < 4.0 && (inputs.totalReviews as number) >= 5) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "improve_review_rating",
        priority: "high",
        title: "Address low review rating",
        description: `Your average rating is ${inputs.avgRating}/5. Respond to negative reviews and implement a feedback-first process before asking for public reviews.`,
        whyThisExists: `Average rating ${inputs.avgRating}/5 on ${inputs.totalReviews} reviews`,
        recommendedAction: { action: "navigate", target: "/reputation" },
        sourceScoreId: score.id,
      });
      count++;
    } else if ((inputs.responseRate as number) < 30 && (inputs.totalReviews as number) > 3) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "respond_to_reviews",
        priority: "medium",
        title: "Respond to customer reviews",
        description: `Only ${inputs.responseRate}% of your reviews have been responded to. Responding to reviews shows you care and improves search rankings.`,
        whyThisExists: `Review response rate: ${inputs.responseRate}% on ${inputs.totalReviews} reviews`,
        recommendedAction: { action: "navigate", target: "/reputation" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateCalendarRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "calendar_conversion_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.totalAppointments as number) === 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "enable_calendar_booking",
        priority: "medium",
        title: "Enable calendar booking",
        description: "No appointments have been scheduled. Embed a booking link in your site and digital card to convert visitors into meetings.",
        whyThisExists: `Calendar conversion score: ${score.scoreValue}/100 — 0 appointments found`,
        recommendedAction: { action: "navigate", target: "/calendar" },
        sourceScoreId: score.id,
      });
      count++;
    } else if ((inputs.cancellationRate as number) > 30 && (inputs.totalAppointments as number) > 5) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "reduce_appointment_cancellations",
        priority: "medium",
        title: "Reduce appointment cancellation rate",
        description: `${inputs.cancellationRate}% of your appointments are cancelled or no-showed. Set up automated reminder workflows to reduce no-shows.`,
        whyThisExists: `Cancellation rate: ${inputs.cancellationRate}% on ${inputs.totalAppointments} appointments`,
        recommendedAction: { action: "navigate", target: "/workflow-builder" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateDigitalCardRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "digital_card_effectiveness_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.totalCards as number) === 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "create_digital_card",
        priority: "medium",
        title: "Create a digital business card",
        description: "You don't have a digital card yet. Digital cards with lead capture are highly effective at converting in-person contacts.",
        whyThisExists: `Digital card effectiveness score: ${score.scoreValue}/100 — no cards found`,
        recommendedAction: { action: "navigate", target: "/digital-card-builder" },
        sourceScoreId: score.id,
      });
      count++;
    } else if (!(inputs.cardsWithLeadCapture as number) && (inputs.totalCards as number) > 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "enable_lead_capture_on_card",
        priority: "medium",
        title: "Enable lead capture on digital cards",
        description: "Your digital cards don't have lead capture enabled. Adding a contact form converts card views into CRM contacts automatically.",
        whyThisExists: `${inputs.totalCards} cards active but none have lead capture enabled`,
        recommendedAction: { action: "navigate", target: "/digital-card-builder" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateAdRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "ad_to_lead_quality_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.activeCampaigns as number) === 0 && (inputs.totalAdCampaigns as number) > 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "activate_ad_campaigns",
        priority: "medium",
        title: "Activate your ad campaigns",
        description: `You have ${inputs.totalAdCampaigns} ad campaign(s) but none are active. Launch them to start generating leads from Meta ads.`,
        whyThisExists: `Ad to lead quality score: ${score.scoreValue}/100 — no active campaigns`,
        recommendedAction: { action: "navigate", target: "/meta-ads" },
        sourceScoreId: score.id,
      });
      count++;
    } else if ((inputs.totalLeads as number) === 0 && (inputs.activeCampaigns as number) > 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "optimize_ad_targeting",
        priority: "medium",
        title: "Optimize ad targeting for lead generation",
        description: "Your ads are running but generating no leads. Review targeting, creative, and landing page to improve conversion.",
        whyThisExists: `Active campaigns with 0 leads captured — potential targeting or creative issue`,
        recommendedAction: { action: "navigate", target: "/meta-ads" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateMessagingRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "messaging_performance_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.responseRate as number) < 40 && (inputs.inbound as number) > 5) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "improve_inbox_response_rate",
        priority: "high",
        title: "Improve inbox response rate",
        description: `Only ${inputs.responseRate}% of inbound messages receive a reply. Set up AI auto-reply to ensure every lead gets an immediate response.`,
        whyThisExists: `Response rate: ${inputs.responseRate}% on ${inputs.inbound} inbound messages in last 30 days`,
        recommendedAction: { action: "navigate", target: "/workflow-builder" },
        sourceScoreId: score.id,
      });
      count++;
    }

    if (inputs.avgResponseMinutes !== null && (inputs.avgResponseMinutes as number) > 60 && (inputs.responseRate as number) > 0) {
      await createIfNotDuplicate({
        accountId,
        entityType: "account",
        entityId: String(accountId),
        recommendationType: "reduce_response_time",
        priority: "medium",
        title: "Reduce average response time",
        description: `Average response time is ${inputs.avgResponseMinutes} minutes. Studies show leads are 7x more likely to convert when contacted within 5 minutes.`,
        whyThisExists: `Average response time: ${inputs.avgResponseMinutes} min (goal: <5 min for highest conversion)`,
        recommendedAction: { action: "navigate", target: "/workflow-builder" },
        sourceScoreId: score.id,
      });
      count++;
    }
  }
  return count;
}

export async function generateModuleAdoptionRecommendations(accountId: number): Promise<number> {
  let count = 0;
  const scores = await storage.getScoresByType(accountId, "module_adoption_score");

  for (const score of scores) {
    const inputs = score.inputs as Record<string, unknown> | null;
    if (!inputs) continue;

    if ((inputs.moduleCount as number) < 4) {
      const unusedModules: string[] = [];
      if (!inputs.hasContacts) unusedModules.push("Contacts CRM");
      if (!inputs.hasWorkflows) unusedModules.push("Workflow Automation");
      if (!inputs.hasCampaigns) unusedModules.push("Email Campaigns");
      if (!inputs.hasPipeline) unusedModules.push("Pipeline/Deals");
      if (!inputs.hasCalendar) unusedModules.push("Calendar Booking");
      if (!inputs.hasReviews) unusedModules.push("Review Management");

      if (unusedModules.length > 0) {
        await createIfNotDuplicate({
          accountId,
          entityType: "account",
          entityId: String(accountId),
          recommendationType: "expand_module_adoption",
          priority: "low",
          title: `Unlock more of the platform (${inputs.moduleCount}/10 modules active)`,
          description: `You're using ${inputs.moduleCount} modules. Unused capabilities: ${unusedModules.slice(0, 3).join(", ")}. Each module adds a new revenue or automation lever.`,
          whyThisExists: `Module adoption: ${inputs.moduleCount}/10 — ${unusedModules.length} modules never used`,
          recommendedAction: { action: "navigate", target: "/dashboard" },
          sourceScoreId: score.id,
        });
        count++;
      }
    }
  }
  return count;
}

export async function runAllRecommendationsForAccount(accountId: number): Promise<number> {
  console.log(`[APEX-INTEL] Generating recommendations for account ${accountId}...`);
  let total = 0;
  try {
    const results = await Promise.allSettled([
      generateDomainRecommendations(accountId),
      generateSiteRecommendations(accountId),
      generateLeadRecommendations(accountId),
      generateIntegrationRecommendations(accountId),
      generateAccountRecommendations(accountId),
      generateWorkflowRecommendations(accountId),
      generateCampaignRecommendations(accountId),
      generatePipelineRecommendations(accountId),
      generateReputationRecommendations(accountId),
      generateCalendarRecommendations(accountId),
      generateDigitalCardRecommendations(accountId),
      generateAdRecommendations(accountId),
      generateMessagingRecommendations(accountId),
      generateModuleAdoptionRecommendations(accountId),
    ]);

    for (const result of results) {
      if (result.status === "fulfilled") total += result.value;
    }

    console.log(`[APEX-INTEL] Generated ${total} new recommendations for account ${accountId}`);
    if (total > 0) {
      import("./apexLearningFeed").then(({ emitRecommendationsBatchGenerated }) =>
        emitRecommendationsBatchGenerated(accountId, total)
      ).catch((err) => console.warn("[RECOMMENDATIONENGINE] promise rejected:", err instanceof Error ? err.message : err));
    }
  } catch (err) {
    console.error(`[APEX-INTEL] Recommendation generation failed for account ${accountId}:`, (err as Error).message);
  }
  return total;
}
