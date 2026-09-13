/**
 * The state carried across the round routes, and the payload handed to the
 * report page at the end.
 *
 * The report matches emotion snapshots to questions by message id and splits
 * rounds by `message.round`, so the merged `messages` array is the single thing
 * that must stay complete and ordered.
 */

import type { ResumeContext, Round } from '../types/interview';
import {
  mergeExpressions,
  mergeMessages,
  type ExpressionEntry,
  type LegacyMessage,
  type RoundArtifacts,
} from './roundPayload';

export interface InterviewFlowState {
  /** Minutes per round, chosen on the setup screen. */
  roundDuration?: number;
  resumeData?: Partial<ResumeContext> | null;
  conversationId?: string;

  technicalMessages?: LegacyMessage[];
  technicalQuestionExpressions?: ExpressionEntry[];
  coreMessages?: LegacyMessage[];
  coreQuestionExpressions?: ExpressionEntry[];
  hrMessages?: LegacyMessage[];
  hrQuestionExpressions?: ExpressionEntry[];

  /** Technical round scratchpad, carried so the report can quote it. */
  code?: string;
  codeLanguage?: string;

  tabSwitches?: number;
  /** True only if facial analysis genuinely ran in at least one round. */
  emotionAvailable?: boolean;
}

/** Fold a finished round's artifacts into the flow state for the next route. */
export function advanceFlow(prev: InterviewFlowState, artifacts: RoundArtifacts): InterviewFlowState {
  const next: InterviewFlowState = {
    ...prev,
    tabSwitches: (prev.tabSwitches ?? 0) + artifacts.tabSwitches,
    emotionAvailable: Boolean(prev.emotionAvailable) || artifacts.emotionAvailable,
  };

  if (artifacts.round === 'technical') {
    next.technicalMessages = artifacts.messages;
    next.technicalQuestionExpressions = artifacts.questionExpressions;
    if (artifacts.code) {
      next.code = artifacts.code;
      next.codeLanguage = artifacts.codeLanguage;
    }
  } else if (artifacts.round === 'core') {
    next.coreMessages = artifacts.messages;
    next.coreQuestionExpressions = artifacts.questionExpressions;
  } else {
    next.hrMessages = artifacts.messages;
    next.hrQuestionExpressions = artifacts.questionExpressions;
  }

  return next;
}

export interface SummaryNavState extends InterviewFlowState {
  summary: string;
  messages: LegacyMessage[];
  questionExpressions: ExpressionEntry[];
  roundType: Round | 'full';
  totalDurationMinutes: number;
}

/**
 * Build the `/nerv-summary` navigation state.
 *
 * `questionExpressions` is the technical round's (the report reads it as such);
 * the other rounds travel under their own keys.
 */
export function buildSummaryState(
  flow: InterviewFlowState,
  options: { summary: string; roundType: Round | 'full' },
): SummaryNavState {
  const messages = mergeMessages(flow.technicalMessages, flow.coreMessages, flow.hrMessages);
  const roundsPlayed = [flow.technicalMessages, flow.coreMessages, flow.hrMessages].filter(
    (m) => m && m.length > 0,
  ).length;

  return {
    ...flow,
    summary: options.summary,
    roundType: options.roundType,
    messages,
    questionExpressions: flow.technicalQuestionExpressions ?? [],
    totalDurationMinutes: (flow.roundDuration ?? 0) * Math.max(1, roundsPlayed),
  };
}

/** All expression entries across every round, for aggregate stats. */
export function allExpressions(flow: InterviewFlowState): ExpressionEntry[] {
  return mergeExpressions(
    flow.technicalQuestionExpressions,
    flow.coreQuestionExpressions,
    flow.hrQuestionExpressions,
  );
}
