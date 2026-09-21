/**
 * Dashboard — the authenticated home.
 *
 * Three things live here: the resume that grounds every interview question,
 * the button that starts an interview, and the history of past sessions.
 *
 * Data ownership follows the rest of the app: Firebase holds auth + the small
 * profile document, Supabase holds interviews and the parsed resume,
 * localStorage is only ever a cache written by `resumeService`. The previous
 * version of this page extracted every uploaded PDF twice (once here, once
 * again inside `extractAndSaveResume`) and hand-copied the parsed result back
 * into localStorage that the service had already written — both are gone.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Gauge,
  Globe,
  History,
  LayoutGrid,
  Link2,
  Linkedin,
  ListChecks,
  MessageSquare,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { cn } from '../lib/cn';
import { logger } from '../lib/logger';
import { resumeCompleteness } from '../lib/reportData';
import { extractAndSaveResume } from '../services/resumeService';
import { IngestPendingError } from '../services/resumeIngestService';
import {
  supabaseInterviewService,
  type InterviewRecord,
} from '../services/supabaseInterviewService';
import { getResumeData, type ResumeData } from '../services/firebaseResumeService';
import { AppShell } from '../components/AppShell';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  ProgressBar,
  SectionHeader,
  Spinner,
  StatTile,
  useToast,
} from '../components/ui';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const PAGE_SIZE = 5;

type TabId = 'overview' | 'history' | 'training';

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'history', label: 'Interview history', icon: History },
  { id: 'training', label: 'Training', icon: Brain },
];

interface UserProfile {
  displayName?: string;
  name?: string;
  email?: string;
  location?: string;
  experience?: string;
  education?: string;
  expectedSalary?: string;
  linkedin?: string;
  portfolio?: string;
  skills?: string[];
  resumeURL?: string | null;
  resumeName?: string | null;
}

interface ProfileForm {
  displayName: string;
  location: string;
  experience: string;
  education: string;
  expectedSalary: string;
  linkedin: string;
  portfolio: string;
  skills: string;
}

const EMPTY_FORM: ProfileForm = {
  displayName: '',
  location: '',
  experience: '',
  education: '',
  expectedSalary: '',
  linkedin: '',
  portfolio: '',
  skills: '',
};

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

function recordDate(row: InterviewRecord): Date | null {
  if (!row.created_at) return null;
  const d = new Date(row.created_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Questions asked in a stored session. Reads the v2 payload first, then the
 * metrics blob; returns 0 rather than guessing when neither is present.
 * (The old code did `questions_data?.length || 10`, which silently reported
 * "10 questions" for every session once the payload became an object.)
 */
function questionCount(row: InterviewRecord): number {
  const data = row.questions_data as { totalQuestions?: unknown } | null | undefined;
  if (data && typeof data.totalQuestions === 'number') return data.totalQuestions;
  const metrics = row.metrics as { totalQuestions?: unknown } | null | undefined;
  if (metrics && typeof metrics.totalQuestions === 'number') return metrics.totalQuestions;
  return 0;
}

/** `overall_confidence` is stored as -1 when facial analysis never ran. */
function measuredConfidence(row: InterviewRecord): number | null {
  const value = row.overall_confidence;
  return typeof value === 'number' && value >= 0 ? value : null;
}

