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

export class AgentRuntime {
  constructor(private readonly routingService: RoutingService) {}

  /**
   * Generates a single agent's contribution to the conversation by
   * assembling the persona's system prompt and the conversation history
   * into a routing request, then shaping routing's response into an
   * `AgentContribution`.
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
      systemPrompt: persona.systemPrompt,
      messages,
    });

    return {
      agentName: persona.name,
      content: result.content,
      generatedAt: new Date().toISOString(),
    };
  }
}
