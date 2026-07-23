import type { RecommendationIntent } from "../../schemas";
import type { SkillAdapter, SkillInput } from "../types";

const VIP_PARTY_SIZE_THRESHOLD = 6;

/**
 * Local reference skill (issue #18 decision #10) — proves the plugin seam
 * with a real, working, checked-in example rather than an empty interface.
 * Reuses the same reservations_tonight facts the built-in
 * reservation-capacity rule sees, but proposes a different kind of
 * recommendation from them (a concierge opportunity, not a capacity
 * warning) — demonstrating a skill adds a distinct perspective on shared
 * facts rather than duplicating a built-in rule.
 */
export const vipReservationConciergeSkill: SkillAdapter = {
  manifest: {
    id: "vip-reservation-concierge",
    version: "v1",
    displayName: "VIP Reservation Concierge",
    description:
      "Flags large-party reservations tonight as a concierge opportunity. Reference implementation of the hospitality-os-plugin skill boundary, using repository fixtures only.",
    supportedSignalTypes: [],
    supportedRecommendationTypes: ["vip_reservation_concierge"],
    scope: "location",
  },
  propose({ facts, locationId, asOf }: SkillInput): RecommendationIntent[] {
    const vips = facts.reservations_tonight.filter((r) => (r.party_size ?? 0) >= VIP_PARTY_SIZE_THRESHOLD);
    const dateKey = asOf.toISOString().slice(0, 10);

    return vips.map((reservation) => ({
      dedupeKey: `vip_reservation_concierge:${reservation.id}:${dateKey}`,
      locationId: reservation.location_id ?? locationId ?? undefined,
      recommendationType: "vip_reservation_concierge",
      title: `Party of ${reservation.party_size} tonight — consider a personal welcome`,
      executiveSummary: `A reservation for ${reservation.party_size} guests is booked tonight. Large parties are a good opportunity for a personal greeting or a small welcome gesture.`,
      severity: "info",
      priorityScore: 20,
      recommendedActionType: "navigate",
      recommendedActionPayload: { route: "/reservations", label: "View tonight's reservations" },
      expectedBenefit: "A memorable large-party experience is disproportionately likely to become a repeat booking or review.",
      riskLevel: "low",
      requiresApproval: false,
      ruleId: "hospitality-os-plugin:vip-reservation-concierge.v1",
      evidence: [
        {
          metricName: "party_size",
          observedValue: { partySize: reservation.party_size },
          expectedValue: { threshold: VIP_PARTY_SIZE_THRESHOLD },
          sourceEntityType: "reservation",
          sourceEntityId: reservation.id,
          calculationDefinition: `reservations.party_size >= ${VIP_PARTY_SIZE_THRESHOLD} for tonight`,
          isFinanceSensitive: false,
        },
      ],
    }));
  },
};
