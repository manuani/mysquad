/**
 * Agent Runtime — single-agent baseline (Sprint Plan Deliverable 2.1.1).
 *
 * Loads a persona, accepts founder input (plus optional prior turns), calls
 * the routing module for a completion, and returns a structured
 * contribution. This is deliberately the smallest useful seam: one persona,
 * one routing call, one contribution back. Multi-agent dispatch, the
 * hand-raise protocol, and sub-agent dispatch (brain retriever, calculator,
 * document analyst, web search, marketplace specialists) all build on top
 * of this seam later (Phase 4, Sprints 4.2-4.3) and are out of scope here —
 * see README.md.
 *
 * Per ADR 007, `tenantContext` is always the first explicit parameter.
 *
 * Calls dispatch through `@voai/routing`'s exported `RoutingService` — its
 * typed cross-module entry point (see `services/routing/src/index.ts`),
 * never by reaching into routing's internal files (CLAUDE.md "Module
 * boundaries are real").
 */

import type { TenantContext } from '@voai/auth-context';
import type { LlmMessage, RoutingService } from '@voai/routing';
import type { EventBus } from '@voai/types';
import type { AgentPersona } from './personas/sarah-cfo.js';

export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AgentContributionInput {
  /** The founder's latest message. */
  readonly message: string;
  /** Prior turns in the conversation, oldest first. Optional. */
  readonly priorTurns?: readonly ConversationTurn[];
  /**
   * Relevant brain content for this tenant, already fetched by the
   * caller (routes.ts) via `@voai/brain`'s typed export — this class
   * never reaches into brain's internals itself (CLAUDE.md "Module
   * boundaries are real"). Plain strings, already formatted for
   * inclusion in a prompt. This is what makes a response demonstrably
   * continuous across sessions rather than a cold start every time —
   * Strategic Vision §3.2's distinction between "a clever toy" and "a
   * colleague who remembers."
   */
  readonly brainContext?: readonly string[];
  /**
   * The other personas present in this meeting, if any. Without this, an
   * agent asked about a topic outside their domain has no way to know
   * who else is actually on the team — found by exercising the roster
   * endpoint live: Sarah (CFO) deferred to "Maya (our CMO)" and "Raj
   * (our COO)," both invented, because nothing told her the real roster
   * is Priya Reddy (CMO) and Marcus Webb (Devil's Advocate). Persona
   * coherence across agents matters as much as any single agent's
   * answer quality for the "meeting with a team" claim to hold up.
   */
  readonly teammates?: readonly Pick<AgentPersona, 'name' | 'role'>[];
}

/**
 * The structured result every agent returns. This shape is the seam
 * multi-agent orchestration (Phase 4) will build on top of — keep it
 * stable and persona-agnostic.
 */
export interface AgentContribution {
  readonly agentName: string;
  readonly content: string;
  readonly generatedAt: string;
}

/** Result of the fast relevance gate applied before a full contribution. */
export interface ResponseGateResult {
  readonly shouldRespond: boolean;
  /** 0–1 relevance score as judged by the gate LLM. */
  readonly relevanceScore: number;
  readonly reason: string;
}

/** Minimum relevance score for a persona to contribute (overridable per-persona). */
const DEFAULT_GATE_THRESHOLD = 0.4;

function assembleSystemPrompt(
  persona: AgentPersona,
  brainContext?: readonly string[],
  teammates?: readonly Pick<AgentPersona, 'name' | 'role'>[],
): string {
  let prompt = persona.systemPrompt;

  if (teammates && teammates.length > 0) {
    const teamList = teammates.map((t) => `- ${t.name}, ${t.role}`).join('\n');
    prompt += `\n\nYour actual teammates in this meeting room are:\n${teamList}\n\nIf a question is outside your lane, defer to the specific teammate above whose lane it is — by their real name and role, never an invented name.`;
  }

  if (brainContext && brainContext.length > 0) {
    const contextBlock = brainContext.map((item) => `- ${item}`).join('\n');
    prompt += `\n\nWhat you already know about this founder's business, from prior sessions:\n${contextBlock}\n\nReference this naturally where it's relevant — you are a colleague with continuity, not a stranger meeting this founder for the first time.`;
  }

  return prompt;
}

export class AgentRuntime {
  constructor(private readonly routingService: RoutingService) {}