function summaryLine(row: InterviewRecord): string {
  const line = (row.summary_markdown || '')
    .split('\n')
    .map((l) => l.replace(/[#*`>_]/g, '').trim())
    .find((l) => l.length > 0);
  return line || 'Interview completed';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [resume, setResume] = useState<ResumeData | null>(null);
  const [loadingResume, setLoadingResume] = useState(true);

  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [loadingInterviews, setLoadingInterviews] = useState(true);

  const [tab, setTab] = useState<TabId>('overview');
  const [page, setPage] = useState(1);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Ingestion is a queued job, so "uploading" can mean any of several stages.
  // The label comes straight from the job status the server reports.
  const [uploadStage, setUploadStage] = useState('');

  const [resumeLink, setResumeLink] = useState('');
  const [savingLink, setSavingLink] = useState(false);

  const [profileOpen, setProfileOpen] = useState(false);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [savingProfile, setSavingProfile] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<InterviewRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- loading ------------------------------------------------------------

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;

    (async () => {
      try {
        const ref = doc(db, 'users', currentUser.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          if (cancelled) return;
          setProfile(data);
          setResumeLink(data.resumeURL ?? '');
          setForm({
            displayName: data.displayName ?? data.name ?? '',
            location: data.location ?? '',
            experience: data.experience ?? '',
            education: data.education ?? '',
            expectedSalary: data.expectedSalary ?? '',
            linkedin: data.linkedin ?? '',
            portfolio: data.portfolio ?? '',
            skills: Array.isArray(data.skills) ? data.skills.join(', ') : '',
          });
        } else {
          const seed: UserProfile & { createdAt: Timestamp; photoURL: string } = {
            name: currentUser.displayName ?? '',
            displayName: currentUser.displayName ?? '',
            email: currentUser.email ?? '',
            photoURL: currentUser.photoURL ?? '',
            resumeURL: null,
            resumeName: null,
            skills: [],
            createdAt: Timestamp.now(),
          };
          await setDoc(ref, seed);
          if (!cancelled) setProfile(seed);
        }
      } catch (err) {
        logger.warn('[dashboard] profile load failed:', (err as Error)?.message);
        if (!cancelled) toast.error('Could not load your profile. Some details may be missing.');
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();

    (async () => {
      try {
        const rows = await supabaseInterviewService.getUserInterviews(currentUser.uid);
        if (!cancelled) setInterviews(rows);
      } catch (err) {
        logger.warn('[dashboard] interview history failed:', (err as Error)?.message);
        if (!cancelled) toast.error('Could not load your interview history.');
      } finally {
        if (!cancelled) setLoadingInterviews(false);
      }
    })();

    (async () => {
      try {
        const data = await getResumeData(currentUser.uid);
        if (!cancelled) setResume(data);
      } finally {
        if (!cancelled) setLoadingResume(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `toast` is stable (memoised in the provider); re-running on identity
    // changes would refetch the whole dashboard on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // --- derived ------------------------------------------------------------

  const resumeStrength = useMemo(() => resumeCompleteness(resume), [resume]);
  const skillCount = resume?.skills?.length ?? 0;

  const totalQuestions = useMemo(
    () => interviews.reduce((sum, row) => sum + questionCount(row), 0),
    [interviews],
  );

  const avgConfidence = useMemo(() => {
    const measured = interviews.map(measuredConfidence).filter((v): v is number => v !== null);
    if (measured.length === 0) return null;
    return {
      value: Math.round(measured.reduce((a, b) => a + b, 0) / measured.length),
      sessions: measured.length,
    };
  }, [interviews]);

  const lastSession = useMemo(() => {
    const dates = interviews.map(recordDate).filter((d): d is Date => d !== null);
    return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  }, [interviews]);

  const totalPages = Math.max(1, Math.ceil(interviews.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => interviews.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [interviews, page],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // --- resume -------------------------------------------------------------

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!selected) return;

    if (selected.type !== 'application/pdf') {
      toast.error('Please choose a PDF file.');
      return;
    }
    if (selected.size > MAX_RESUME_BYTES) {
      toast.error('That file is over 5 MB. Please upload a smaller PDF.');
      return;
    }
    setFile(selected);
  };

  const uploadResume = useCallback(async () => {
    if (!file || !currentUser) return;
    setUploading(true);
    setUploadStage('Reading your file');
    try {
      // One call does the whole path. Preferred route is the ingestion queue
      // (direct upload → worker extraction → parsed resume); it falls back to
      // the in-browser parser when the queue isn't deployed.
      const result = await extractAndSaveResume(currentUser.uid, file, (progress) =>
        setUploadStage(progress.label),
      );
      setResume(result.resumeData);

      try {
        await updateDoc(doc(db, 'users', currentUser.uid), { resumeName: file.name });
        setProfile((prev) => (prev ? { ...prev, resumeName: file.name } : prev));
      } catch (err) {
        logger.warn('[dashboard] could not record resume name:', (err as Error)?.message);
      }

      setFile(null);

      if (result.degraded) {
        toast.warning(
          result.reason ??
            'We read the file but could not pull structured details out of it. Questions will be general.',
        );
      } else if (result.saveFailed) {
        toast.warning('Resume parsed, but saving it to your account failed. It will still be used on this device.');
      } else {
        toast.success(
          `Resume parsed — ${result.resumeData.skills.length} skills, ${result.resumeData.projects.length} projects. Questions will be grounded in it.`,
        );
      }
    } catch (err) {
      // A job that outran the client is still running; the resume will be
      // waiting on the next visit, so this is a warning rather than a failure.
      if (err instanceof IngestPendingError) {
        toast.warning(err.message);
      } else {
        toast.error((err as Error)?.message || 'Could not process that PDF. Please try another file.');
      }
    } finally {
      setUploading(false);
      setUploadStage('');
    }
  }, [file, currentUser, toast]);

  const saveResumeLink = useCallback(async () => {
    if (!currentUser) return;
    const value = resumeLink.trim();
    if (!value) return;
    try {
      new URL(value);
    } catch {
      toast.error('Please enter a full URL, including https://');
      return;
    }

    setSavingLink(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { resumeURL: value });
      setProfile((prev) => (prev ? { ...prev, resumeURL: value } : prev));
      toast.success('Resume link saved.');
    } catch (err) {
      logger.warn('[dashboard] resume link save failed:', (err as Error)?.message);
      toast.error('Could not save that link. Please try again.');
    } finally {
      setSavingLink(false);
    }
  }, [currentUser, resumeLink, toast]);

  // --- profile ------------------------------------------------------------

  const updateForm = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const saveProfile = useCallback(async () => {
    if (!currentUser) return;
    setSavingProfile(true);
    try {
      const skills = form.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const patch = {
        displayName: form.displayName,
        location: form.location,
        experience: form.experience,
        education: form.education,
        expectedSalary: form.expectedSalary,
        linkedin: form.linkedin,
        portfolio: form.portfolio,
        skills,
      };

      await updateDoc(doc(db, 'users', currentUser.uid), patch);
      setProfile((prev) => ({ ...(prev ?? {}), ...patch }));
      setProfileOpen(false);
      toast.success('Profile updated.');
    } catch (err) {
      logger.warn('[dashboard] profile save failed:', (err as Error)?.message);
      toast.error('Could not save your profile. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  }, [currentUser, form, toast]);

  // --- interview actions --------------------------------------------------

  const viewResults = useCallback(
    (row: InterviewRecord) => {
      navigate('/nerv-summary', {
        state: {
          isHistorical: true,
          interviewData: row,
          summary: row.summary_markdown,
        },
      });
    },
    [navigate],
  );

  const startTraining = useCallback(
    async (row: InterviewRecord) => {
      // Supabase is authoritative; `getResumeData` refreshes the local cache
      // itself, so there is nothing to copy back here.
      let data = resume;
      if (!data && currentUser) {
        try {
          data = await getResumeData(currentUser.uid);
        } catch {
          data = null;
        }
      }

      const metrics = (row.metrics ?? {}) as { skillMentions?: Record<string, number> };
      const skills = data?.skills?.length ? data.skills : profile?.skills ?? [];

      navigate('/training-session', {
        state: {
          interviewId: row.id,
          summaryMarkdown: row.summary_markdown,
          resumeSkills: skills,
          skillMentions: metrics.skillMentions ?? {},
          totalQuestions: questionCount(row),
          resumeData: data ?? { skills },
        },
      });
    },
    [currentUser, navigate, profile, resume],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete?.id || !currentUser) return;
    const id = pendingDelete.id;
    setDeleting(true);
    try {
      await supabaseInterviewService.deleteInterview(currentUser.uid, id);
      setInterviews((prev) => prev.filter((row) => row.id !== id));
      setPendingDelete(null);
      toast.success('Interview deleted.');
    } catch (err) {
      logger.warn('[dashboard] delete failed:', (err as Error)?.message);
      toast.error('Could not delete that interview. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [currentUser, pendingDelete, toast]);

  // --- render -------------------------------------------------------------

  const greetingName = (profile?.displayName || profile?.name || currentUser?.email?.split('@')[0] || '').trim();
  const hasResume = Boolean(resume && skillCount > 0);

  const startInterview = (
    <Button
      size="lg"
      rightIcon={<ArrowRight size={18} />}
      onClick={() => navigate('/multi-round-interview')}
    >
      Start interview
    </Button>
  );

  return (
    <AppShell>
      <SectionHeader
        eyebrow="Dashboard"
        title={greetingName ? `Welcome back, ${greetingName}` : 'Welcome back'}
        description="Three rounds — technical, core and HR — grounded in your own resume."
        actions={
          <>
            <Button variant="outline" leftIcon={<UserRound size={16} />} onClick={() => setProfileOpen(true)}>
              Profile
            </Button>
            {startInterview}
          </>
        }
      />

      {/* Stats */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Interviews"
          value={loadingInterviews ? '—' : interviews.length}
          icon={<History size={16} />}
          hint={lastSession ? `Last on ${dateFmt.format(lastSession)}` : 'No sessions yet'}
        />
        <StatTile
          label="Questions answered"
          value={loadingInterviews ? '—' : totalQuestions || '—'}
          icon={<MessageSquare size={16} />}
          hint={totalQuestions ? 'Across every saved session' : 'Complete a round to start counting'}
        />
        <StatTile
          label="Resume strength"
          value={loadingResume ? '—' : `${resumeStrength}%`}
          icon={<Gauge size={16} />}
          hint={hasResume ? `${skillCount} skills extracted` : 'Upload a resume to score it'}
        />
        <StatTile
          label="Avg. composure"
          value={avgConfidence ? `${avgConfidence.value}%` : 'Not measured'}
          icon={<Sparkles size={16} />}
          hint={
            avgConfidence
              ? `Measured in ${avgConfidence.sessions} of ${interviews.length} sessions`
              : 'Facial analysis has not run yet'
          }
        />
      </div>

      {/* Tabs */}
      <div className="mb-6 mt-8 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              tab === id ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white',
            )}
          >
            <Icon size={16} />
            {label}
            {id === 'history' && interviews.length > 0 && (
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-muted">
                {interviews.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Resume */}
          <Card className="lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                  <FileText size={18} className="text-accent-soft" />
                  Your resume
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every question in the interview is drawn from what is actually in here.
                </p>
              </div>
              {loadingResume ? (
                <Spinner size={18} />
              ) : hasResume ? (
                <Badge variant="success" dot>
                  Ready
                </Badge>
              ) : (
                <Badge variant="warning" dot>
                  Not set up
                </Badge>
              )}
            </div>

            {hasResume && (
              <div className="mt-5 rounded-xl border border-border bg-surface-raised p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">Resume strength</span>
                  <span className="text-sm font-semibold text-accent-soft">{resumeStrength}%</span>
                </div>
                <ProgressBar
                  className="mt-2"
                  value={resumeStrength}
                  tone={resumeStrength >= 70 ? 'success' : resumeStrength >= 40 ? 'warning' : 'danger'}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  A structural check of the sections we extracted — not an ATS engine.
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(resume?.skills ?? []).slice(0, 12).map((skill) => (
                    <Badge key={skill} variant="accent">
                      {skill}
                    </Badge>
                  ))}
                  {skillCount > 12 && <Badge variant="outline">+{skillCount - 12} more</Badge>}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {(
                    [
                      ['Projects', resume?.projects?.length ?? 0],
                      ['Experience', resume?.experience?.length ?? 0],
                      ['Education', resume?.education?.length ?? 0],
                      ['Achievements', resume?.achievements?.length ?? 0],
                    ] as const
                  ).map(([label, count]) => (
                    <div key={label}>
                      <div className="text-lg font-semibold text-white">{count}</div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload */}
            <div className="mt-5">
              <label
                htmlFor="resume-file"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-6 text-center transition-colors hover:border-border-strong hover:bg-white/[0.02]"
              >
                <Upload size={20} className="mb-2 text-muted" />
                <span className="text-sm font-medium text-white">
                  {hasResume ? 'Replace your resume' : 'Upload your resume'}
                </span>
                <span className="mt-0.5 text-xs text-muted-foreground">
                  Text-based PDF, up to 5 MB
                </span>
                <input
                  id="resume-file"
                  type="file"
                  accept="application/pdf"
                  onChange={pickFile}
                  className="hidden"
                />
              </label>

              {file && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2">
                  <span className="truncate text-sm text-white">{file.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" loading={uploading} onClick={uploadResume}>
                      {uploading ? 'Parsing…' : 'Parse resume'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      disabled={uploading}
                      className="rounded-lg p-1 text-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
                      aria-label="Remove selected file"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}

              {uploading && uploadStage && (
                <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                  {uploadStage}…
                </p>
              )}

              {profile?.resumeName && !file && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 size={12} className="text-success" />
                  Last upload: {profile.resumeName}
                </p>
              )}
            </div>

            {/* Optional public link */}
            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-2 text-sm text-muted-foreground">
                Optional: a shareable link to your resume. Recruiters see this; the interviewer does not read it.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={resumeLink}
                  onChange={(e) => setResumeLink(e.target.value)}
                  placeholder="https://drive.google.com/…"
                  leftIcon={<Link2 size={16} />}
                />
                <Button
                  variant="secondary"
                  loading={savingLink}
                  disabled={!resumeLink.trim()}
                  onClick={saveResumeLink}
                  className="sm:w-auto"
                >
                  Save link
                </Button>
              </div>
              {profile?.resumeURL && (
                <a
                  href={profile.resumeURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent-soft hover:text-accent"
                >
                  <ExternalLink size={12} />
                  Open current link
                </a>
              )}
            </div>
          </Card>

          {/* Right column */}
          <div className="space-y-6">
            <Card>
              <h3 className="text-lg font-semibold text-white">Ready when you are</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Technical, core and HR — one continuous session with voice, a code scratchpad and a
                report at the end.
              </p>

              <ul className="mt-4 space-y-2 text-sm text-muted">
                {[
                  'Questions grounded in your resume',
                  'Speak naturally — the mic ends your turn',
                  'Scratchpad for code, never executed',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
                    {item}
                  </li>
                ))}
              </ul>

              {!hasResume && !loadingResume && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-muted p-3 text-xs text-warning">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  Without a parsed resume the questions will be generic. Upload one first for the real thing.
                </div>
              )}

              <Button
                fullWidth
                className="mt-5"
                rightIcon={<ArrowRight size={16} />}
                onClick={() => navigate('/multi-round-interview')}
              >
                Start multi-round interview
              </Button>
            </Card>

            <Card>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold text-white">Profile</h3>
                <Button variant="ghost" size="sm" onClick={() => setProfileOpen(true)}>
                  Edit
                </Button>
              </div>

              {loadingProfile ? (
                <div className="mt-4 flex justify-center py-4">
                  <Spinner size={20} />
                </div>
              ) : (
                <dl className="mt-4 space-y-3 text-sm">
                  {(
                    [
                      ['Email', currentUser?.email ?? '—'],
                      ['Location', profile?.location || '—'],
                      ['Experience', profile?.experience || '—'],
                      ['Education', profile?.education || '—'],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="max-w-[60%] truncate text-right text-white">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {(profile?.linkedin || profile?.portfolio) && (
                <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4">
                  {profile?.linkedin && (
                    <a
                      href={profile.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-accent-soft hover:text-accent"
                    >
                      <Linkedin size={14} />
                      LinkedIn
                    </a>
                  )}
                  {profile?.portfolio && (
                    <a
                      href={profile.portfolio}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-accent-soft hover:text-accent"
                    >
                      <Globe size={14} />
                      Portfolio
                    </a>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          {loadingInterviews ? (
            <div className="flex justify-center py-16">
              <Spinner size={24} />
            </div>
          ) : interviews.length === 0 ? (
            <EmptyState
              icon={<History size={20} />}
              title="No interviews yet"
              description="Finish a session and it will appear here with its transcript, report and composure read."
              action={startInterview}
            />
          ) : (
            <>
              {pageRows.map((row) => {
                const when = recordDate(row);
                const questions = questionCount(row);
                const confidence = measuredConfidence(row);
                return (
                  <Card
                    key={row.id}
                    interactive
                    role="button"
                    tabIndex={0}
                    onClick={() => viewResults(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        viewResults(row);
                      }
                    }}
                    className="focus-visible:border-accent focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Calendar size={12} />
                          {when ? `${dateFmt.format(when)} · ${timeFmt.format(when)}` : 'Date unknown'}
                          {questions > 0 && (
                            <>
                              <span className="text-border-strong">•</span>
                              {questions} question{questions === 1 ? '' : 's'}
                            </>
                          )}
                          {row.total_duration_minutes > 0 && (
                            <>
                              <span className="text-border-strong">•</span>
                              {row.total_duration_minutes} min
                            </>
                          )}
                        </div>

                        <p className="mt-2 line-clamp-2 text-sm text-white">{summaryLine(row)}</p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {confidence !== null ? (
                            <Badge variant="accent">Composure {confidence}%</Badge>
                          ) : (
                            <Badge variant="outline">Composure not measured</Badge>
                          )}
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-soft">
                            <ExternalLink size={12} />
                            View report
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          leftIcon={<Brain size={14} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            void startTraining(row);
                          }}
                        >
                          Train
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Delete interview"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(row);
                          }}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 pt-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Previous page"
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={18} />
                  </Button>
                  <span className="text-sm text-muted">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Next page"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight size={18} />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'training' && (
        <div className="space-y-6">
          <Card>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Brain size={18} className="text-accent-soft" />
              AI tutor
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a session and the tutor drills the topics you skipped or stumbled on — using that
              interview's own report as the brief.
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              leftIcon={<ListChecks size={16} />}
              onClick={() => navigate('/training-session')}
            >
              Open a free-form session
            </Button>
          </Card>

          {loadingInterviews ? (
            <div className="flex justify-center py-16">
              <Spinner size={24} />
            </div>
          ) : interviews.length === 0 ? (
            <EmptyState
              icon={<Brain size={20} />}
              title="Nothing to train on yet"
              description="Complete an interview first — the tutor works from the gaps your report identifies."
              action={startInterview}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {interviews.map((row, index) => {
                const when = recordDate(row);
                const gaps = ((row.metrics ?? {}) as { skillGaps?: string[] }).skillGaps ?? [];
                return (
                  <Card key={`train-${row.id}`} className="flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-semibold text-white">Session #{interviews.length - index}</h4>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {when ? dateFmt.format(when) : '—'}
                      </span>
                    </div>

                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{summaryLine(row)}</p>

                    {gaps.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {gaps.slice(0, 4).map((gap) => (
                          <Badge key={gap} variant="warning">
                            {gap}
                          </Badge>
                        ))}
                        {gaps.length > 4 && <Badge variant="outline">+{gaps.length - 4}</Badge>}
                      </div>
                    )}

                    <Button
                      fullWidth
                      className="mt-auto"
                      leftIcon={<Brain size={16} />}
                      onClick={() => void startTraining(row)}
                    >
                      Start training
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Profile editor */}
      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Edit profile"
        description="Used for context around the interview. Questions still come from your resume."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProfileOpen(false)}>
              Cancel
            </Button>
            <Button loading={savingProfile} onClick={saveProfile}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Display name" name="displayName" value={form.displayName} onChange={updateForm} />
          <Input label="Location" name="location" value={form.location} onChange={updateForm} />
          <Input
            label="Experience"
            name="experience"
            value={form.experience}
            onChange={updateForm}
            placeholder="e.g. 2 years"
          />
          <Input label="Education" name="education" value={form.education} onChange={updateForm} />
          <Input
            label="Expected salary"
            name="expectedSalary"
            value={form.expectedSalary}
            onChange={updateForm}
          />
          <Input
            label="LinkedIn"
            name="linkedin"
            value={form.linkedin}
            onChange={updateForm}
            placeholder="https://linkedin.com/in/…"
          />
          <div className="sm:col-span-2">
            <Input
              label="Portfolio"
              name="portfolio"
              value={form.portfolio}
              onChange={updateForm}
              placeholder="https://…"
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Skills"
              name="skills"
              value={form.skills}
              onChange={updateForm}
              placeholder="React, TypeScript, PostgreSQL"
              hint="Comma separated. Only a fallback — the interviewer reads your parsed resume first."
            />
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this interview?"
        description="The transcript, report and composure data for this session are removed permanently."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {pendingDelete && recordDate(pendingDelete)
            ? `Session from ${dateFmt.format(recordDate(pendingDelete) as Date)}.`
            : 'This cannot be undone.'}
        </p>
      </Modal>
    </AppShell>
  );
};

export default Dashboard;
