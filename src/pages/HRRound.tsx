/**
 * HR round — motivation, communication and behavioural signal. Last round in
 * the flow, so it also generates the report before handing off to the summary.
 */

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { InterviewRoom, RoundLoading } from '../components/interview';
import { useResumeContext } from '../hooks/useResumeContext';
import { advanceFlow, allExpressions, buildSummaryState, type InterviewFlowState } from '../lib/interviewFlow';
import { generateSummary } from '../services/summaryService';
import type { RoundArtifacts } from '../lib/roundPayload';

const DEFAULT_DURATION = 10;
const QUESTIONS = 5;

export default function HRRound() {
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = (location.state ?? {}) as InterviewFlowState;

  const { resume, loading, missing } = useResumeContext(incoming.resumeData);
  const [generating, setGenerating] = useState(false);
  const duration = incoming.roundDuration ?? DEFAULT_DURATION;

  const handleComplete = async (artifacts: RoundArtifacts) => {
    setGenerating(true);

    const flow = advanceFlow(
      { ...incoming, roundDuration: duration, resumeData: resume },
      artifacts,
    );

    const { summary } = await generateSummary({
      resume,
      technical: flow.technicalMessages ?? [],
      core: flow.coreMessages ?? [],
      hr: artifacts.transcript,
      emotions: flow.emotionAvailable ? allExpressions(flow) : null,
      code: flow.code,
    });

    navigate('/nerv-summary', {
      state: buildSummaryState(flow, { summary, roundType: 'full' }),
      replace: true,
    });
  };

  if (loading) return <RoundLoading label="Preparing your HR round…" />;
  if (generating) return <RoundLoading label="Analysing your interview and writing your report…" />;

  return (
    <InterviewRoom
      round="hr"
      resume={resume}
      durationMinutes={duration}
      maxQuestions={QUESTIONS}
      intro={{
        eyebrow: 'Round 3 of 3',
        title: 'HR / behavioural round',
        description: missing
          ? 'No parsed resume was found, so the interviewer will ask standard behavioural questions.'
          : 'Motivation, teamwork and communication — grounded in the experience on your resume.',
        bullets: [
          'Answer with concrete situations rather than general statements.',
          'Structure matters here: situation, what you did, what happened.',
          'Your full report is generated as soon as this round ends.',
        ],
      }}
      completeLabel="See my report"
      onComplete={(a) => void handleComplete(a)}
      onExit={() => navigate('/dashboard')}
    />
  );
}
