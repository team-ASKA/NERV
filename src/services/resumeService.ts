/**
 * Resume Service - Parses and extracts structured data from resume text using Groq Llama 3.1 8B
 */

import Groq from 'groq-sdk';

export interface ResumeData {
  skills: string[];
  projects: string[];
  achievements: string[];
  experience: string[];
  education: string[];
}

export class ResumeService {
  /**
   * Parse resume text using Gemini AI for accurate extraction
   */
  async parseResume(resumeText: string): Promise<ResumeData> {
    // PRIMARY: Use Gemini AI for intelligent parsing
    try {
      const parsed = await this.parseWithGroq(resumeText);
      if (parsed && (parsed.skills.length > 0 || parsed.experience.length > 0 || parsed.education.length > 0)) {
        console.log('[ResumeService] Groq parsing succeeded:', {
          skills: parsed.skills.length,
          projects: parsed.projects.length,
          achievements: parsed.achievements.length,
          experience: parsed.experience.length,
          education: parsed.education.length,
        });
        return parsed;
      }
    } catch (groqError) {
      console.warn('[ResumeService] Groq parsing failed, using regex fallback:', groqError);
    }

    // FALLBACK: Regex-based extraction
    return this.parseWithRegex(resumeText);
  }

  /**
   * Use Groq AI to extract structured data from free-form resume text
   */
  private async parseWithGroq(resumeText: string): Promise<ResumeData> {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!apiKey) throw new Error('No Groq API key');

    const groq = new Groq({ apiKey, dangerouslyAllowBrowser: true });

    // Truncate to avoid token limits while keeping the most useful sections
    const truncatedText = resumeText.slice(0, 6000);

