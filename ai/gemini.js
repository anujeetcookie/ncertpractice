/*
  Gemini-powered question generation.

  IMPORTANT:
  - This module is designed to generate ORIGINAL practice questions.
  - It does NOT scrape/copy paid/copyrighted question banks.

  Env vars:
    GEMINI_API_KEY   - required
    GEMINI_MODEL     - optional (default: gemini-1.5-flash)
*/

'use strict';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getApiKey() {
  return process.env.GEMINI_API_KEY || '';
}

function isGeminiEnabled() {
  return Boolean(getApiKey());
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null;

  // Best case: exact JSON
  try {
    return JSON.parse(text);
  } catch (_) {
    // Continue
  }

  // Strip common fences
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch (_) {
    // Continue
  }

  // Heuristic: extract first JSON array/object substring
  const firstBrace = stripped.search(/[\[{]/);
  if (firstBrace === -1) return null;
  const candidate = stripped.slice(firstBrace);
  try {
    return JSON.parse(candidate);
  } catch (_) {
    return null;
  }
}

function normalizeType(t) {
  const v = String(t || '').toLowerCase().trim();
  if (v === 'long' || v === 'short' || v === 'mcq' || v === 'numerical') return v;
  return null;
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function validateAndNormalizeQuestion(q, { grade, subject, chapter, chapterChoices }) {
  if (!q || typeof q !== 'object') return null;

  const out = {};

  out.id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : makeId(`ai-g${grade}`);
  out.grade = Number.isFinite(Number(q.grade)) ? Number(q.grade) : Number(grade);
  out.subject = typeof q.subject === 'string' && q.subject.trim() ? q.subject.trim() : String(subject);
  out.chapter = typeof q.chapter === 'string' && q.chapter.trim() ? q.chapter.trim() : String(chapter || 'General');
  out.type = normalizeType(q.type);
  out.source = typeof q.source === 'string' && q.source.trim() ? q.source.trim() : 'AI Generated';
  out.tags = Array.isArray(q.tags) ? normalizeStringArray(q.tags) : ['ai', 'generated'];
  out.question = typeof q.question === 'string' ? q.question.trim() : '';
  out.answer = typeof q.answer === 'string' ? q.answer.trim() : '';
  out.keywords = normalizeStringArray(q.keywords);
  out.diagram = q.diagram ? String(q.diagram) : null;
  out.diagram_description = typeof q.diagram_description === 'string' ? q.diagram_description.trim() : null;

  // Append diagram description to question if present, for visibility
  if (out.diagram_description) {
    out.question += `<br><br><small><i>(Visual context: ${out.diagram_description})</i></small>`;
  }

  // Enforce fixed chapter when specified
  if (chapter) {
    out.chapter = String(chapter);
  } else if (Array.isArray(chapterChoices) && chapterChoices.length) {
    // If the model picked an unknown chapter, coerce to General.
    if (!chapterChoices.includes(out.chapter)) out.chapter = 'General';
  }

  if (!out.type) return null;
  if (!out.question) return null;
  if (!out.answer) return null;

  if (out.type === 'mcq') {
    const options = Array.isArray(q.options) ? q.options.map(v => String(v || '').trim()).filter(Boolean) : [];
    if (options.length < 4) return null;
    out.options = options.slice(0, 4);
    const correct = Number(q.correctOption);
    if (!Number.isInteger(correct) || correct < 1 || correct > out.options.length) return null;
    out.correctOption = correct;
  }

  return out;
}

async function callGemini({ prompt, model = DEFAULT_MODEL, timeoutMs = 25000 }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch() is not available (requires Node 18+)');
  }

  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json'
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini API error (${res.status})`;
      throw new Error(msg);
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(p => p?.text)
        .filter(Boolean)
        .join('') ||
      '';

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate ORIGINAL practice questions via Gemini.
 */
async function generateQuestions({ grade, subject, chapter, chapterChoices = [], count = 5, questionType = null, timeoutMs }) {
  const g = Number(grade);
  const s = String(subject);
  const c = chapter ? String(chapter) : '';
  const n = Math.max(1, Math.min(30, Number(count) || 5));

  const allowedTypes = ['long', 'short', 'mcq', 'numerical'];
  const preferredType = questionType && allowedTypes.includes(String(questionType)) ? String(questionType) : null;

  const chaptersLine =
    !c && Array.isArray(chapterChoices) && chapterChoices.length
      ? `- Choose chapter for each question from this list ONLY: ${chapterChoices.map(ch => JSON.stringify(ch)).join(', ')}`
      : '';

  const typeLine = preferredType
    ? `- All questions must have type: ${preferredType}`
    : `- Mix types across: ${allowedTypes.join(', ')} (include at least 1 mcq if possible).`;

  const prompt = [
    `You are a research tool. Retrieve authentic questions from NCERT textbooks.`,
    `Do not invent questions. Extract them from the text or exercises of NCERT books.`,
    `Return ONLY valid JSON (no markdown, no comments).`,
    ``,
    `Create ${n} questions for: Class ${g} | Subject: ${s}${c ? ` | Chapter: ${c}` : ''}.`,
    chaptersLine,
    ``,
    `Output must be a JSON array of objects. Each object must match exactly this shape:`,
    `{`,
    `  "id": string,`,
    `  "grade": number,`,
    `  "subject": string,`,
    `  "chapter": string,`,
    `  "type": "long" | "short" | "mcq" | "numerical",`,
    `  "source": string,`,
    `  "tags": string[],`,
    `  "question": string,`,
    `  "answer": string,`,
    `  "keywords": string[],`,
    `  "diagram": string|null,`,
    `  "diagram_description": string|null,`,
    `  "image_search_query": string|null,`,
    `  // If type is mcq, include:`,
    `  "options": string[4],`,
    `  "correctOption": 1|2|3|4`,
    `}`,
    ``,
    `Rules:`,
    typeLine,
    `- Use clear plain text, but you MAY use HTML tags <b>, <i>, <u>, <br> for formatting emphasis.`,
    `- For "source", provide the EXACT citation (e.g. "NCERT Class 10 Science, Ch 6, Pg 102, Fig 6.3").`,
    `- For "answer", include the final answer and a short explanation/steps.`,
    `- "keywords" should contain 4-10 key terms/phrases students should write.`,
    `- Keep each question solvable without external data.`,
    `- Ensure MCQ has exactly 4 options and exactly 1 correct option.`,
    `- If a diagram is essential, set "diagram_description" to a detailed visual description.`,
    `- Also set "image_search_query" to a specific search term for the diagram (e.g. "NCERT Class 10 digestive system diagram").`,
    `- Set "diagram" to a valid URL if you know one (e.g. Wikimedia), otherwise null.`,
    ``
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await callGemini({ prompt, timeoutMs });
  const parsed = safeJsonParse(raw);
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];

  const out = [];
  const seen = new Set();
  for (const q of arr) {
    const normalized = validateAndNormalizeQuestion(q, { grade: g, subject: s, chapter: c, chapterChoices });
    if (!normalized) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
    if (out.length >= n) break;
  }
  return out;
}

module.exports = {
  isGeminiEnabled,
  generateQuestions
};