  /**
   * Fast gate: asks Claude Haiku whether this persona's role is relevant to
   * the founder's message. Returns a structured relevance decision in JSON.
   * On any parse error, defaults to shouldRespond=true so failures are never
   * silent silences.
   */
  async checkShouldRespond(
    tenantContext: TenantContext,
    persona: AgentPersona,
    message: string,
    priorTurns?: readonly ConversationTurn[],
  ): Promise<ResponseGateResult> {
    const recentContext =
      priorTurns && priorTurns.length > 0
        ? priorTurns
            .slice(-4)
            .map((t) => `${t.role === 'user' ? 'Founder' : 'AI'}: ${t.content.slice(0, 120)}`)
            .join('\n')
        : '';

    const gatePrompt = `You are a relevance classifier. Decide whether a ${persona.role} named ${persona.name} should contribute to this conversation.

${recentContext ? `Recent context:\n${recentContext}\n\n` : ''}Founder's latest message: "${message}"

Respond with ONLY valid JSON (no markdown, no explanation):
{"shouldRespond": true|false, "relevanceScore": 0.0-1.0, "reason": "one sentence"}

A ${persona.role} should respond when the topic directly touches their domain. Score > 0.4 means they should respond.`;

    try {
      const result = await this.routingService.complete(tenantContext, {
        systemPrompt: 'You are a relevance classifier. Output only valid JSON.',
        messages: [{ role: 'user', content: gatePrompt }],
        maxTokens: 80,
      });

      const parsed = JSON.parse(result.content.trim()) as {
        shouldRespond: boolean;
        relevanceScore: number;
        reason: string;
      };

      return {
        shouldRespond: Boolean(parsed.shouldRespond),
        relevanceScore: typeof parsed.relevanceScore === 'number' ? parsed.relevanceScore : 0.5,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      };
    } catch {
      // Parse failure → allow contribution (fail open)
      return { shouldRespond: true, relevanceScore: 1.0, reason: 'gate parse failed, defaulting to respond' };
    }
  }

