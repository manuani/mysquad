/**
 * Task complexity classification.
 *
 * Architecture §5.6: "The model and provider are chosen per the customer's
 * tier **and the task's complexity**. For a routine clarification, this is a
 * Good-tier model and completes in 800 ms; for a complex strategic point, this
 * is an Advanced-tier model and may complete in 2-3 seconds."
 *
 * Only the first half of that was implemented — dispatch keyed on the billing
 * plan alone, so an enterprise tenant burned Opus asking what a term meant, and
 * every question looked identical to the router.
 *
 * §5.6 also prescribes the v1 approach: "A simple rule engine in v1 (keyword
 * matching plus domain tag plus monetary thresholds) covers the common cases.
 * As outcome data accumulates, the Performance Service refines the
 * classification." This is that rule engine. It is deliberately transparent
 * rather than clever — an LLM call to classify a prompt would cost as much as
 * the call it is trying to size, and would need its own model choice.
 *
 * Classification never picks a model or a vendor. It reports how hard the task
 * is; `RoutingService` decides what that means given the tenant's plan and the
 * providers actually configured.
 */

/** How much reasoning the request appears to need. Vendor-neutral by design. */
export type TaskComplexity = 'routine' | 'standard' | 'complex';

export interface ComplexitySignals {
  readonly complexity: TaskComplexity;
  /** Which rules fired, for logs and for the Performance Service to learn from. */
  readonly reasons: readonly string[];
}

/**
 * Irreversible, high-stakes, or multi-variable work. These are the questions a
 * founder brings to advisors precisely because the answer is hard.
 */
const COMPLEX_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(strategy|strategic|roadmap|positioning|pivot)\b/i, 'strategy'],
  [/\b(raise|fundrais\w*|bridge round|series [a-d]\b|term sheet|valuation|cap table|dilution)\b/i, 'fundraising'],
  [/\b(runway|burn rate|insolven\w*|going concern|layoff|redundanc\w*|restructur\w*)\b/i, 'solvency'],
  [/\b(acqui\w*|merger|m&a|due diligence|exit)\b/i, 'M&A'],
  [/\b(litigat\w*|lawsuit|breach of contract|regulat\w*|compliance risk|liabilit\w*)\b/i, 'legal exposure'],
  [/\b(should we|trade-?off|versus|vs\.?|either way|pros and cons|which option)\b/i, 'comparative judgement'],
  [/\?[^?]*\?/, 'multiple questions'],
];

/**
 * Lookups and restatements. Cheap to answer well; wasteful to answer expensively.
 */
const ROUTINE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(what (is|are|does)|define|definition of|meaning of|stands for)\b/i, 'definition'],
  [/\b(summar\w+|recap|tl;?dr|list|remind me)\b/i, 'summary or recall'],
  [/\b(spell|rephrase|reword|shorter|tidy up|fix the wording)\b/i, 'rewrite'],
  [/^\s*(hi|hello|hey|thanks|thank you|ok(ay)?|got it|sounds good)\b/i, 'pleasantry'],
];

/**
 * A figure large enough that being wrong is expensive. Matches "$40,000",
 * "40k", "2.5 crore", "₹50 lakh". The threshold is money at risk, not
 * precision — §5.6's "monetary thresholds".
 */
const MONEY = /(?:[$₹€£]\s?|\b)(\d[\d,]*(?:\.\d+)?)\s*(k|m|bn?|lakh|crore|million|billion|thousand)?\b/gi;
const MATERIAL_AMOUNT = 10_000;

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
  lakh: 1e5,
  crore: 1e7,
};

function mentionsMaterialAmount(text: string): boolean {
  for (const match of text.matchAll(MONEY)) {
    const value = Number(match[1]!.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const scale = MULTIPLIERS[(match[2] ?? '').toLowerCase()] ?? 1;
    // A bare number with no currency symbol and no scale is probably not money
    // ("we have 3 engineers"), so require one or the other.
    const looksMonetary = scale > 1 || /[$₹€£]/.test(match[0]);
    if (looksMonetary && value * scale >= MATERIAL_AMOUNT) return true;
  }
  return false;
}

/** Domain tags, where the caller already knows the subject area. */
const COMPLEX_DOMAINS = new Set([
  'financial_state', 'decisions', 'risks', 'goals', 'competitive_landscape',
]);

export interface ClassifyInput {
  /** What the founder said. Only the latest turn is classified. */
  readonly message: string;
  /** Brain domain, when the call site knows it (e.g. 'financial_state'). */
  readonly domain?: string;
  /**
   * Set when the caller already knows the band and should not be second-guessed
   * — internal machinery like the relevance gate, which emits a fixed ~80 token
   * JSON verdict no matter how hard the founder's question is. Classifying its
   * prompt would size the model to the question being *judged* rather than to
   * the judging, and bill an enterprise tenant Opus rates to decide whether a
   * persona should speak.
   */
  readonly complexity?: TaskComplexity;
}

/**
 * Classifies one request. Complex signals win over routine ones: mistaking a
 * hard question for an easy one gives the founder a worse answer, while the
 * reverse only costs money. The asymmetry is deliberate.
 */
export function classifyComplexity(input: ClassifyInput): ComplexitySignals {
  if (input.complexity) {
    return { complexity: input.complexity, reasons: ['caller-specified'] };
  }

  const text = input.message ?? '';
  const reasons: string[] = [];

  for (const [pattern, label] of COMPLEX_PATTERNS) {
    if (pattern.test(text)) reasons.push(label);
  }
  if (mentionsMaterialAmount(text)) reasons.push('material amount');
  if (input.domain && COMPLEX_DOMAINS.has(input.domain)) reasons.push(`domain: ${input.domain}`);

  // Long messages carry more context to hold together at once.
  if (text.length > 600) reasons.push('long message');

  if (reasons.length >= 2) return { complexity: 'complex', reasons };
  if (reasons.length === 1) return { complexity: 'standard', reasons };

  const routine: string[] = [];
  for (const [pattern, label] of ROUTINE_PATTERNS) {
    if (pattern.test(text)) routine.push(label);
  }
  // Short and unambiguously a lookup.
  if (routine.length > 0 && text.length < 200) {
    return { complexity: 'routine', reasons: routine };
  }

  // Nothing fired either way. 'standard' is the safe default: it neither
  // under-serves a real question nor reaches for the most expensive model.
  return { complexity: 'standard', reasons: ['no signal — default'] };
}
