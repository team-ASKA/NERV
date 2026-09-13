/**
 * Confidence across the interview, question by question.
 *
 * Questions where facial analysis did not produce a reading are rendered as
 * gaps in the line (`spanGaps: false`) rather than interpolated — an absent
 * measurement should look absent.
 *
 * Chart.js is heavy, so this module is only ever reached through `React.lazy`
 * and stays out of the initial bundle.
 */

import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { QuestionRecord } from '../../lib/reportData';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const ACCENT = '#6366F1';
const GRID = 'rgba(255, 255, 255, 0.06)';
const TEXT = '#9CA3AF';

export interface EmotionTimelineProps {
  questions: QuestionRecord[];
  height?: number;
}

export function EmotionTimeline({ questions, height = 240 }: EmotionTimelineProps) {
  const labels = questions.map((q) => `Q${q.number}${questions.some((o) => o.round !== q.round) ? ` · ${q.roundLabel.split(' ')[0]}` : ''}`);
  const values = questions.map((q) => (q.signal ? q.signal.confidence : null));

  const data = {
    labels,
    datasets: [
      {
        label: 'Confidence',
        data: values,
        borderColor: ACCENT,
        backgroundColor: 'rgba(99, 102, 241, 0.16)',
        pointBackgroundColor: ACCENT,
        pointBorderColor: '#101013',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.32,
        fill: true,
        // An unmeasured question breaks the line instead of being guessed at.
        spanGaps: false,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1D1D23',
        borderColor: 'rgba(255,255,255,0.12)',
        borderWidth: 1,
        titleColor: '#FFFFFF',
        bodyColor: '#D1D5DB',
        padding: 12,
        displayColors: false,
        callbacks: {
          title: (items: TooltipItem<'line'>[]) => {
            const q = questions[items[0]?.dataIndex ?? 0];
            return q ? `${q.roundLabel} · Question ${q.number}` : '';
          },
          label: (item: TooltipItem<'line'>) => {
            const q = questions[item.dataIndex];
            if (!q?.signal) return 'No reading';
            return [`Confidence ${q.signal.confidence}%`, `Dominant: ${q.signal.dominant}`];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: GRID },
        ticks: { color: TEXT, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
        border: { display: false },
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: GRID },
        ticks: { color: TEXT, font: { size: 11 }, stepSize: 25, callback: (v) => `${v}%` },
        border: { display: false },
      },
    },
  };

  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
}

export default EmotionTimeline;