  /**
   * Generates a single agent's contribution to the conversation by
   * assembling the persona's system prompt (plus any brain context) and
   * the conversation history into a routing request, then shaping
   * routing's response into an `AgentContribution`.
   */
  async generateContribution(
    tenantContext: TenantContext,
    persona: AgentPersona,
    input: AgentContributionInput,
  ): Promise<AgentContribution> {
    const messages: LlmMessage[] = [
      ...(input.priorTurns ?? []).map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      { role: 'user' as const, content: input.message },
    ];

    const result = await this.routingService.complete(tenantContext, {
      systemPrompt: assembleSystemPrompt(persona, input.brainContext, input.teammates),
      messages,
    });

    return {
      agentName: persona.name,
      content: result.content,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Dispatches the same founder input to multiple personas in parallel.
   *
   * Each persona first goes through a fast Haiku relevance gate
   * (`checkShouldRespond`). Personas whose relevance score falls below
   * `DEFAULT_GATE_THRESHOLD` are skipped — their entry in the result
   * carries `skipped: true` and the gate's reason. This eliminates the
   * round-robin feel where every agent always speaks regardless of
   * whether the topic is in their lane.
   *
   * Gate failures (network error, JSON parse failure) default to
   * shouldRespond=true so a broken gate never silently silences an agent.
   *
   * Full contributions for passing personas still run in parallel.
   */
  async generateRosterContributions(
    tenantContext: TenantContext,
    personas: readonly AgentPersona[],
    input: AgentContributionInput,
    options?: { gateThreshold?: number; skipGate?: boolean },
  ): Promise<
    Array<{
      persona: AgentPersona;
      contribution: AgentContribution | null;
      error: string | null;
      skipped: boolean;
      gateResult?: ResponseGateResult;
    }>
  > {
    const threshold = options?.gateThreshold ?? DEFAULT_GATE_THRESHOLD;

    // Phase 1: run all gates in parallel (cheap Haiku calls, ~80 tokens each)
    const gateResults = options?.skipGate
      ? personas.map((): ResponseGateResult => ({ shouldRespond: true, relevanceScore: 1.0, reason: 'gate skipped' }))
      : await Promise.all(
          personas.map((persona) =>
            this.checkShouldRespond(tenantContext, persona, input.message, input.priorTurns),
          ),
        );

    // Phase 2: run full contributions only for personas that passed the gate
    const output: Array<{
      persona: AgentPersona;
      contribution: AgentContribution | null;
      error: string | null;
      skipped: boolean;
      gateResult?: ResponseGateResult;
    }> = [];

    const activePersonas: AgentPersona[] = [];
    const activeIndices: number[] = [];

    personas.forEach((persona, i) => {
      const gate = gateResults[i]!;
      if (!gate.shouldRespond || gate.relevanceScore < threshold) {
        output[i] = { persona, contribution: null, error: null, skipped: true, gateResult: gate };
      } else {
        activePersonas.push(persona);
        activeIndices.push(i);
        // placeholder to be filled after contributions run
        output[i] = { persona, contribution: null, error: null, skipped: false, gateResult: gate };
      }
    });

    if (activePersonas.length > 0) {
      const contributions = await Promise.allSettled(
        activePersonas.map((persona) =>
          this.generateContribution(tenantContext, persona, {
            ...input,
            teammates: personas.filter((p) => p.id !== persona.id).map((p) => ({ name: p.name, role: p.role })),
          }),
        ),
      );

      contributions.forEach((result, j) => {
        const idx = activeIndices[j]!;
        const persona = activePersonas[j]!;
        if (result.status === 'fulfilled') {
          output[idx] = { ...output[idx]!, persona, contribution: result.value, error: null };
        } else {
          output[idx] = { ...output[idx]!, persona, contribution: null, error: String(result.reason) };
        }
      });
    }

    return output as Array<{
      persona: AgentPersona;
      contribution: AgentContribution | null;
      error: string | null;
      skipped: boolean;
      gateResult?: ResponseGateResult;
    }>;
  }

  /**
   * Observer loop — runs asynchronously after a roster call for each persona
   * that was skipped by the gate. Re-scores them with a higher bar ("do you
   * have something *urgent* to add, given what your teammates just said?").
   * Personas that score ≥ 0.65 publish a `raise-hand` event on the EventBus,
   * which the meeting module fans out to connected SSE clients.
   *
   * This is fire-and-forget: errors are swallowed so they never affect the
   * caller. Non-blocking by design — the roster response has already been
   * returned to the client before this runs.
   */
  async observeSkippedPersonas(
    tenantContext: TenantContext,
    skippedPersonas: ReadonlyArray<{ persona: AgentPersona; gateResult: ResponseGateResult }>,
    input: { message: string; priorTurns?: readonly ConversationTurn[]; contributionsSoFar: string[] },
    sessionId: string,
    events: EventBus,
  ): Promise<void> {
    const OBSERVER_THRESHOLD = 0.65;

    await Promise.allSettled(
      skippedPersonas.map(async ({ persona }) => {
        const alreadySaid =
          input.contributionsSoFar.length > 0
            ? `\n\nYour teammates already said:\n${input.contributionsSoFar.map((c, i) => `${i + 1}. ${c.slice(0, 200)}`).join('\n')}`
            : '';

        const observerPrompt = `You are a relevance classifier for ${persona.name}, ${persona.role}.

The founder just said: "${input.message}"${alreadySaid}

Given everything that was just said, does ${persona.name} have something *critically important* to add that was NOT covered? Score 0-1. Only urgent, non-redundant insights score above 0.65.

Respond with ONLY valid JSON:
{"shouldRespond": true|false, "relevanceScore": 0.0-1.0, "reason": "one sentence"}`;

        const result = await this.routingService.complete(tenantContext, {
          systemPrompt: 'You are a relevance classifier. Output only valid JSON.',
          messages: [{ role: 'user', content: observerPrompt }],
          maxTokens: 80,
        });

        let gate: ResponseGateResult;
        try {
          const parsed = JSON.parse(result.content.trim()) as {
            shouldRespond: boolean;
            relevanceScore: number;
            reason: string;
          };
          gate = {
            shouldRespond: Boolean(parsed.shouldRespond),
            relevanceScore: typeof parsed.relevanceScore === 'number' ? parsed.relevanceScore : 0,
            reason: typeof parsed.reason === 'string' ? parsed.reason : '',
          };
        } catch {
          return; // parse failed — stay silent, don't raise hand on garbage
        }

        if (gate.shouldRespond && gate.relevanceScore >= OBSERVER_THRESHOLD) {
          await events.publish({
            type: 'raise-hand',
            tenantId: tenantContext.tenantId,
            timestamp: new Date().toISOString(),
            payload: {
              sessionId,
              personaId: persona.id,
              personaName: persona.name,
              personaRole: persona.role,
              relevanceScore: gate.relevanceScore,
              reason: gate.reason,
            },
          });
        }
      }),
    );
  }
}
