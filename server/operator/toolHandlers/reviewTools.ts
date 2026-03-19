import type { OperatorTool, ValidationResult, ToolResult, OperatorContext } from "../types";
import { storage } from "../../storage";
import { verifyTenant } from "./tenantGuard";

function noopValidate(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export const reviewTools: OperatorTool[] = [
  {
    name: "respondToReviewDraft",
    description: "Create a draft response to a customer review (never auto-posts)",
    category: "review",
    autonomyRequired: "draft",
    requiresApproval: true,
    parameters: [
      { name: "reviewId", type: "number", required: true, description: "Review ID" },
      { name: "responseText", type: "string", required: false, description: "Response text (auto-generated if empty)" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const review = await storage.getReview(params.reviewId);
      const guard = verifyTenant(review, ctx.subAccountId, "Review");
      if (guard) return guard;

      let responseText = params.responseText;
      if (!responseText) {
        const { aiChat, isAIConfigured } = await import("../../aiGateway");
        if (isAIConfigured()) {
          const prompt = `Write a professional, empathetic response to this ${review.rating}-star review from ${review.customerName}: "${review.comment}". Keep it concise (2-3 sentences). Return plain text only, no JSON.`;
          const reviewToolAiResult = await aiChat([{ role: "user", content: prompt }], { temperature: 0.6, route: "review-tools-respond" });
          responseText = reviewToolAiResult.text;
        } else {
          responseText = `Thank you for your feedback, ${review.customerName}. We appreciate you taking the time to share your experience.`;
        }
      }

      return {
        success: true,
        data: {
          status: "draft",
          reviewId: params.reviewId,
          customerName: review.customerName,
          rating: review.rating,
          originalComment: review.comment,
          responseText,
          note: "Response saved as draft. Posting requires approval.",
        },
        sideEffects: ["Created review response draft"],
      };
    },
    summarizeForAudit: (params, result) => `Drafted response for review #${params.reviewId} (${result.data?.rating}-star).`,
  },
  {
    name: "classifyReviewSentiment",
    description: "Classify the sentiment of a customer review",
    category: "review",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "reviewId", type: "number", required: true, description: "Review ID" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const review = await storage.getReview(params.reviewId);
      const guard = verifyTenant(review, ctx.subAccountId, "Review");
      if (guard) return guard;

      let sentiment: "positive" | "neutral" | "negative";
      let confidence = 0.85;

      if (review.rating >= 4) {
        sentiment = "positive";
        confidence = 0.95;
      } else if (review.rating === 3) {
        sentiment = "neutral";
        confidence = 0.75;
      } else {
        sentiment = "negative";
        confidence = 0.95;
      }

      const keywords: string[] = [];
      const comment = (review.comment || "").toLowerCase();
      if (comment.includes("great") || comment.includes("excellent") || comment.includes("amazing")) keywords.push("praise");
      if (comment.includes("slow") || comment.includes("wait") || comment.includes("delay")) keywords.push("speed_issue");
      if (comment.includes("rude") || comment.includes("unprofessional")) keywords.push("service_issue");
      if (comment.includes("price") || comment.includes("expensive") || comment.includes("cost")) keywords.push("pricing_concern");

      return {
        success: true,
        data: {
          reviewId: params.reviewId,
          sentiment,
          confidence,
          rating: review.rating,
          keywords,
          customerName: review.customerName,
        },
      };
    },
    summarizeForAudit: (params, result) => `Classified review #${params.reviewId} sentiment: ${result.data?.sentiment}.`,
  },
  {
    name: "escalateNegativeReview",
    description: "Flag a negative review for immediate attention",
    category: "review",
    autonomyRequired: "draft",
    requiresApproval: false,
    parameters: [
      { name: "reviewId", type: "number", required: true, description: "Review ID" },
      { name: "reason", type: "string", required: false, description: "Escalation reason" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const review = await storage.getReview(params.reviewId);
      const guard = verifyTenant(review, ctx.subAccountId, "Review");
      if (guard) return guard;

      await storage.createNotification({
        subAccountId: ctx.subAccountId,
        type: "review_escalation",
        title: `Negative Review Alert: ${review.rating} star from ${review.customerName}`,
        body: params.reason || `Review requires immediate attention: "${review.comment?.substring(0, 100)}..."`,
      });

      return {
        success: true,
        data: {
          reviewId: params.reviewId,
          rating: review.rating,
          customerName: review.customerName,
          escalationReason: params.reason || "Negative review flagged for attention",
          notificationCreated: true,
        },
        sideEffects: ["Created escalation notification for negative review"],
      };
    },
    summarizeForAudit: (params) => `Escalated negative review #${params.reviewId}.`,
  },
  {
    name: "generateReviewRecoveryPlan",
    description: "Generate a recovery plan for a negative review",
    category: "review",
    autonomyRequired: "observe",
    requiresApproval: false,
    parameters: [
      { name: "reviewId", type: "number", required: true, description: "Review ID" },
    ],
    validate: noopValidate,
    execute: async (params, ctx) => {
      const review = await storage.getReview(params.reviewId);
      const guard = verifyTenant(review, ctx.subAccountId, "Review");
      if (guard) return guard;

      const steps: string[] = [];

      if (review.rating <= 2) {
        steps.push("Respond publicly within 24 hours with empathy and accountability");
        steps.push("Reach out privately via email or phone to understand the issue");
        steps.push("Offer a concrete resolution (refund, redo, discount on next service)");
        steps.push("Follow up within 1 week to confirm satisfaction");
        steps.push("If resolved, politely ask if they'd update their review");
      } else {
        steps.push("Thank the customer for their honest feedback");
        steps.push("Address specific concerns mentioned in the review");
        steps.push("Invite them to try the improved experience");
      }

      return {
        success: true,
        data: {
          reviewId: params.reviewId,
          rating: review.rating,
          customerName: review.customerName,
          recoverySteps: steps,
          urgency: review.rating <= 2 ? "high" : "medium",
          estimatedRecoveryTime: review.rating <= 2 ? "3-7 days" : "1-3 days",
        },
      };
    },
    summarizeForAudit: (params, result) => `Generated recovery plan for review #${params.reviewId} (${result.data?.recoverySteps?.length || 0} steps).`,
  },
];
