import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, Mic, MicOff, Volume2, VolumeX, Brain,
  Loader2, Trophy, HelpCircle, ChevronRight,
  Activity, Target, Sparkles, X, CheckCircle2, XCircle, Send
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { KnowledgeGraph, GraphData } from '../components/KnowledgeGraph';
import { InterviewerAvatar } from '../components/InterviewerAvatar';
import { tutorService } from '../services/tutorService';
import { sarvamTTS as azureTTS } from '../services/sarvamTTSService';
import { sarvamSTT as whisperService } from '../services/sarvamSTTService';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  isQuiz?: boolean;
}

// Structured MCQ type for interactive quiz
interface QuizQuestion {
  question: string;
  options: { label: string; text: string }[];
  correctIndex: number;
  explanation: string;
}

interface TrainingSessionState {
  interviewId?: string;
  summaryMarkdown?: string;
  resumeSkills?: string[];
  skillMentions?: Record<string, number>;
  totalQuestions?: number;
}

function buildSkillGraph(
  skills: string[],
  mentionCounts: Record<string, number>,
  totalQs: number
): GraphData {
  if (!skills || skills.length === 0) return { nodes: [], edges: [] };

  const rootNode = { id: 'root', label: 'Skills', level: 0 };
  const categories: Record<string, string[]> = {
    Frontend: [], Backend: [], Database: [], DevOps: [], Other: [],
  };

  const frontendKw = ['react', 'vue', 'angular', 'css', 'html', 'typescript', 'javascript', 'next', 'tailwind', 'redux', 'svelte'];
  const backendKw = ['node', 'express', 'python', 'java', 'spring', 'django', 'flask', 'rust', 'go', 'c++', 'c#', '.net', 'fastapi', 'api'];
  const dbKw = ['sql', 'mongo', 'postgres', 'mysql', 'redis', 'firebase', 'supabase', 'dynamodb', 'graphql', 'database'];
  const devopsKw = ['docker', 'kubernetes', 'aws', 'gcp', 'azure', 'ci', 'cd', 'linux', 'nginx', 'terraform', 'cloud'];

  skills.forEach((skill) => {
    const low = skill.toLowerCase();
    if (frontendKw.some((k) => low.includes(k))) categories.Frontend.push(skill);
    else if (backendKw.some((k) => low.includes(k))) categories.Backend.push(skill);
    else if (dbKw.some((k) => low.includes(k))) categories.Database.push(skill);
    else if (devopsKw.some((k) => low.includes(k))) categories.DevOps.push(skill);
    else categories.Other.push(skill);
  });

  const nodes: GraphData['nodes'] = [rootNode];
  const edges: GraphData['edges'] = [];

  Object.entries(categories).forEach(([cat, catSkills]) => {
    if (catSkills.length === 0) return;
    const catId = `cat_${cat}`;
    nodes.push({ id: catId, label: cat, level: 1 });
    edges.push({ from: 'root', to: catId });
    catSkills.forEach((skill) => {
      const skillId = `skill_${skill}`;
      nodes.push({ id: skillId, label: skill, level: 2, mentionCount: mentionCounts[skill] || 0, totalQuestions: totalQs || 1 });
      edges.push({ from: catId, to: skillId });
    });
  });

  return { nodes, edges };
}

/** Parse the tutor's raw quiz text into structured MCQ objects. */
function parseQuizFromText(raw: string): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  // Split by numbered question markers: "1.", "2.", etc.
  const blocks = raw.split(/\n(?=\d+[\.\)])/g).filter(b => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    const question = lines[0].replace(/^\d+[\.\)]\s*/, '').trim();
    const options: { label: string; text: string }[] = [];
    let correctIndex = 0;
    let explanation = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const optMatch = line.match(/^([A-D])[\.\)]\s*(.+)/i);
      if (optMatch) {
        options.push({ label: optMatch[1].toUpperCase(), text: optMatch[2].trim() });
      }
      const answerMatch = line.match(/(?:answer|correct)[:\s]+([A-D])/i);
      if (answerMatch) {
        correctIndex = ['A', 'B', 'C', 'D'].indexOf(answerMatch[1].toUpperCase());
      }
      if (line.toLowerCase().startsWith('explanation:')) {
        explanation = line.replace(/^explanation:\s*/i, '').trim();
      }
    }

    if (question && options.length >= 2) {
      questions.push({ question, options, correctIndex: Math.max(0, correctIndex), explanation });
    }
  }

  return questions;
}