    const prompt = `You are an expert resume parser. Extract structured information from the following resume text and return ONLY a valid JSON object.

Resume Text:
"""
${truncatedText}
"""

Return this exact JSON structure:
{
  "skills": ["skill1", "skill2", "skill3"],
  "projects": ["Project Name: brief description", "Project2: description"],
  "achievements": ["achievement1", "achievement2"],
  "experience": ["Job Title at Company (Year-Year): brief description", "Job2 at Company2"],
  "education": ["Degree in Field from Institution (Year)", "Certification Name"]
}

Rules FOR SMART PARSING:
- AGGRESSIVELY INFER SECTIONS: The candidate may NOT use clear headings like "Projects" or "Experience". Read the raw text and infer them.
    - If you see a bullet point about "built a web app", "developed a feature", or a GitHub/live link, classify it as a Project.
    - If you see an internship, freelance work, or regular job, classify it as Experience.
- skills: technical and soft skills only, max 20, as short strings
- projects: project name and one-line description, max 10. Extract them even if they are just mentioned in a summary or bullet points!
- achievements: quantified results and awards, max 10
- experience: job titles, companies, dates, max 10
- education: degrees, institutions, graduation years, max 5
- If a category is TRULY empty and cannot be inferred, return an empty array []
- Return ONLY the JSON object, nothing else`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1500,
    });

    const rawText = completion.choices[0]?.message?.content || '';

    // Strip markdown code fences if present
    const jsonText = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(jsonText);

    return {
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: any) => typeof s === 'string') : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects.filter((p: any) => typeof p === 'string') : [],
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements.filter((a: any) => typeof a === 'string') : [],
      experience: Array.isArray(parsed.experience) ? parsed.experience.filter((e: any) => typeof e === 'string') : [],
      education: Array.isArray(parsed.education) ? parsed.education.filter((e: any) => typeof e === 'string') : [],
    };
  }

  /**
   * Regex fallback - extracts based on section headers and common patterns
   */
  private parseWithRegex(text: string): ResumeData {
    const lowerText = text.toLowerCase();

    // Split text into sections by common headers
    const sectionHeaders = /\n(?:skills?|technical skills?|technologies|experience|work experience|employment|projects?|portfolio|achievements?|accomplishments?|awards?|education|academic|qualifications?|certifications?)\s*:?\s*\n/gi;
    const sections: Record<string, string> = {};
    const headerMatches = [...text.matchAll(sectionHeaders)];

    for (let i = 0; i < headerMatches.length; i++) {
      const header = headerMatches[i][0].trim().toLowerCase().replace(':', '').trim();
      const start = headerMatches[i].index! + headerMatches[i][0].length;
      const end = i + 1 < headerMatches.length ? headerMatches[i + 1].index! : text.length;
      sections[header] = text.slice(start, end).trim();
    }

    // Extract skills
    const skills: string[] = [];
    const skillText = sections['skills'] || sections['technical skills'] || sections['technologies'] || '';
    if (skillText) {
      skills.push(...skillText.split(/[,;\n|•\-\*]/).map(s => s.trim()).filter(s => s.length > 1 && s.length < 50));
    }
    // Fallback: scan common tech keywords
    if (skills.length === 0) {
      const techKeywords = [
        'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Swift', 'Kotlin',
        'React', 'Angular', 'Vue', 'Next.js', 'Node.js', 'Express', 'Django', 'Flask', 'Spring',
        'MongoDB', 'MySQL', 'PostgreSQL', 'Redis', 'GraphQL', 'REST',
        'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Git', 'CI/CD',
        'HTML', 'CSS', 'Tailwind', 'Machine Learning', 'TensorFlow', 'PyTorch',
      ];
      techKeywords.forEach(kw => {
        if (lowerText.includes(kw.toLowerCase())) skills.push(kw);
      });
    }

    // Extract projects
    const projects: string[] = [];
    const projectText = sections['projects'] || sections['portfolio'] || '';
    if (projectText) {
      // Each line that starts with a bullet or is non-empty
      const lines = projectText.split('\n').map(s => s.replace(/^[•\-\*\d.]+\s*/, '').trim()).filter(s => s.length > 5);
      projects.push(...lines.slice(0, 10));
    }

    // Extract achievements
    const achievements: string[] = [];
    const achText = sections['achievements'] || sections['accomplishments'] || sections['awards'] || '';
    if (achText) {
      const lines = achText.split('\n').map(s => s.replace(/^[•\-\*\d.]+\s*/, '').trim()).filter(s => s.length > 5);
      achievements.push(...lines.slice(0, 10));
    }
    // Also pick up quantified bullet points anywhere
    const quantifiedBullets = text.match(/[•\-\*]\s*.{10,}(?:\d+%|\d+\+|[Rr]anked|[Ww]on|[Ff]irst|[Aa]ward).{0,100}/g) || [];
    quantifiedBullets.forEach(b => {
      const clean = b.replace(/^[•\-\*]\s*/, '').trim();
      if (clean.length > 5) achievements.push(clean);
    });

    // Extract experience
    const experience: string[] = [];
    const expText = sections['experience'] || sections['work experience'] || sections['employment'] || '';
    if (expText) {
      const lines = expText.split('\n').map(s => s.replace(/^[•\-\*\d.]+\s*/, '').trim()).filter(s => s.length > 5);
      experience.push(...lines.slice(0, 10));
    }

    // Extract education
    const education: string[] = [];
    const eduText = sections['education'] || sections['academic'] || sections['qualifications'] || '';
    if (eduText) {
      const lines = eduText.split('\n').map(s => s.replace(/^[•\-\*\d.]+\s*/, '').trim()).filter(s => s.length > 5);
      education.push(...lines.slice(0, 5));
    }
    // Fallback: look for degree keywords
    if (education.length === 0) {
      const degreeMatches = text.match(/(B\.?Tech|M\.?Tech|B\.?E|MBA|B\.?Sc|M\.?Sc|Ph\.?D|Bachelor|Master|Diploma)[^\n]{0,100}/gi) || [];
      degreeMatches.forEach(d => education.push(d.trim()));
    }

    return {
      skills: [...new Set(skills)].slice(0, 20),
      projects: [...new Set(projects)].slice(0, 10),
      achievements: [...new Set(achievements)].slice(0, 10),
      experience: [...new Set(experience)].slice(0, 10),
      education: [...new Set(education)].slice(0, 5),
    };
  }
}

export const resumeService = new ResumeService();

import { supabaseInterviewService } from './supabaseInterviewService';

/**
 * Extract and save resume data — uses Gemini-powered parsing with Supabase save
 */
export const extractAndSaveResume = async (
  userId: string,
  file: File
): Promise<{ resumeId: string; resumeData: ResumeData }> => {
  try {
    // Extract text from PDF
    const { extractTextFromPDF } = await import('./pdfService');
    const resumeText = await extractTextFromPDF(file);

    if (!resumeText || resumeText.length < 50) {
      throw new Error('Could not extract meaningful text from PDF. Please try a text-based PDF.');
    }

    console.log('[ResumeService] Extracted PDF text length:', resumeText.length);

    // Parse with Groq AI (with regex fallback)
    const resumeData = await resumeService.parseResume(resumeText);

    const resumeId = `resume_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log('[ResumeService] Final resume data:', {
      skills: resumeData.skills.length,
      projects: resumeData.projects.length,
      achievements: resumeData.achievements.length,
      experience: resumeData.experience.length,
      education: resumeData.education.length,
    });

    // Save to Supabase
    try {
      await supabaseInterviewService.saveUserResume(userId, resumeData, resumeText);
    } catch (e) {
      console.warn('[ResumeService] Supabase save failed, continuing with local storage:', e);
    }

    // Also save to localStorage as backup
    localStorage.setItem('resumeData', JSON.stringify(resumeData));
    localStorage.setItem('resumeText', resumeText);

    return { resumeId, resumeData };
  } catch (error) {
    console.error('[ResumeService] Error extracting and saving resume:', error);
    throw error;
  }
};