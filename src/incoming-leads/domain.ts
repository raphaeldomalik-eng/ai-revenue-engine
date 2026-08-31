export const INCOMING_SOURCE_CATEGORIES = [
  "DEMO_REQUEST",
  "TALK_TO_SALES",
  "TRIAL_STARTED",
  "PRODUCT_ENQUIRY",
  "RESOURCE_DOWNLOAD",
  "TEMPLATE_DOWNLOAD",
  "NEWSLETTER_SIGNUP",
  "INTERNAL_TEST",
] as const;

export type IncomingSourceCategory = (typeof INCOMING_SOURCE_CATEGORIES)[number];
export type IncomingIntent = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "NURTURE" | "EXCLUDED";
export type IncomingStage = "NEW" | "REVIEWING" | "QUALIFIED" | "CONTACTED" | "DEMO_SCHEDULED" | "TRIAL_ACTIVE" | "PROPOSAL" | "NURTURE" | "CONVERTED" | "DISQUALIFIED" | "LOST";

export type CommunicationPolicy = {
  permittedTreatment: string;
  marketingConsentRequired: boolean;
  responseUrgency: "IMMEDIATE" | "SAME_DAY" | "WITHIN_2_DAYS" | "NURTURE" | "NONE";
  ownerRequired: boolean;
  humanApprovalRequired: boolean;
  recommendedCommunicationSet: string[];
  transitionCondition: string;
};

export type IncomingSubmissionInput = {
  sourceSystem: string;
  sourceRecordId: string;
  schemaVersion: string;
  productCode: string;
  sourceCategory: IncomingSourceCategory;
  sourceDetail?: string | null;
  sourcePage?: string | null;
  resourceIdentifier?: string | null;
  templateIdentifier?: string | null;
  campaignIdentifier?: string | null;
  contactName?: string | null;
  submittedEmail?: string | null;
  phone?: string | null;
  organisationName?: string | null;
  countryCode?: string | null;
  consentState?: string | null;
  consentEvidence?: Record<string, unknown>;
  firstTouchAttribution?: Record<string, unknown>;
  currentTouchAttribution?: Record<string, unknown>;
  occurredAt: string;
  environment?: "PRODUCTION" | "DEVELOPMENT" | "TEST";
  originalPayload: Record<string, unknown>;
};

const sourceRank: Record<IncomingSourceCategory, number> = {
  TALK_TO_SALES: 5,
  DEMO_REQUEST: 5,
  TRIAL_STARTED: 4,
  PRODUCT_ENQUIRY: 4,
  RESOURCE_DOWNLOAD: 1,
  TEMPLATE_DOWNLOAD: 1,
  NEWSLETTER_SIGNUP: 0,
  INTERNAL_TEST: -1,
};

