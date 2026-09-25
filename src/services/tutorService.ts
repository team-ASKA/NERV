/**
 * Tutor service (client). A thin client over `/api/tutor`: the persona and the
 * provider live on the server, the conversation lives here. No AI key touches
 * the browser.
 */

import { logger } from '../lib/logger';
import { authedFetch } from '../lib/authedFetch';

interface ResumeGraphData {
  skills?: string[];
  projects?: string[];
  experience?: string[];
  education?: string[];
  achievements?: string[];
}

export interface TutorSessionContext {
  resumeSkills: string[];
  interviewSummary: string;
  /** How many times each skill came up in the interview. Drives `weakSkills`. */
  skillMentions: Record<string, number>;
  weakSkills: string[];
  currentTopic: string | null;
  resumeData?: ResumeGraphData;
}

interface TutorTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Turns kept client-side and replayed to the stateless endpoint. */
const HISTORY_LIMIT = 10;

export class TutorService {
  private history: TutorTurn[] = [];
  private context: TutorSessionContext | null = null;
  private degraded = false;

  /** True once the server has reported that the tutor is unavailable. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  initSession(ctx: TutorSessionContext): void {
    this.context = ctx;
    this.history = [];
    this.degraded = false;
  }

  async sendMessage(message: string): Promise<string> {
    if (!this.context) throw new Error('Tutor session not initialized');

    const payload = {
      message,
      history: this.history.slice(-HISTORY_LIMIT),
      context: {
        resumeSkills: this.context.resumeSkills,
        interviewSummary: this.context.interviewSummary,
        weakSkills: this.context.weakSkills,
        currentTopic: this.context.currentTopic,
        resume: this.context.resumeData,
      },
    };

    let reply = '';
    try {
      const res = await authedFetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Tutor ${res.status}: ${detail.slice(0, 200)}`);
      }

      const data = (await res.json()) as { reply?: string; degraded?: boolean };
      this.degraded = Boolean(data.degraded);
      reply = (data.reply || '').trim();
    } catch (err) {
      logger.warn('[tutor] request failed:', (err as Error)?.message);
      this.degraded = true;
      reply = 'I could not reach the tutor just now. Check your connection and try again.';
    }

    if (!reply) reply = 'Could you rephrase that?';

    // Record both sides so the next turn has context.
    this.history.push({ role: 'user', content: message });
    this.history.push({ role: 'assistant', content: reply });
    if (this.history.length > HISTORY_LIMIT * 2) {
      this.history = this.history.slice(-HISTORY_LIMIT * 2);
    }

    return reply;
  }

  async focusOnTopic(topic: string): Promise<string> {
    if (!this.context) throw new Error('Tutor session not initialized');
    this.context.currentTopic = topic;
    return this.sendMessage(
      `I want to learn about "${topic}". Introduce the concept briefly, give one real-world analogy tied to my background, then ask what I already know about it.`,
    );
  }

  async generateQuizForTopic(topic: string): Promise<string> {
    return this.sendMessage(
      `Give me a 4-question multiple choice quiz on "${topic}" at intermediate software-engineering level. Use the strict quiz format: numbered questions, options A. B. C. D., an "Answer:" line and an "Explanation:" line for each. No intro or outro text.`,
    );
  }

  getSessionStats() {
    return {
      messageCount: this.history.length,
      currentTopic: this.context?.currentTopic ?? null,
    };
  }

  resetSession(): void {
    this.history = [];
    this.degraded = false;
    if (this.context) this.context.currentTopic = null;
  }
}

export const tutorService = new TutorService();
