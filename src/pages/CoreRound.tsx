/**
 * Core round — depth on the candidate's own projects: decisions, trade-offs and
 * what they personally owned.
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { InterviewRoom, RoundLoading } from '../components/interview';
import { useResumeContext } from '../hooks/useResumeContext';
import { advanceFlow, buildSummaryState, type InterviewFlowState } from '../lib/interviewFlow';
import { generateSummary } from '../services/summaryService';
import type { RoundArtifacts } from '../lib/roundPayload';

const DEFAULT_DURATION = 10;
const QUESTIONS = 5;

export default function CoreRound() {
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = (location.state ?? {}) as InterviewFlowState;

  const { resume, loading, missing } = useResumeContext(incoming.resumeData);
  const duration = incoming.roundDuration ?? DEFAULT_DURATION;

  const baseFlow = (): InterviewFlowState => ({
    ...incoming,
    roundDuration: duration,
    resumeData: resume,
  });

  const handleComplete = (artifacts: RoundArtifacts) => {
    navigate('/hr-round', { state: advanceFlow(baseFlow(), artifacts) });
  };

  const finishEarly = async (artifacts: RoundArtifacts) => {
    const flow = advanceFlow(baseFlow(), artifacts);
    const { summary } = await generateSummary({
      resume,
      technical: flow.technicalMessages ?? [],
      core: artifacts.transcript,
      hr: [],
      emotions: artifacts.questionExpressions,
      code: flow.code,
    });
    navigate('/nerv-summary', {
      state: buildSummaryState(flow, { summary, roundType: 'core' }),
      replace: true,
    });
  };

  if (loading) return <RoundLoading label="Loading your projects for the core round…" />;

  return (
    <InterviewRoom
      round="core"
      resume={resume}
      durationMinutes={duration}
      maxQuestions={QUESTIONS}
      intro={{
        eyebrow: 'Round 2 of 3',
        title: 'Core / project round',
        description: missing
          ? 'No parsed resume was found, so the interviewer will ask about project work in general terms.'
          : 'A deep dive into the projects on your resume — architecture, trade-offs, and the part you personally owned.',
        bullets: [
          'Expect follow-ups that push on specifics: numbers, decisions, failures.',
          'Describe your own contribution rather than the team’s.',
          '“I don’t know” is a valid answer — the interviewer moves on rather than grinding.',
        ],
      }}
      completeLabel="Continue to the HR round"
      secondaryAction={{
        label: 'Finish here and see my report',
        onClick: (a) => void finishEarly(a),
      }}
      onComplete={handleComplete}
      onExit={() => navigate('/dashboard')}
    />
  );
}