export function normalizeEmail(value?: string | null) {
  if (!value) return null;
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function initialIntent(category: IncomingSourceCategory, activityCount = 1): IncomingIntent {
  if (category === "INTERNAL_TEST") return "EXCLUDED";
  if (category === "TALK_TO_SALES" || category === "DEMO_REQUEST") return "VERY_HIGH";
  if (category === "TRIAL_STARTED" || category === "PRODUCT_ENQUIRY") return "HIGH";
  if (category === "NEWSLETTER_SIGNUP") return "NURTURE";
  return activityCount >= 3 ? "MEDIUM" : "LOW";
}

export function sourceActivityType(category: IncomingSourceCategory) {
  const types: Record<IncomingSourceCategory, string> = {
    DEMO_REQUEST: "demo_requested",
    TALK_TO_SALES: "talk_to_sales_submitted",
    TRIAL_STARTED: "trial_started",
    PRODUCT_ENQUIRY: "product_enquiry_submitted",
    RESOURCE_DOWNLOAD: "resource_downloaded",
    TEMPLATE_DOWNLOAD: "template_downloaded",
    NEWSLETTER_SIGNUP: "newsletter_signup",
    INTERNAL_TEST: "internal_test_excluded",
  };
  return types[category];
}

export function shouldCreateOpportunity(category: IncomingSourceCategory) {
  return ["DEMO_REQUEST", "TALK_TO_SALES", "TRIAL_STARTED", "PRODUCT_ENQUIRY"].includes(category);
}

export function highestIntentCategory(categories: IncomingSourceCategory[]) {
  return [...categories].sort((a, b) => sourceRank[b] - sourceRank[a])[0] ?? null;
}

export function currentIntent(categories: IncomingSourceCategory[]) {
  const highest = highestIntentCategory(categories);
  if (!highest) return "LOW" as IncomingIntent;
  return initialIntent(highest, categories.filter((category) => ["RESOURCE_DOWNLOAD", "TEMPLATE_DOWNLOAD"].includes(category)).length);
}

export function priorityReason(category: IncomingSourceCategory, occurredAt: string, activityCount = 1, followUpAt?: string | null, now = Date.now()) {
  const ageMinutes = Math.max(0, Math.round((now - new Date(occurredAt).getTime()) / 60000));
  const age = ageMinutes < 60 ? `${Math.max(1, ageMinutes)} minutes` : ageMinutes < 1440 ? `${Math.round(ageMinutes / 60)} hours` : `${Math.round(ageMinutes / 1440)} days`;
  if (followUpAt && new Date(followUpAt).getTime() < now) return `Follow-up overdue by ${Math.max(1, Math.round((now - new Date(followUpAt).getTime()) / 86400000))} days`;
  if (category === "DEMO_REQUEST") return `Demo requested ${age} ago`;
  if (category === "TALK_TO_SALES") return `Talk-to-sales enquiry received ${age} ago`;
  if (category === "TRIAL_STARTED") return "Trial started and not contacted";
  if (category === "PRODUCT_ENQUIRY") return "Product enquiry requires human qualification";
  if (activityCount >= 3) return `Downloaded ${activityCount} Event Suite resources recently`;
  if (category === "NEWSLETTER_SIGNUP") return "Nurture communication only with valid consent";
  return "Requested resource delivery; no sales follow-up assumed";
}

export function communicationPolicy(category: IncomingSourceCategory, consentState = "UNKNOWN"): CommunicationPolicy {
  const consentValid = ["GRANTED", "OPTED_IN", "VALID"].includes(consentState.toUpperCase());
  if (category === "DEMO_REQUEST") return { permittedTreatment: "Transactional acknowledgement and human sales follow-up permitted.", marketingConsentRequired: false, responseUrgency: "IMMEDIATE", ownerRequired: true, humanApprovalRequired: true, recommendedCommunicationSet: ["Transactional acknowledgement", "Human demo follow-up"], transitionCondition: "Owner records contact or demo is scheduled." };
  if (category === "TALK_TO_SALES") return { permittedTreatment: "Direct response to the enquiry permitted.", marketingConsentRequired: false, responseUrgency: "IMMEDIATE", ownerRequired: true, humanApprovalRequired: true, recommendedCommunicationSet: ["Direct human response"], transitionCondition: "Owner records contact and qualification outcome." };
  if (category === "TRIAL_STARTED") return { permittedTreatment: "Service and activation communication permitted; commercial assistance is separate.", marketingConsentRequired: false, responseUrgency: "SAME_DAY", ownerRequired: false, humanApprovalRequired: true, recommendedCommunicationSet: ["Trial activation/service support"], transitionCondition: "Trial is active, qualified, or closed." };
  if (category === "PRODUCT_ENQUIRY") return { permittedTreatment: "Human qualification permitted.", marketingConsentRequired: false, responseUrgency: "SAME_DAY", ownerRequired: true, humanApprovalRequired: true, recommendedCommunicationSet: ["Human qualification response"], transitionCondition: "Qualification outcome recorded." };
  if (category === "NEWSLETTER_SIGNUP") return { permittedTreatment: consentValid ? "Marketing communication permitted with recorded consent." : "No marketing communication until valid consent evidence exists.", marketingConsentRequired: true, responseUrgency: "NURTURE", ownerRequired: false, humanApprovalRequired: true, recommendedCommunicationSet: consentValid ? ["Marketing newsletter"] : [], transitionCondition: "Consent is confirmed or the contact opts out." };
  if (category === "INTERNAL_TEST") return { permittedTreatment: "No communication.", marketingConsentRequired: false, responseUrgency: "NONE", ownerRequired: false, humanApprovalRequired: false, recommendedCommunicationSet: [], transitionCondition: "Remain excluded." };
  return { permittedTreatment: consentValid ? "Requested resource delivery; marketing nurture is permitted with recorded consent." : "Requested resource delivery only; marketing nurture requires valid consent.", marketingConsentRequired: true, responseUrgency: "WITHIN_2_DAYS", ownerRequired: false, humanApprovalRequired: true, recommendedCommunicationSet: consentValid ? ["Requested resource delivery", "Marketing nurture"] : ["Requested resource delivery"], transitionCondition: "Delivery is complete, consent changes, or engagement becomes high intent." };
}
