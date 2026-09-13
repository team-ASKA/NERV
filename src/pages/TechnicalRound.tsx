/**
 * Technical round — resume-grounded engineering questions with a live code
 * scratchpad. The editor is context for the interviewer, not an execution
 * environment; the candidate talks through what they write.
 */

import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { InterviewRoom, RoundLoading } from '../components/interview';
import { useResumeContext } from '../hooks/useResumeContext';
import { advanceFlow, buildSummaryState, type InterviewFlowState } from '../lib/interviewFlow';
import { generateSummary } from '../services/summaryService';
import type { RoundArtifacts } from '../lib/roundPayload';

const DEFAULT_DURATION = 10;
const QUESTIONS = 6;

export default function TechnicalRound() {
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = (location.state ?? {}) as InterviewFlowState;

  const { resume, loading, missing } = useResumeContext(incoming.resumeData);
  const duration = incoming.roundDuration ?? DEFAULT_DURATION;

  const conversationId = useMemo(
    () => incoming.conversationId ?? `nerv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    [incoming.conversationId],
  );

  const baseFlow = (): InterviewFlowState => ({
    ...incoming,
    conversationId,
    roundDuration: duration,
    resumeData: resume,
  });

  const handleComplete = (artifacts: RoundArtifacts) => {
    navigate('/core-round', { state: advanceFlow(baseFlow(), artifacts) });
  };

  const finishEarly = async (artifacts: RoundArtifacts) => {
    const flow = advanceFlow(baseFlow(), artifacts);
    const { summary } = await generateSummary({
      resume,
      technical: artifacts.transcript,
      core: [],
      hr: [],
      emotions: artifacts.questionExpressions,
      code: artifacts.code,
    });
    navigate('/nerv-summary', {
      state: buildSummaryState(flow, { summary, roundType: 'technical' }),
      replace: true,
    });
  };

  if (loading) return <RoundLoading label="Loading your resume for the technical round…" />;

  return (
    <InterviewRoom
      round="technical"
      resume={resume}
      durationMinutes={duration}
      maxQuestions={QUESTIONS}
      enableCode
      intro={{
        eyebrow: 'Round 1 of 3',
        title: 'Technical round',
        description: missing
          ? 'No parsed resume was found, so the interviewer will ask general engineering questions. Upload a resume from your dashboard for questions grounded in your own work.'
          : 'Questions are drawn from the skills and projects on your resume. Answer out loud — the interviewer follows up on what you actually say.',
        bullets: [
          'Speak naturally; the mic detects when you have finished answering.',
          'Use the scratchpad to sketch code — it is read as context, never executed.',
          'Say "could you repeat that" or press Repeat if you miss a question.',
          'Leaving the tab is recorded and shown in your report.',
        ],
      }}
      completeLabel="Continue to the core round"
      secondaryAction={{
        label: 'Finish here and see my report',
        onClick: (a) => void finishEarly(a),
      }}
      onComplete={handleComplete}
      onExit={() => navigate('/dashboard')}
    />
  );
}
