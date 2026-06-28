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
   * Dispatches the same founder input to multiple personas in parallel
   * and returns every contribution, each independently generated and
   * persona-distinct. This is deliberately NOT the ADR 011 hand-raise/
   * collision-arbiter pipeline (Phase 4, not yet implemented) — it is the
   * smallest unit of proof for the Strategic Vision's core claim that
   * this is "a meeting with a team," not a single chatbot: multiple
   * agents responding to the same input, independently, in their own
   * voice. A failure in one agent's contribution does not block the
   * others — each promise is awaited individually so one provider error
   * surfaces as an error entry for that agent, not a failure of the
   * whole roster call.
   */
  async generateRosterContributions(
    tenantContext: TenantContext,
    personas: readonly AgentPersona[],
    input: AgentContributionInput,
  ): Promise<Array<{ persona: AgentPersona; contribution: AgentContribution | null; error: string | null }>> {
    const results = await Promise.allSettled(
      personas.map((persona) =>
        this.generateContribution(tenantContext, persona, {
          ...input,
          teammates: personas.filter((p) => p.id !== persona.id).map((p) => ({ name: p.name, role: p.role })),
        }),
      ),
    );

    return results.map((result, index) => {
      const persona = personas[index] as AgentPersona;
      if (result.status === 'fulfilled') {
        return { persona, contribution: result.value, error: null };
      }
      return { persona, contribution: null, error: String(result.reason) };
    });
  }
}