// ─── Interactive Quiz Panel ──────────────────────────────────────────────────
interface QuizPanelProps {
  topic: string;
  rawQuiz: string;
  onClose: () => void;
  onReveal: (score: number, total: number) => void;
}

const QuizPanel: React.FC<QuizPanelProps> = ({ topic, rawQuiz, onClose, onReveal }) => {
  const questions = React.useMemo(() => parseQuizFromText(rawQuiz), [rawQuiz]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState(false);

  const handleSelect = (qIdx: number, optIdx: number) => {
    if (revealed) return;
    setAnswers(prev => ({ ...prev, [qIdx]: optIdx }));
  };

  const handleReveal = () => {
    setRevealed(true);
    const score = questions.reduce((acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0), 0);
    onReveal(score, questions.length);
  };

  const allAnswered = Object.keys(answers).length === questions.length;
  const score = revealed
    ? questions.reduce((acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0), 0)
    : 0;

  // Fallback to raw markdown if parsing fails  
  if (questions.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-yellow-400" />
            <h3 className="font-bold text-sm uppercase tracking-wider">Quiz: {topic}</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{rawQuiz}</ReactMarkdown>
        </div>
        <div className="p-4 border-t border-white/10">
          <button onClick={onClose} className="w-full py-2.5 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-sm rounded-xl transition-all">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-yellow-400" />
          <h3 className="font-bold text-sm uppercase tracking-wider">Quiz: {topic}</h3>
        </div>
        <div className="flex items-center gap-3">
          {revealed && (
            <span className="text-sm font-bold text-yellow-400">{score}/{questions.length}</span>
          )}
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Questions */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-3 p-4 rounded-xl border ${
              score === questions.length
                ? 'bg-green-500/10 border-green-500/30'
                : score >= questions.length / 2
                ? 'bg-yellow-500/10 border-yellow-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            <Trophy className={`h-5 w-5 flex-shrink-0 ${score === questions.length ? 'text-green-400' : score >= questions.length / 2 ? 'text-yellow-400' : 'text-red-400'}`} />
            <div>
              <p className="font-bold text-sm">
                {score === questions.length ? 'Perfect score!' : score >= questions.length / 2 ? 'Good attempt!' : 'Keep practicing!'}
              </p>
              <p className="text-xs text-white/50">{score} of {questions.length} correct</p>
            </div>
          </motion.div>
        )}

        {questions.map((q, qIdx) => (
          <div key={qIdx} className="space-y-2.5">
            <p className="text-sm font-semibold text-white leading-relaxed">
              <span className="text-yellow-400 mr-2">{qIdx + 1}.</span>{q.question}
            </p>
            <div className="space-y-1.5">
              {q.options.map((opt, optIdx) => {
                const isSelected = answers[qIdx] === optIdx;
                const isCorrect = q.correctIndex === optIdx;
                let style = 'bg-white/[0.03] border-white/10 text-white/60 hover:bg-white/[0.07] hover:border-white/20 hover:text-white';
                if (!revealed) {
                  if (isSelected) style = 'bg-yellow-500/15 border-yellow-500/40 text-white';
                } else {
                  if (isCorrect) style = 'bg-green-500/15 border-green-500/40 text-white';
                  else if (isSelected && !isCorrect) style = 'bg-red-500/10 border-red-500/30 text-white/60';
                }

                return (
                  <button
                    key={optIdx}
                    onClick={() => handleSelect(qIdx, optIdx)}
                    disabled={revealed}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left text-sm transition-all ${style} disabled:cursor-default`}
                  >
                    <span className="font-bold text-[11px] w-5 flex-shrink-0 text-center opacity-60">{opt.label}</span>
                    <span className="flex-1">{opt.text}</span>
                    {revealed && isCorrect && <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />}
                    {revealed && isSelected && !isCorrect && <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
            {revealed && q.explanation && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-white/50 bg-white/[0.04] border border-white/8 rounded-lg px-3 py-2 leading-relaxed"
              >
                <span className="text-white/30 font-bold uppercase tracking-wider text-[9px] block mb-0.5">Explanation</span>
                {q.explanation}
              </motion.div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 flex-shrink-0">
        {!revealed ? (
          <button
            onClick={handleReveal}
            disabled={!allAnswered}
            className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-sm rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {allAnswered ? 'Reveal Answers' : `Answer all ${questions.length} questions first`}
          </button>
        ) : (
          <button
            onClick={onClose}
            className="w-full py-3 bg-white/10 hover:bg-white/15 text-white font-bold text-sm rounded-xl transition-all border border-white/10"
          >
            Close Quiz
          </button>
        )}
      </div>
    </div>
  );
};


// ─── Main Component ───────────────────────────────────────────────────────────
const TrainingSession: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as TrainingSessionState) || {};

  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | number | null>(null);
  const [activeTopicLabel, setActiveTopicLabel] = useState<string | null>(null);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizRawText, setQuizRawText] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState<'graph' | 'topics'>('graph');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const graphData = React.useMemo(() => {
    return buildSkillGraph(
      state.resumeSkills || [],
      state.skillMentions || {},
      state.totalQuestions || 10
    );
  }, [state.resumeSkills, state.skillMentions, state.totalQuestions]);

  const weakSkills = React.useMemo(() => {
    return (state.resumeSkills || []).filter(s => (state.skillMentions?.[s] || 0) < 2);
  }, [state.resumeSkills, state.skillMentions]);

  useEffect(() => {
    tutorService.initSession({
      resumeSkills: state.resumeSkills || [],
      interviewSummary: state.summaryMarkdown || 'No summary available.',
      skillMentions: state.skillMentions || {},
      weakSkills,
      currentTopic: null,
    });
  }, [state, weakSkills]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => azureTTS.stop();
  }, []);

  const speakMessage = useCallback(async (text: string) => {
    if (isMuted) return;
    try {
      setIsAvatarSpeaking(true);
      await azureTTS.speak(text, 'hr');
    } catch { /* silent */ } finally {
      setIsAvatarSpeaking(false);
    }
  }, [isMuted]);

  const addAIMessage = useCallback(async (text: string, isQuiz = false) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(), text, sender: 'ai', timestamp: new Date(), isQuiz,
    }]);
    if (!isQuiz) await speakMessage(text);
  }, [speakMessage]);

  const startSession = async () => {
    setSessionActive(true);
    setIsLoading(true);
    try {
      const intro = await tutorService.sendMessage(
        `Start the tutoring session. Briefly introduce yourself as NERV Tutor, mention the candidate's weakest skills (${weakSkills.slice(0, 3).join(', ') || 'general concepts'}), and invite them to click a skill node or ask a question.`
      );
      await addAIMessage(intro);
    } catch {
      await addAIMessage('Welcome to Training Mode! Click any skill node on the left or type a question to begin.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNodeSelect = useCallback(async (nodeId: string | number, label: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node || node.level !== 2) return;

    setActiveNodeId(nodeId);
    setActiveTopicLabel(label);
    setIsLoading(true);
    setMessages(prev => [...prev, {
      id: Date.now().toString(), text: `Topic selected: **${label}**`, sender: 'user', timestamp: new Date(),
    }]);

    try {
      const response = await tutorService.focusOnTopic(label);
      await addAIMessage(response);
    } catch {
      await addAIMessage(`Let's explore ${label}! What do you already know about it?`);
    } finally {
      setIsLoading(false);
    }
  }, [graphData, addAIMessage]);

  const handleNodeQuiz = useCallback(async (label: string) => {
    setActiveTopicLabel(label);
    setIsLoading(true);
    try {
      const quiz = await tutorService.generateQuizForTopic(label);
      setQuizRawText(quiz);
      setShowQuiz(true);
    } catch { /* silent */ } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || !sessionActive || isLoading) return;
    setMessages(prev => [...prev, {
      id: Date.now().toString(), text, sender: 'user', timestamp: new Date(),
    }]);
    setChatInput('');
    setIsLoading(true);
    try {
      const response = await tutorService.sendMessage(text);
      await addAIMessage(response);
    } catch {
      await addAIMessage("I'm having trouble connecting. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        try {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const transcript = await whisperService.transcribeAudio(blob);
          if (transcript) handleSendMessage(transcript);
        } catch { /* silent */ }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch { /* mic denied */ }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleQuizReveal = (score: number, total: number) => {
    setTimeout(() => {
      addAIMessage(`Quiz completed! You scored ${score}/${total}. ${score === total ? "Perfect! Let's move on to a deeper concept." : "Let me explain the ones you missed."}`);
    }, 500);
  };

  return (
    // Outer: fixed full-screen, no page scroll
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="flex-shrink-0 bg-black/90 backdrop-blur-sm border-b border-white/10 px-4 py-3 z-40">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-sm font-black uppercase tracking-wider leading-none">
                NERV <span className="text-white/30">/</span>{' '}
                <span className="text-yellow-400">Training Mode</span>
              </h1>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">Personalised AI Tutor Session</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTopicLabel && (
              <motion.div
                initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-full"
              >
                <Activity className="h-3 w-3 text-yellow-400" />
                <span className="text-yellow-400 text-xs font-semibold">{activeTopicLabel}</span>
              </motion.div>
            )}
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-2 rounded-xl transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/5 hover:bg-white/10 text-white/60'}`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Body: three-column layout ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── LEFT: Knowledge Graph Panel ── */}
        <div className="w-72 flex-shrink-0 border-r border-white/10 flex flex-col bg-black min-h-0">
          {/* Tabs */}
          <div className="flex border-b border-white/10 flex-shrink-0">
            {(['graph', 'topics'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setLeftPanelTab(tab)}
                className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
                  leftPanelTab === tab ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab === 'graph' ? <Brain className="h-3 w-3" /> : <Target className="h-3 w-3" />}
                {tab === 'graph' ? 'Graph' : 'Focus Areas'}
              </button>
            ))}
          </div>

          {leftPanelTab === 'graph' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              {graphData.nodes.length > 0 ? (
                <KnowledgeGraph
                  data={graphData}
                  activeNodeId={activeNodeId}
                  onNodeSelect={handleNodeSelect}
                  onNodeQuiz={handleNodeQuiz}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
                  <Brain className="h-10 w-10 text-white/15" />
                  <p className="text-white/30 text-xs leading-relaxed">
                    No resume skills found. Start a training session from an interview with a resume attached.
                  </p>
                </div>
              )}
            </div>
          )}

          {leftPanelTab === 'topics' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
              {weakSkills.length > 0 && (
                <>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-yellow-500/70 px-1 mb-2 pt-1">
                    Needs Attention
                  </p>
                  {weakSkills.map(skill => (
                    <button
                      key={skill}
                      onClick={() => {
                        const node = graphData.nodes.find(n => n.label === skill);
                        if (node) handleNodeSelect(node.id, skill);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-xl hover:bg-yellow-500/10 hover:border-yellow-500/40 transition-all text-left group"
                    >
                      <span className="text-white/80 text-xs font-medium">{skill}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-yellow-500/40 group-hover:text-yellow-400 transition-colors" />
                    </button>
                  ))}
                </>
              )}
              {(state.resumeSkills || []).filter(s => !weakSkills.includes(s)).length > 0 && (
                <>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-green-500/60 px-1 mt-4 mb-2">
                    Covered in Interview
                  </p>
                  {(state.resumeSkills || []).filter(s => !weakSkills.includes(s)).map(skill => (
                    <button
                      key={skill}
                      onClick={() => {
                        const node = graphData.nodes.find(n => n.label === skill);
                        if (node) handleNodeSelect(node.id, skill);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-white/[0.02] border border-white/10 rounded-xl hover:bg-white/[0.05] transition-all text-left group"
                    >
                      <span className="text-white/50 text-xs font-medium">{skill}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/20 group-hover:text-white/50 transition-colors" />
                    </button>
                  ))}
                </>
              )}
              {(!state.resumeSkills || state.resumeSkills.length === 0) && (
                <p className="text-white/25 text-xs text-center pt-8">No skills data available.</p>
              )}
            </div>
          )}
        </div>

        {/* ── CENTRE: Chat ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-r border-white/10">

          {/* Chat — fills remaining space, scrolls internally */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {messages.length === 0 && sessionActive && (
              <div className="flex justify-center pt-4">
                <span className="text-white/25 text-xs">Session started — ask anything or click a skill node</span>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map(msg => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} gap-2`}
                >
                  {msg.sender === 'ai' && (
                    <div className="w-7 h-7 rounded-lg bg-yellow-500/15 border border-yellow-500/25 flex items-center justify-center flex-shrink-0 mt-1">
                      <Brain className="h-3.5 w-3.5 text-yellow-400" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-white/10 text-white rounded-tr-sm'
                        : msg.isQuiz
                        ? 'bg-yellow-500/10 border border-yellow-500/20 text-white/90 rounded-tl-sm'
                        : 'bg-white/[0.05] border border-white/10 text-white/90 rounded-tl-sm'
                    }`}
                  >
                    {msg.isQuiz ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 mb-2">
                          <HelpCircle className="h-3.5 w-3.5 text-yellow-400" />
                          <span className="text-yellow-400 text-[10px] font-bold uppercase tracking-wider">Quiz</span>
                        </div>
                        <div className="prose prose-invert prose-sm max-w-none text-white/70">
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && (
              <div className="flex items-center gap-2 pl-9">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 bg-yellow-400/40 rounded-full"
                    animate={{ scale: [1, 1.6, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.22 }}
                  />
                ))}
                <span className="text-white/30 text-xs ml-1">Tutor thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar — always visible at bottom */}
          <div className="flex-shrink-0 border-t border-white/10 bg-black/70 backdrop-blur-sm px-4 pt-3 pb-4">
            {/* Quick chips */}
            {sessionActive && messages.length > 0 && (
              <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-none">
                {['Explain with an example', 'Give me a quiz', 'What should I practice?', 'Summarise what we covered'].map(chip => (
                  <button
                    key={chip}
                    onClick={() => handleSendMessage(chip)}
                    disabled={isLoading}
                    className="flex-shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/50 hover:text-white text-[11px] rounded-full transition-all disabled:opacity-30"
                  >
                    {chip}
                  </button>
                ))}
                {activeTopicLabel && (
                  <button
                    onClick={() => handleNodeQuiz(activeTopicLabel)}
                    disabled={isLoading}
                    className="flex-shrink-0 px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/25 text-yellow-400 text-[11px] rounded-full transition-all disabled:opacity-30"
                  >
                    Quiz on {activeTopicLabel}
                  </button>
                )}
              </div>
            )}

            {/* Text input row */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!sessionActive || isLoading}
                className={`flex-shrink-0 p-3 rounded-xl border transition-all ${
                  isRecording
                    ? 'bg-red-500/20 border-red-500/40 text-red-400 animate-pulse'
                    : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/50 hover:text-white'
                } disabled:opacity-30`}
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>

              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage(chatInput)}
                placeholder={sessionActive ? 'Ask your tutor anything...' : 'Start the session first'}
                disabled={!sessionActive || isLoading}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-yellow-500/40 focus:bg-white/[0.07] transition-all disabled:opacity-30"
              />

              <button
                onClick={() => handleSendMessage(chatInput)}
                disabled={!sessionActive || isLoading || !chatInput.trim()}
                className="flex-shrink-0 p-3 bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:scale-100"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            {/* Session quick actions */}
            {sessionActive && (
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => handleSendMessage("Give me a summary of what we've covered so far and my weak points.")}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/35 hover:text-white/70 border border-white/10 hover:border-white/20 rounded-lg transition-all disabled:opacity-30"
                >
                  <Trophy className="h-3 w-3" /> Session Summary
                </button>
                <button
                  onClick={() => { tutorService.resetSession(); setMessages([]); setSessionActive(false); setActiveTopicLabel(null); setActiveNodeId(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500/50 hover:text-red-400 border border-red-500/10 hover:border-red-500/30 rounded-lg transition-all"
                >
                  <X className="h-3 w-3" /> Reset
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Avatar + Quiz Drawer ── */}
        <div className="w-[380px] flex-shrink-0 bg-[#0c0c0c] flex flex-col min-h-0 overflow-hidden">
          
          {/* Avatar Box — fixed height, aspect-video format */}
          <div className="flex-shrink-0 p-4 border-b border-white/10">
            <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden border border-white/10 shadow-2xl relative group">
              {sessionActive ? (
                <div className="w-full h-full relative overflow-hidden">
                  <InterviewerAvatar
                    isAvatarSpeaking={isAvatarSpeaking}
                    isUserSpeaking={isRecording}
                    accentColor="blue"
                  />
                  {/* Status overlay */}
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 bg-black/70 border border-white/10 rounded-full backdrop-blur-sm">
                    {isAvatarSpeaking ? (
                      <>
                        {[0, 1, 2, 3].map(i => (
                          <motion.div
                            key={i}
                            className="w-[3px] bg-yellow-400 rounded-full"
                            animate={{ height: [4, 14, 4] }}
                            transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12 }}
                          />
                        ))}
                        <span className="text-[10px] text-yellow-400 ml-1.5 font-medium">Speaking</span>
                      </>
                    ) : isRecording ? (
                      <>
                        <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                        <span className="text-[10px] text-red-400 font-medium">Listening...</span>
                      </>
                    ) : (
                      <>
                        <div className="w-2 h-2 rounded-full bg-white/20" />
                        <span className="text-[10px] text-white/40 font-medium">NERV Tutor</span>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                // Pre-session splash
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-yellow-950/10 to-transparent">
                  <div className="relative mt-2">
                    <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
                      <Sparkles className="h-5 w-5 text-yellow-400" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full animate-pulse" />
                  </div>
                  <div className="text-center px-4">
                    <p className="text-white font-bold text-sm">NERV Tutor Ready</p>
                    <p className="text-white/40 text-[10px] mt-0.5">Personalised training from your interview data</p>
                  </div>
                  <button
                    onClick={startSession}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-4 py-2 mb-2 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-[10px] uppercase tracking-wider rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                    Start Training
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quiz Drawer - fits gracefully below avatar */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#0c0c0c]">
            <AnimatePresence>
              {showQuiz ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="flex-1 flex flex-col min-h-0 overflow-hidden"
                >
                  <QuizPanel
                    topic={activeTopicLabel || 'Quiz'}
                    rawQuiz={quizRawText}
                    onClose={() => setShowQuiz(false)}
                    onReveal={handleQuizReveal}
                  />
                </motion.div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-6 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Target className="h-10 w-10 text-white/5" />
                    <p className="text-white/20 text-xs text-balance">Request a quiz from your tutor to test your knowledge.</p>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>
    </div>
  );
};

export default TrainingSession;
