const path = require('path');
const fs = require('fs');

// Minimal .env loader (no dependency). Only sets keys that are not already set.
function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!key) return;

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) process.env[key] = value;
    });
  } catch (e) {
    console.warn('[env] failed to load .env:', e?.message || e);
  }
}

loadDotEnv();

const gemini = require('./ai/gemini');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', 1);

function parseAllowedOrigins() {
  const allowed = new Set();
  if (process.env.PUBLIC_URL) allowed.add(process.env.PUBLIC_URL);
  if (process.env.RENDER_EXTERNAL_URL) allowed.add(process.env.RENDER_EXTERNAL_URL);
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(',').forEach(v => {
      const trimmed = String(v || '').trim();
      if (trimmed) allowed.add(trimmed);
    });
  }
  return Array.from(allowed);
}

const allowedOrigins = parseAllowedOrigins();
const io = new Server(server, {
  cors:
    allowedOrigins.length > 0
      ? { origin: allowedOrigins, methods: ['GET', 'POST'] }
      : undefined
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

function getDiagramUrl(diagramId) {
  if (!diagramId) return null;
  const safe = String(diagramId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  const svgPath = path.join(PUBLIC_DIR, 'diagrams', `${safe}.svg`);
  if (fs.existsSync(svgPath)) return `/diagrams/${safe}.svg`;
  return null;
}

function resolvePublicFile(fileName) {
  const inPublic = path.join(PUBLIC_DIR, fileName);
  if (fs.existsSync(inPublic)) return inPublic;
  const inRoot = path.join(__dirname, fileName);
  if (fs.existsSync(inRoot)) return inRoot;
  return null;
}

const HOST_HTML_PATH = resolvePublicFile('host.html');
const PLAYER_HTML_PATH = resolvePublicFile('player.html');
const STYLES_CSS_PATH = resolvePublicFile('styles.css');

const rooms = {};

// Trusted educational sources
const TRUSTED_SOURCES = {
  practice: { name: 'Practice', url: null, icon: '🧩' },
  ai: { name: 'AI (Gemini)', url: 'https://ai.google.dev', icon: '🤖' },
  ncert: { name: 'NCERT', url: 'https://ncert.nic.in', icon: '📚' },
  vedantu: { name: 'Vedantu', url: 'https://vedantu.com', icon: '🎓' },
  byjus: { name: 'Byjus', url: 'https://byjus.com', icon: '📖' },
  pw: { name: 'Physics Wallah', url: 'https://physicswallah.live', icon: '⚡' },
  exemplar: { name: 'NCERT Exemplar', url: 'https://ncert.nic.in/exemplar.php', icon: '⭐' },
  rdSharma: { name: 'RD Sharma', url: '#', icon: '📐' },
  rsAggarwal: { name: 'RS Aggarwal', url: '#', icon: '📊' },
  pyq: { name: 'CBSE PYQ', url: 'https://cbse.gov.in', icon: '📝' },
  hots: { name: 'HOTS', url: '#', icon: '🧠' }
};

// Question types
const QUESTION_TYPES = {
  LONG: 'long',      // Long answer (write on paper)
  SHORT: 'short',    // Short answer
  MCQ: 'mcq',        // Multiple choice (1-4 keys)
  NUMERICAL: 'numerical' // Numerical answer
};

const QUESTION_PACKS_DIR = path.join(__dirname, 'question-packs');

function loadExternalQuestionPacks() {
  const loaded = [];

  if (!fs.existsSync(QUESTION_PACKS_DIR)) return loaded;
  const entries = fs
    .readdirSync(QUESTION_PACKS_DIR, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.json'))
    .map(d => d.name);

  entries.forEach(fileName => {
    const fullPath = path.join(QUESTION_PACKS_DIR, fileName);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];
      arr.forEach((q, idx) => {
        if (!q || typeof q !== 'object') return;
        if (!q.id || typeof q.id !== 'string') return;
        if (!q.grade || !Number.isFinite(Number(q.grade))) return;
        if (!q.subject || typeof q.subject !== 'string') return;
        if (!q.chapter || typeof q.chapter !== 'string') return;
        if (!q.type || typeof q.type !== 'string') return;
        if (!Object.values(QUESTION_TYPES).includes(q.type)) return;
        if (!q.question || typeof q.question !== 'string') return;
        if (!q.answer || typeof q.answer !== 'string') return;

        const normalized = {
          id: q.id,
          grade: Number(q.grade),
          subject: q.subject,
          chapter: q.chapter,
          type: q.type,
          source: q.source || 'practice',
          tags: Array.isArray(q.tags) ? q.tags : [],
          question: q.question,
          answer: q.answer,
          keywords: Array.isArray(q.keywords) ? q.keywords : [],
          diagram: q.diagram || null
        };

        if (normalized.type === QUESTION_TYPES.MCQ) {
          if (!Array.isArray(q.options) || q.options.length < 2) return;
          const correct = Number(q.correctOption);
          if (!Number.isInteger(correct) || correct < 1 || correct > q.options.length) return;
          normalized.options = q.options.map(String);
          normalized.correctOption = correct;
        }

        loaded.push(normalized);
      });
      if (loaded.length) {
        console.log(`[question-packs] loaded ${loaded.length} questions (so far) including ${fileName}`);
      }
    } catch (e) {
      console.warn(`[question-packs] failed to load ${fileName}:`, e?.message || e);
    }
  });

  return loaded;
}

// Comprehensive Question Bank
const QUESTION_BANK = [
  // ============================================
  // GRADE 9 - MATHEMATICS
  // ============================================
  // Number Systems
  {
    id: 'g9-m-ns-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Number Systems',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important', 'conceptual'],
    question: 'Which of the following is an irrational number?',
    options: ['√16', '√(4/9)', '√7', '0.3333...'],
    correctOption: 3,
    answer: '√7 is irrational because 7 is not a perfect square. √16 = 4, √(4/9) = 2/3, and 0.3333... = 1/3 are all rational.',
    keywords: ['irrational', '√7', 'perfect square', 'rational']
  },
  {
    id: 'g9-m-ns-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Number Systems',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important'],
    question: 'Represent √3 on the number line.',
    answer: 'To represent √3 on number line: (1) Draw a number line and mark O at 0, A at 1. (2) Draw AB ⊥ OA with AB = 1 unit. (3) By Pythagoras, OB = √(1² + 1²) = √2. (4) With O as center and OB as radius, draw arc to cut number line at C. OC = √2. (5) Draw CD ⊥ OC with CD = 1 unit. (6) OD = √(2 + 1) = √3. (7) With O as center and OD as radius, draw arc to cut number line at E. OE = √3.',
    diagram: 'number-line-sqrt3',
    keywords: ['number line', 'Pythagoras', '√2', '√3', 'perpendicular', 'compass', 'arc']
  },
  {
    id: 'g9-m-ns-3',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Number Systems',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'The decimal expansion of √2 is:',
    options: ['Terminating', 'Non-terminating repeating', 'Non-terminating non-repeating', 'None of these'],
    correctOption: 3,
    answer: '√2 is irrational, so its decimal expansion is non-terminating and non-repeating.',
    keywords: ['non-terminating', 'non-repeating', 'irrational', 'decimal expansion']
  },
  {
    id: 'g9-m-ns-4',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Number Systems',
    type: QUESTION_TYPES.SHORT,
    source: 'rdSharma',
    tags: ['practice'],
    question: 'Simplify: (√5 + √3)²',
    answer: '(√5 + √3)² = (√5)² + 2(√5)(√3) + (√3)² = 5 + 2√15 + 3 = 8 + 2√15',
    keywords: ['simplify', 'algebraic identity', '(a+b)²', '√15']
  },

  // Polynomials
  {
    id: 'g9-m-poly-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Polynomials',
    type: QUESTION_TYPES.MCQ,
    source: 'vedantu',
    tags: ['important'],
    question: 'If p(x) = x² - 3x + 2, find p(2):',
    options: ['0', '2', '4', '-2'],
    correctOption: 1,
    answer: 'p(2) = (2)² - 3(2) + 2 = 4 - 6 + 2 = 0. So x = 2 is a zero of the polynomial.',
    keywords: ['zero', 'polynomial', 'substitution', 'p(2) = 0']
  },
  {
    id: 'g9-m-poly-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Polynomials',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important', 'theorem'],
    question: 'State and prove the Remainder Theorem.',
    answer: 'Remainder Theorem: If a polynomial p(x) of degree ≥ 1 is divided by (x - a), then the remainder is p(a). Proof: Let q(x) be quotient and r be remainder. Then p(x) = (x - a)·q(x) + r. Putting x = a: p(a) = (a - a)·q(a) + r = 0 + r = r. Hence, remainder = p(a).',
    keywords: ['Remainder Theorem', 'p(x)', 'quotient', 'p(a)', 'x - a', 'degree']
  },
  {
    id: 'g9-m-poly-3',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Polynomials',
    type: QUESTION_TYPES.SHORT,
    source: 'rsAggarwal',
    tags: ['practice'],
    question: 'Factorize: x³ - 8',
    answer: 'x³ - 8 = x³ - 2³ = (x - 2)(x² + 2x + 4) using identity a³ - b³ = (a - b)(a² + ab + b²)',
    keywords: ['factorize', 'a³ - b³', 'identity', '(x - 2)', 'x² + 2x + 4']
  },
  {
    id: 'g9-m-poly-4',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Polynomials',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2022'],
    question: 'The degree of the polynomial (x + 1)(x² - x + 1) is:',
    options: ['1', '2', '3', '4'],
    correctOption: 3,
    answer: '(x + 1)(x² - x + 1) = x³ - x² + x + x² - x + 1 = x³ + 1. Degree is 3.',
    keywords: ['degree', 'polynomial', 'x³ + 1', 'multiplication']
  },

  // Coordinate Geometry
  {
    id: 'g9-m-cg-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Coordinate Geometry',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'The point (-3, 4) lies in which quadrant?',
    options: ['I', 'II', 'III', 'IV'],
    correctOption: 2,
    answer: 'In (-3, 4): x is negative, y is positive. This is Quadrant II where x < 0, y > 0.',
    keywords: ['quadrant II', 'x negative', 'y positive', 'Cartesian plane']
  },
  {
    id: 'g9-m-cg-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Coordinate Geometry',
    type: QUESTION_TYPES.SHORT,
    source: 'byjus',
    tags: ['practice'],
    question: 'Find the distance of point (3, 4) from the origin.',
    answer: 'Distance from origin = √(x² + y²) = √(3² + 4²) = √(9 + 16) = √25 = 5 units',
    keywords: ['distance formula', 'origin', '√(x² + y²)', '5 units']
  },

  // Linear Equations in Two Variables
  {
    id: 'g9-m-le-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Linear Equations in Two Variables',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important'],
    question: 'Express y in terms of x: 2x + 3y = 12. Find three solutions.',
    answer: '2x + 3y = 12 → 3y = 12 - 2x → y = (12 - 2x)/3. Solutions: When x = 0: y = 4, point (0, 4). When x = 3: y = 2, point (3, 2). When x = 6: y = 0, point (6, 0). When x = -3: y = 6, point (-3, 6).',
    keywords: ['linear equation', 'solutions', 'y = (12 - 2x)/3', 'two variables']
  },
  {
    id: 'g9-m-le-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Linear Equations in Two Variables',
    type: QUESTION_TYPES.MCQ,
    source: 'pw',
    tags: ['important'],
    question: 'The graph of x = 5 is a line:',
    options: ['Parallel to x-axis', 'Parallel to y-axis', 'Passing through origin', 'None of these'],
    correctOption: 2,
    answer: 'x = 5 is a vertical line parallel to y-axis, passing through (5, 0).',
    keywords: ['parallel to y-axis', 'vertical line', 'x = constant']
  },

  // Triangles
  {
    id: 'g9-m-tri-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Triangles',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['theorem', 'important'],
    question: 'Prove that angles opposite to equal sides of a triangle are equal.',
    answer: 'Given: △ABC where AB = AC. To prove: ∠B = ∠C. Construction: Draw AD ⊥ BC. Proof: In △ABD and △ACD: AB = AC (given), AD = AD (common), ∠ADB = ∠ADC = 90°. By RHS congruence, △ABD ≅ △ACD. Therefore, ∠B = ∠C (CPCT).',
    diagram: 'isosceles-triangle',
    keywords: ['isosceles triangle', 'RHS congruence', 'CPCT', 'equal sides', 'equal angles']
  },
  {
    id: 'g9-m-tri-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Triangles',
    type: QUESTION_TYPES.MCQ,
    source: 'hots',
    tags: ['hots', 'challenging'],
    question: 'In △ABC, if AB = AC and ∠A = 80°, find ∠B:',
    options: ['40°', '50°', '60°', '80°'],
    correctOption: 2,
    answer: 'AB = AC means △ABC is isosceles. ∠B = ∠C. Sum of angles: 80° + ∠B + ∠C = 180°. 80° + 2∠B = 180°. ∠B = 50°.',
    keywords: ['isosceles', 'angle sum property', '180°', '∠B = ∠C']
  },

  // Quadrilaterals
  {
    id: 'g9-m-quad-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Quadrilaterals',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'A quadrilateral ABCD is a parallelogram if:',
    options: ['AB = CD only', 'AB || CD only', 'AB = CD and AB || CD', 'Diagonals bisect each other'],
    correctOption: 4,
    answer: 'A quadrilateral is a parallelogram if its diagonals bisect each other. Other conditions: opposite sides equal/parallel, opposite angles equal.',
    keywords: ['parallelogram', 'diagonals bisect', 'opposite sides', 'conditions']
  },
  {
    id: 'g9-m-quad-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Quadrilaterals',
    type: QUESTION_TYPES.LONG,
    source: 'rdSharma',
    tags: ['practice'],
    question: 'Prove that the diagonals of a rhombus bisect each other at right angles.',
    answer: 'Given: ABCD is a rhombus with diagonals AC and BD intersecting at O. To prove: AO = OC, BO = OD, and AC ⊥ BD. Proof: In △AOB and △COB: AB = CB (sides of rhombus), OB = OB (common), AO = OC (diagonals of parallelogram bisect). △AOB ≅ △COB (SSS). ∠AOB = ∠COB (CPCT). ∠AOB + ∠COB = 180° (linear pair). 2∠AOB = 180°, so ∠AOB = 90°.',
    keywords: ['rhombus', 'diagonals', 'right angles', 'SSS congruence', 'CPCT', '90°']
  },

  // Circles
  {
    id: 'g9-m-circ-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Circles',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'If two chords of a circle are equal, then they are:',
    options: ['Parallel', 'Equidistant from center', 'Perpendicular', 'None of these'],
    correctOption: 2,
    answer: 'Equal chords of a circle are equidistant from the center. This is an important circle theorem.',
    keywords: ['equal chords', 'equidistant', 'center', 'circle theorem']
  },
  {
    id: 'g9-m-circ-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Circles',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['theorem', 'important'],
    question: 'Prove that equal chords of a circle subtend equal angles at the center.',
    answer: 'Given: AB and CD are equal chords of a circle with center O. To prove: ∠AOB = ∠COD. Proof: In △AOB and △COD: OA = OC (radii), OB = OD (radii), AB = CD (given). By SSS congruence, △AOB ≅ △COD. Therefore, ∠AOB = ∠COD (CPCT).',
    keywords: ['equal chords', 'equal angles', 'center', 'SSS congruence', 'radii', 'CPCT']
  },

  // Heron's Formula
  {
    id: 'g9-m-heron-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: "Heron's Formula",
    type: QUESTION_TYPES.SHORT,
    source: 'vedantu',
    tags: ['formula', 'important'],
    question: 'Find the area of a triangle with sides 5 cm, 6 cm, and 7 cm using Heron\'s formula.',
    answer: 's = (5 + 6 + 7)/2 = 9 cm. Area = √[s(s-a)(s-b)(s-c)] = √[9 × 4 × 3 × 2] = √216 = 6√6 cm² ≈ 14.7 cm²',
    keywords: ['Heron\'s formula', 'semi-perimeter', '√[s(s-a)(s-b)(s-c)]', '6√6']
  },
  {
    id: 'g9-m-heron-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: "Heron's Formula",
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2022'],
    question: 'The semi-perimeter of a triangle with sides 3 cm, 4 cm, 5 cm is:',
    options: ['6 cm', '12 cm', '5 cm', '7 cm'],
    correctOption: 1,
    answer: 'Semi-perimeter s = (a + b + c)/2 = (3 + 4 + 5)/2 = 12/2 = 6 cm',
    keywords: ['semi-perimeter', 's = (a+b+c)/2', '6 cm']
  },

  // Surface Areas and Volumes
  {
    id: 'g9-m-sav-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Surface Areas and Volumes',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['formula', 'important'],
    question: 'The curved surface area of a cylinder with radius r and height h is:',
    options: ['πr²h', '2πrh', '2πr(r + h)', 'πr²'],
    correctOption: 2,
    answer: 'CSA of cylinder = 2πrh. Total SA = 2πr(r + h). Volume = πr²h.',
    keywords: ['cylinder', 'CSA', '2πrh', 'curved surface area']
  },
  {
    id: 'g9-m-sav-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Surface Areas and Volumes',
    type: QUESTION_TYPES.SHORT,
    source: 'rsAggarwal',
    tags: ['practice'],
    question: 'Find the volume of a cone with radius 7 cm and height 12 cm. (π = 22/7)',
    answer: 'Volume = (1/3)πr²h = (1/3) × (22/7) × 7² × 12 = (1/3) × (22/7) × 49 × 12 = (22 × 49 × 12)/(7 × 3) = 616 cm³',
    keywords: ['cone', 'volume', '(1/3)πr²h', '616 cm³']
  },

  // Statistics
  {
    id: 'g9-m-stat-1',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Statistics',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'The mean of first 5 natural numbers is:',
    options: ['2', '2.5', '3', '3.5'],
    correctOption: 3,
    answer: 'First 5 natural numbers: 1, 2, 3, 4, 5. Mean = (1+2+3+4+5)/5 = 15/5 = 3',
    keywords: ['mean', 'natural numbers', 'average', '15/5 = 3']
  },
  {
    id: 'g9-m-stat-2',
    grade: 9,
    subject: 'Mathematics',
    chapter: 'Statistics',
    type: QUESTION_TYPES.SHORT,
    source: 'pw',
    tags: ['practice'],
    question: 'Find the median of: 2, 7, 4, 9, 1, 5, 8',
    answer: 'Arrange in order: 1, 2, 4, 5, 7, 8, 9. n = 7 (odd). Median = (n+1)/2 th value = 4th value = 5',
    keywords: ['median', 'ascending order', 'middle value', '(n+1)/2']
  },

  // ============================================
  // GRADE 9 - SCIENCE
  // ============================================
  // Matter in Our Surroundings
  {
    id: 'g9-s-mat-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Matter in Our Surroundings',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'Which of the following has the highest kinetic energy?',
    options: ['Solid', 'Liquid', 'Gas', 'All have equal'],
    correctOption: 3,
    answer: 'Gas particles have maximum kinetic energy due to high speed and freedom of movement. Solids have minimum KE.',
    keywords: ['kinetic energy', 'gas', 'particles', 'intermolecular forces']
  },
  {
    id: 'g9-s-mat-2',
    grade: 9,
    subject: 'Science',
    chapter: 'Matter in Our Surroundings',
    type: QUESTION_TYPES.LONG,
    source: 'vedantu',
    tags: ['important'],
    question: 'Explain why gases are highly compressible while liquids are not.',
    answer: 'Gases are highly compressible because: (1) Gas particles are far apart with large intermolecular spaces. (2) When pressure is applied, particles come closer, reducing volume. (3) Intermolecular forces are negligible. Liquids are nearly incompressible because: (1) Particles are closely packed with minimal space between them. (2) Strong intermolecular forces resist compression. (3) Applying pressure cannot significantly reduce intermolecular distance.',
    keywords: ['compressible', 'intermolecular spaces', 'pressure', 'particles', 'intermolecular forces']
  },

  // Is Matter Around Us Pure
  {
    id: 'g9-s-pure-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Is Matter Around Us Pure',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'A solution contains 40 g of common salt in 320 g of water. Calculate its concentration.',
    options: ['10%', '11.1%', '12.5%', '25%'],
    correctOption: 2,
    answer: 'Concentration = (Mass of solute / Mass of solution) × 100 = (40 / 360) × 100 = 11.1%',
    keywords: ['concentration', 'solute', 'solution', 'percentage']
  },
  {
    id: 'g9-s-pure-2',
    grade: 9,
    subject: 'Science',
    chapter: 'Is Matter Around Us Pure',
    type: QUESTION_TYPES.LONG,
    source: 'byjus',
    tags: ['important'],
    question: 'Differentiate between a mixture and a compound with examples.',
    answer: 'Mixture: (1) Made of two or more substances mixed physically. (2) Components retain their properties. (3) Variable composition. (4) Separated by physical methods. Example: Salt solution, air. Compound: (1) Made of two or more elements combined chemically. (2) New substance with different properties. (3) Fixed composition by mass. (4) Separated by chemical methods. Example: Water (H₂O), NaCl.',
    keywords: ['mixture', 'compound', 'physical', 'chemical', 'composition', 'properties']
  },

  // Atoms and Molecules
  {
    id: 'g9-s-atom-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Atoms and Molecules',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'The atomicity of phosphorus (P₄) is:',
    options: ['1', '2', '3', '4'],
    correctOption: 4,
    answer: 'Atomicity is the number of atoms in one molecule. P₄ has 4 phosphorus atoms, so atomicity = 4.',
    keywords: ['atomicity', 'molecule', 'P₄', 'phosphorus']
  },
  {
    id: 'g9-s-atom-2',
    grade: 9,
    subject: 'Science',
    chapter: 'Atoms and Molecules',
    type: QUESTION_TYPES.SHORT,
    source: 'ncert',
    tags: ['important'],
    question: 'Calculate the molar mass of H₂SO₄.',
    answer: 'H₂SO₄: H = 2 × 1 = 2, S = 1 × 32 = 32, O = 4 × 16 = 64. Molar mass = 2 + 32 + 64 = 98 g/mol',
    keywords: ['molar mass', 'H₂SO₄', '98 g/mol', 'atomic mass']
  },

  // Structure of Atom
  {
    id: 'g9-s-struct-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Structure of the Atom',
    type: QUESTION_TYPES.MCQ,
    source: 'vedantu',
    tags: ['important'],
    question: 'Maximum electrons in the M shell are:',
    options: ['2', '8', '18', '32'],
    correctOption: 3,
    answer: 'Maximum electrons in nth shell = 2n². For M shell (n=3): 2 × 3² = 2 × 9 = 18 electrons.',
    keywords: ['M shell', '2n²', '18 electrons', 'electronic configuration']
  },
  {
    id: 'g9-s-struct-2',
    grade: 9,
    subject: 'Science',
    chapter: 'Structure of the Atom',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important', 'model'],
    question: 'Describe Bohr\'s model of the atom. What are its limitations?',
    answer: 'Bohr\'s Model: (1) Electrons revolve in fixed circular orbits (shells) around nucleus. (2) Each orbit has fixed energy (energy levels). (3) Electrons can jump between orbits by absorbing/emitting energy. (4) Angular momentum is quantized: mvr = nh/2π. Limitations: (1) Only explains hydrogen spectrum, not multi-electron atoms. (2) Cannot explain Zeeman/Stark effect. (3) Violates Heisenberg uncertainty principle. (4) Cannot explain molecular bonding.',
    keywords: ['Bohr\'s model', 'energy levels', 'orbits', 'angular momentum', 'quantized', 'limitations']
  },

  // Fundamental Unit of Life
  {
    id: 'g9-s-cell-1',
    grade: 9,
    subject: 'Science',
    chapter: 'The Fundamental Unit of Life',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2022'],
    question: 'Which organelle is known as the "powerhouse of the cell"?',
    options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Chloroplast'],
    correctOption: 3,
    answer: 'Mitochondria is the powerhouse of the cell as it produces ATP through cellular respiration.',
    keywords: ['mitochondria', 'powerhouse', 'ATP', 'cellular respiration']
  },
  {
    id: 'g9-s-cell-2',
    grade: 9,
    subject: 'Science',
    chapter: 'The Fundamental Unit of Life',
    type: QUESTION_TYPES.LONG,
    source: 'byjus',
    tags: ['important'],
    question: 'Draw and label a plant cell. List the differences between plant and animal cells.',
    answer: 'Plant cell has: Cell wall (cellulose), large central vacuole, chloroplasts, plastids. Animal cell has: No cell wall, small vacuoles, centrioles, no chloroplasts. Both have: Cell membrane, nucleus, mitochondria, ER, Golgi apparatus, ribosomes.',
    diagram: 'plant-cell',
    keywords: ['plant cell', 'cell wall', 'chloroplast', 'vacuole', 'animal cell', 'centriole']
  },

  // Tissues
  {
    id: 'g9-s-tiss-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Tissues',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'Which tissue helps in movement of the body?',
    options: ['Epithelial', 'Connective', 'Muscular', 'Nervous'],
    correctOption: 3,
    answer: 'Muscular tissue is responsible for movement through contraction and relaxation of muscle fibers.',
    keywords: ['muscular tissue', 'movement', 'contraction', 'relaxation']
  },

  // Motion
  {
    id: 'g9-s-mot-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Motion',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'A car travels 100 km in 2 hours. Its average speed is:',
    options: ['25 km/h', '50 km/h', '100 km/h', '200 km/h'],
    correctOption: 2,
    answer: 'Average speed = Total distance / Total time = 100 km / 2 h = 50 km/h',
    keywords: ['average speed', 'distance', 'time', '50 km/h']
  },
  {
    id: 'g9-s-mot-2',
    grade: 9,
    subject: 'Science',
    chapter: 'Motion',
    type: QUESTION_TYPES.NUMERICAL,
    source: 'rdSharma',
    tags: ['practice'],
    question: 'A body starts from rest and accelerates at 2 m/s² for 5 seconds. Find the final velocity and distance covered.',
    answer: 'u = 0, a = 2 m/s², t = 5 s. v = u + at = 0 + 2 × 5 = 10 m/s. s = ut + ½at² = 0 + ½ × 2 × 25 = 25 m',
    keywords: ['v = u + at', 's = ut + ½at²', '10 m/s', '25 m', 'equations of motion']
  },

  // Force and Laws of Motion
  {
    id: 'g9-s-force-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Force and Laws of Motion',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'Newton\'s first law of motion defines:',
    options: ['Force', 'Inertia', 'Momentum', 'Acceleration'],
    correctOption: 2,
    answer: 'Newton\'s first law defines inertia - the tendency of a body to resist change in its state of rest or motion.',
    keywords: ['Newton\'s first law', 'inertia', 'state of rest', 'motion']
  },
  {
    id: 'g9-s-force-2',
    grade: 9,
    subject: 'Science',
    chapter: 'Force and Laws of Motion',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important', 'law'],
    question: 'State Newton\'s second law of motion. Derive F = ma.',
    answer: 'Newton\'s second law: The rate of change of momentum is directly proportional to the applied force and takes place in the direction of force. Derivation: p = mv (momentum). dp/dt = d(mv)/dt. For constant mass: dp/dt = m(dv/dt) = ma. By second law: F ∝ dp/dt. F = k × ma. Taking k = 1 in SI units: F = ma.',
    keywords: ['Newton\'s second law', 'momentum', 'F = ma', 'rate of change', 'dp/dt']
  },

  // Gravitation
  {
    id: 'g9-s-grav-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Gravitation',
    type: QUESTION_TYPES.MCQ,
    source: 'vedantu',
    tags: ['important'],
    question: 'The value of g on Moon compared to Earth is:',
    options: ['Same', '1/6 of Earth', '6 times Earth', '1/2 of Earth'],
    correctOption: 2,
    answer: 'g on Moon ≈ 1.6 m/s² which is about 1/6 of Earth\'s g (9.8 m/s²). This is due to Moon\'s lower mass.',
    keywords: ['Moon', 'g = 1.6 m/s²', '1/6', 'acceleration due to gravity']
  },

  // Work and Energy
  {
    id: 'g9-s-work-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Work and Energy',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'A body of mass 5 kg is moving with velocity 10 m/s. Its kinetic energy is:',
    options: ['50 J', '100 J', '250 J', '500 J'],
    correctOption: 3,
    answer: 'KE = ½mv² = ½ × 5 × (10)² = ½ × 5 × 100 = 250 J',
    keywords: ['kinetic energy', 'KE = ½mv²', '250 J']
  },
  {
    id: 'g9-s-work-2',
    grade: 9,
    subject: 'Science',
    chapter: 'Work and Energy',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important', 'law'],
    question: 'State and explain the law of conservation of energy with an example.',
    answer: 'Law of Conservation of Energy: Energy can neither be created nor destroyed, only transformed from one form to another. The total energy of an isolated system remains constant. Example: A falling ball - At height h: PE = mgh, KE = 0, Total = mgh. At ground: PE = 0, KE = ½mv², Total = ½mv² = mgh. Energy transforms from potential to kinetic, but total remains same.',
    keywords: ['conservation of energy', 'transformed', 'potential energy', 'kinetic energy', 'total energy constant']
  },

  // Sound
  {
    id: 'g9-s-sound-1',
    grade: 9,
    subject: 'Science',
    chapter: 'Sound',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2022'],
    question: 'The speed of sound is maximum in:',
    options: ['Air', 'Water', 'Steel', 'Vacuum'],
    correctOption: 3,
    answer: 'Speed of sound is maximum in solids (Steel ~5000 m/s), then liquids (Water ~1500 m/s), then gases (Air ~340 m/s). Sound cannot travel in vacuum.',
    keywords: ['speed of sound', 'solid', 'steel', 'maximum', '5000 m/s']
  },

  // ============================================
  // GRADE 10 - MATHEMATICS
  // ============================================
  // Real Numbers
  {
    id: 'g10-m-rn-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Real Numbers',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important', 'theorem'],
    question: 'According to Fundamental Theorem of Arithmetic, every composite number can be expressed as:',
    options: ['Sum of primes', 'Product of primes', 'Difference of primes', 'None of these'],
    correctOption: 2,
    answer: 'Fundamental Theorem: Every composite number can be expressed as a unique product of primes (apart from order).',
    keywords: ['Fundamental Theorem', 'composite', 'product of primes', 'unique']
  },
  {
    id: 'g10-m-rn-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Real Numbers',
    type: QUESTION_TYPES.SHORT,
    source: 'ncert',
    tags: ['important'],
    question: 'Find HCF and LCM of 306 and 657 using prime factorization.',
    answer: '306 = 2 × 3² × 17. 657 = 3² × 73. HCF = 3² = 9 (common factors). LCM = 2 × 3² × 17 × 73 = 22338. Verification: HCF × LCM = 9 × 22338 = 201042 = 306 × 657.',
    keywords: ['HCF', 'LCM', 'prime factorization', '9', '22338']
  },

  // Polynomials
  {
    id: 'g10-m-poly-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Polynomials',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'If α, β are zeros of p(x) = x² - 5x + 6, then α + β equals:',
    options: ['5', '6', '-5', '-6'],
    correctOption: 1,
    answer: 'For ax² + bx + c = 0: Sum of zeros = -b/a = -(-5)/1 = 5. Product = c/a = 6.',
    keywords: ['sum of zeros', '-b/a', 'α + β', '5']
  },
  {
    id: 'g10-m-poly-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Polynomials',
    type: QUESTION_TYPES.LONG,
    source: 'rdSharma',
    tags: ['practice'],
    question: 'Find a quadratic polynomial whose zeros are 2 + √3 and 2 - √3.',
    answer: 'Sum of zeros = (2 + √3) + (2 - √3) = 4. Product = (2 + √3)(2 - √3) = 4 - 3 = 1. Polynomial: k[x² - (sum)x + product] = k[x² - 4x + 1]. Taking k = 1: p(x) = x² - 4x + 1.',
    keywords: ['quadratic polynomial', 'sum', 'product', 'x² - 4x + 1', 'conjugate surds']
  },

  // Pair of Linear Equations
  {
    id: 'g10-m-ple-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Pair of Linear Equations',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'For what value of k do the equations 2x + 3y = 7 and 6x + ky = 21 have infinitely many solutions?',
    options: ['3', '6', '9', '12'],
    correctOption: 3,
    answer: 'For infinite solutions: a₁/a₂ = b₁/b₂ = c₁/c₂. 2/6 = 3/k = 7/21. 1/3 = 3/k. k = 9.',
    keywords: ['infinitely many solutions', 'a₁/a₂ = b₁/b₂ = c₁/c₂', 'k = 9']
  },
  {
    id: 'g10-m-ple-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Pair of Linear Equations',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important'],
    question: 'Solve by elimination method: 3x + 4y = 10 and 2x - 2y = 2.',
    answer: 'Multiply eq(2) by 2: 4x - 4y = 4. Add to eq(1): 3x + 4y + 4x - 4y = 10 + 4. 7x = 14, x = 2. Substitute in eq(2): 2(2) - 2y = 2. 4 - 2y = 2. y = 1. Solution: x = 2, y = 1.',
    keywords: ['elimination method', 'x = 2', 'y = 1', 'substitution']
  },

  // Quadratic Equations
  {
    id: 'g10-m-qe-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Quadratic Equations',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'If discriminant D = 0, then the quadratic equation has:',
    options: ['Two distinct real roots', 'Two equal real roots', 'No real roots', 'Infinite roots'],
    correctOption: 2,
    answer: 'When D = b² - 4ac = 0, the quadratic has two equal (repeated) real roots given by x = -b/2a.',
    keywords: ['discriminant', 'D = 0', 'equal roots', 'real roots']
  },
  {
    id: 'g10-m-qe-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Quadratic Equations',
    type: QUESTION_TYPES.SHORT,
    source: 'vedantu',
    tags: ['practice'],
    question: 'Solve: x² - 7x + 12 = 0 by factorization.',
    answer: 'x² - 7x + 12 = 0. Find factors of 12 that add to -7: -3 and -4. x² - 3x - 4x + 12 = 0. x(x - 3) - 4(x - 3) = 0. (x - 3)(x - 4) = 0. x = 3 or x = 4.',
    keywords: ['factorization', 'x = 3', 'x = 4', 'roots']
  },

  // Arithmetic Progressions
  {
    id: 'g10-m-ap-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Arithmetic Progressions',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'The 10th term of AP 2, 7, 12, 17, ... is:',
    options: ['42', '47', '52', '57'],
    correctOption: 2,
    answer: 'a = 2, d = 7 - 2 = 5. aₙ = a + (n-1)d. a₁₀ = 2 + (10-1)×5 = 2 + 45 = 47.',
    keywords: ['AP', 'nth term', 'aₙ = a + (n-1)d', 'a₁₀ = 47']
  },
  {
    id: 'g10-m-ap-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Arithmetic Progressions',
    type: QUESTION_TYPES.LONG,
    source: 'rsAggarwal',
    tags: ['practice'],
    question: 'Find the sum of first 20 terms of AP 1, 4, 7, 10, ...',
    answer: 'a = 1, d = 3, n = 20. Sₙ = n/2[2a + (n-1)d]. S₂₀ = 20/2[2(1) + (19)(3)] = 10[2 + 57] = 10 × 59 = 590.',
    keywords: ['sum of AP', 'Sₙ = n/2[2a + (n-1)d]', 'S₂₀ = 590']
  },

  // Triangles
  {
    id: 'g10-m-tri-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Triangles',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important', 'theorem'],
    question: 'In △ABC, DE || BC. If AD = 4 cm, DB = 5 cm, AE = 8 cm, then EC = ?',
    options: ['8 cm', '10 cm', '12 cm', '6 cm'],
    correctOption: 2,
    answer: 'By BPT: AD/DB = AE/EC. 4/5 = 8/EC. EC = (8 × 5)/4 = 10 cm.',
    keywords: ['BPT', 'Basic Proportionality Theorem', 'AD/DB = AE/EC', '10 cm']
  },
  {
    id: 'g10-m-tri-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Triangles',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['theorem', 'important'],
    question: 'State and prove the Pythagoras Theorem.',
    answer: 'Pythagoras Theorem: In a right-angled triangle, the square of the hypotenuse equals the sum of squares of other two sides. In △ABC right-angled at B: AC² = AB² + BC². Proof: Draw BD ⊥ AC. △ADB ~ △ABC (AA). AD/AB = AB/AC → AB² = AD × AC. △BDC ~ △ABC (AA). DC/BC = BC/AC → BC² = DC × AC. Adding: AB² + BC² = AD×AC + DC×AC = AC(AD + DC) = AC × AC = AC².',
    diagram: 'pythagoras-theorem',
    keywords: ['Pythagoras Theorem', 'AC² = AB² + BC²', 'right-angled', 'hypotenuse', 'similar triangles']
  },

  // Coordinate Geometry
  {
    id: 'g10-m-cg-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Coordinate Geometry',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2022'],
    question: 'The distance between points (3, 4) and (6, 8) is:',
    options: ['3', '4', '5', '6'],
    correctOption: 3,
    answer: 'Distance = √[(6-3)² + (8-4)²] = √[9 + 16] = √25 = 5 units.',
    keywords: ['distance formula', '√[(x₂-x₁)² + (y₂-y₁)²]', '5 units']
  },
  {
    id: 'g10-m-cg-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Coordinate Geometry',
    type: QUESTION_TYPES.SHORT,
    source: 'vedantu',
    tags: ['practice'],
    question: 'Find the coordinates of point which divides the line joining (1, 3) and (4, 6) in ratio 2:1.',
    answer: 'Section formula: x = (m×x₂ + n×x₁)/(m+n), y = (m×y₂ + n×y₁)/(m+n). x = (2×4 + 1×1)/3 = 9/3 = 3. y = (2×6 + 1×3)/3 = 15/3 = 5. Point: (3, 5).',
    keywords: ['section formula', 'ratio 2:1', 'divides internally', '(3, 5)']
  },

  // Introduction to Trigonometry
  {
    id: 'g10-m-trig-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Introduction to Trigonometry',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'The value of sin 45° × cos 45° is:',
    options: ['0', '1/2', '1', '√2'],
    correctOption: 2,
    answer: 'sin 45° = 1/√2, cos 45° = 1/√2. sin 45° × cos 45° = (1/√2) × (1/√2) = 1/2.',
    keywords: ['sin 45°', 'cos 45°', '1/√2', '1/2']
  },
  {
    id: 'g10-m-trig-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Introduction to Trigonometry',
    type: QUESTION_TYPES.SHORT,
    source: 'byjus',
    tags: ['identity'],
    question: 'Prove: (1 + tan²A) = sec²A',
    answer: 'LHS = 1 + tan²A = 1 + sin²A/cos²A = (cos²A + sin²A)/cos²A = 1/cos²A = sec²A = RHS. Hence proved.',
    keywords: ['identity', 'tan²A', 'sec²A', 'sin²A + cos²A = 1']
  },

  // Applications of Trigonometry
  {
    id: 'g10-m-apptrig-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Applications of Trigonometry',
    type: QUESTION_TYPES.LONG,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'From a point on ground, the angle of elevation of top of a building is 60°. If the building is 30 m tall, find the distance from the point to the foot of building.',
    answer: 'Let distance = x. tan 60° = height/base = 30/x. √3 = 30/x. x = 30/√3 = 30√3/3 = 10√3 m ≈ 17.32 m.',
    diagram: 'angle-elevation',
    keywords: ['angle of elevation', 'tan 60°', '√3', '10√3 m', 'height and distance']
  },

  // Circles
  {
    id: 'g10-m-circ-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Circles',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'Number of tangents that can be drawn from an external point to a circle is:',
    options: ['0', '1', '2', '3'],
    correctOption: 3,
    answer: 'From an external point, exactly 2 tangents can be drawn to a circle. From a point on the circle: 1 tangent. From inside: 0 tangents.',
    keywords: ['tangent', 'external point', '2 tangents', 'circle']
  },
  {
    id: 'g10-m-circ-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Circles',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['theorem', 'important'],
    question: 'Prove that tangents drawn from an external point to a circle are equal in length.',
    answer: 'Given: PA and PB are tangents from external point P to circle with center O. To prove: PA = PB. Proof: Join OA, OB, OP. OA ⊥ PA, OB ⊥ PB (radius ⊥ tangent). In △OAP and △OBP: OA = OB (radii), OP = OP (common), ∠OAP = ∠OBP = 90°. By RHS: △OAP ≅ △OBP. PA = PB (CPCT).',
    keywords: ['tangent', 'external point', 'equal length', 'RHS congruence', 'CPCT']
  },

  // Areas Related to Circles
  {
    id: 'g10-m-acirc-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Areas Related to Circles',
    type: QUESTION_TYPES.SHORT,
    source: 'vedantu',
    tags: ['formula'],
    question: 'Find the area of a sector with radius 14 cm and angle 90°.',
    answer: 'Area of sector = (θ/360°) × πr² = (90/360) × (22/7) × 14² = (1/4) × (22/7) × 196 = 154 cm²',
    keywords: ['sector', 'area', '(θ/360°)πr²', '154 cm²']
  },

  // Surface Areas and Volumes
  {
    id: 'g10-m-sav-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Surface Areas and Volumes',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2022'],
    question: 'A cone is 8.4 cm high and radius of base is 2.1 cm. It is melted and recast into a sphere. The radius of sphere is:',
    options: ['2.1 cm', '3.0 cm', '2.5 cm', '1.5 cm'],
    correctOption: 1,
    answer: 'Volume of cone = Volume of sphere. (1/3)πr²h = (4/3)πR³. r²h/4 = R³. (2.1)² × 8.4/4 = R³. R³ = 9.261. R = 2.1 cm.',
    keywords: ['cone', 'sphere', 'volume', 'melted', 'recast', '2.1 cm']
  },

  // Statistics
  {
    id: 'g10-m-stat-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Statistics',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'For a grouped frequency distribution, mode is given by:',
    options: ['l + [(f₁ - f₀)/(2f₁ - f₀ - f₂)] × h', 'l + [(f₁ - f₂)/(2f₁ - f₀ - f₂)] × h', 'l + [(f₀ + f₂)/(2f₁ - f₀ - f₂)] × h', 'None of these'],
    correctOption: 1,
    answer: 'Mode = l + [(f₁ - f₀)/(2f₁ - f₀ - f₂)] × h, where l = lower limit of modal class, f₁ = frequency of modal class, f₀ = frequency of class before modal class, f₂ = frequency of class after modal class.',
    keywords: ['mode formula', 'grouped data', 'modal class', 'l', 'f₁', 'f₀', 'f₂', 'h']
  },

  // Probability
  {
    id: 'g10-m-prob-1',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Probability',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'A dice is thrown once. Probability of getting a prime number is:',
    options: ['1/3', '1/2', '2/3', '1/6'],
    correctOption: 2,
    answer: 'Prime numbers on dice: 2, 3, 5 (3 outcomes). Total outcomes: 6. P(prime) = 3/6 = 1/2.',
    keywords: ['probability', 'prime', 'dice', '1/2', 'favorable outcomes']
  },
  {
    id: 'g10-m-prob-2',
    grade: 10,
    subject: 'Mathematics',
    chapter: 'Probability',
    type: QUESTION_TYPES.SHORT,
    source: 'byjus',
    tags: ['practice'],
    question: 'Two coins are tossed together. Find P(at least one head).',
    answer: 'Sample space: {HH, HT, TH, TT}. At least one head: {HH, HT, TH}. P(at least one head) = 3/4. Alternatively: P(at least one head) = 1 - P(no head) = 1 - 1/4 = 3/4.',
    keywords: ['probability', 'at least one', 'complement', '3/4']
  },

  // ============================================
  // GRADE 10 - SCIENCE
  // ============================================
  // Chemical Reactions and Equations
  {
    id: 'g10-s-chem-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Chemical Reactions and Equations',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'Which type of reaction is: 2Mg + O₂ → 2MgO?',
    options: ['Decomposition', 'Combination', 'Displacement', 'Double displacement'],
    correctOption: 2,
    answer: 'This is a combination reaction where two or more reactants combine to form a single product.',
    keywords: ['combination reaction', 'synthesis', 'Mg + O₂', 'MgO']
  },
  {
    id: 'g10-s-chem-2',
    grade: 10,
    subject: 'Science',
    chapter: 'Chemical Reactions and Equations',
    type: QUESTION_TYPES.LONG,
    source: 'ncert',
    tags: ['important'],
    question: 'What is a redox reaction? Explain with the example of CuO + H₂ → Cu + H₂O.',
    answer: 'Redox reaction involves both oxidation (loss of electrons/gain of oxygen) and reduction (gain of electrons/loss of oxygen). In CuO + H₂ → Cu + H₂O: CuO is reduced (loses oxygen) → Cu is formed. H₂ is oxidized (gains oxygen) → H₂O is formed. CuO is oxidizing agent, H₂ is reducing agent.',
    keywords: ['redox', 'oxidation', 'reduction', 'oxidizing agent', 'reducing agent', 'electrons']
  },

  // Acids, Bases and Salts
  {
    id: 'g10-s-abs-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Acids, Bases and Salts',
    type: QUESTION_TYPES.MCQ,
    source: 'vedantu',
    tags: ['important'],
    question: 'pH of pure water is:',
    options: ['0', '7', '14', '1'],
    correctOption: 2,
    answer: 'Pure water is neutral with pH = 7. Acids: pH < 7, Bases: pH > 7.',
    keywords: ['pH', 'neutral', 'water', 'pH = 7']
  },
  {
    id: 'g10-s-abs-2',
    grade: 10,
    subject: 'Science',
    chapter: 'Acids, Bases and Salts',
    type: QUESTION_TYPES.SHORT,
    source: 'ncert',
    tags: ['important'],
    question: 'What happens when an acid reacts with a metal carbonate? Write equation.',
    answer: 'Metal carbonate + Acid → Salt + Water + CO₂. Example: Na₂CO₃ + 2HCl → 2NaCl + H₂O + CO₂↑. The CO₂ gives brisk effervescence and turns lime water milky.',
    keywords: ['carbonate', 'acid', 'salt', 'CO₂', 'effervescence', 'lime water']
  },

  // Life Processes
  {
    id: 'g10-s-lp-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Life Processes',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2022'],
    question: 'The process of breakdown of pyruvate in the absence of oxygen is called:',
    options: ['Aerobic respiration', 'Fermentation', 'Photosynthesis', 'Transpiration'],
    correctOption: 2,
    answer: 'Fermentation is anaerobic respiration. Pyruvate → Ethanol + CO₂ (in yeast) or Lactic acid (in muscles).',
    keywords: ['fermentation', 'anaerobic', 'pyruvate', 'ethanol', 'lactic acid']
  },

  // Control and Coordination
  {
    id: 'g10-s-cc-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Control and Coordination',
    type: QUESTION_TYPES.LONG,
    source: 'byjus',
    tags: ['important'],
    question: 'Compare nervous and hormonal control in humans.',
    answer: 'Nervous control: (1) Fast response (milliseconds). (2) Travels via neurons as electrical impulses. (3) Effects are localized. (4) Short-lived. (5) Point-to-point. Hormonal control: (1) Slow response (seconds to hours). (2) Chemicals travel via blood. (3) Effects are widespread. (4) Long-lasting. (5) General response. Both coordinate body functions.',
    keywords: ['nervous', 'hormonal', 'fast', 'slow', 'neurons', 'blood', 'electrical impulses', 'chemicals']
  },

  // Heredity and Evolution
  {
    id: 'g10-s-he-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Heredity and Evolution',
    type: QUESTION_TYPES.MCQ,
    source: 'exemplar',
    tags: ['important'],
    question: 'What is the probability of a boy child in humans?',
    options: ['25%', '50%', '75%', '100%'],
    correctOption: 2,
    answer: 'Father contributes X or Y, Mother contributes X. XX = girl, XY = boy. Probability of boy = 50%.',
    keywords: ['sex determination', 'XX', 'XY', '50%', 'probability']
  },

  // Light - Reflection and Refraction
  {
    id: 'g10-s-light-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Light - Reflection and Refraction',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'Power of a lens with focal length 50 cm is:',
    options: ['+2 D', '-2 D', '+0.5 D', '-0.5 D'],
    correctOption: 1,
    answer: 'P = 1/f (in metres) = 1/0.5 = +2 D. Positive for convex lens, negative for concave.',
    keywords: ['power of lens', 'P = 1/f', 'dioptre', '+2 D']
  },
  {
    id: 'g10-s-light-2',
    grade: 10,
    subject: 'Science',
    chapter: 'Light - Reflection and Refraction',
    type: QUESTION_TYPES.SHORT,
    source: 'vedantu',
    tags: ['formula'],
    question: 'State the mirror formula and magnification formula.',
    answer: 'Mirror formula: 1/v + 1/u = 1/f, where v = image distance, u = object distance, f = focal length. Magnification: m = -v/u = h\'/h, where h\' = image height, h = object height.',
    keywords: ['mirror formula', '1/v + 1/u = 1/f', 'magnification', 'm = -v/u']
  },

  // Electricity
  {
    id: 'g10-s-elec-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Electricity',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'Two resistors 4Ω and 6Ω are connected in parallel. Their equivalent resistance is:',
    options: ['10 Ω', '2.4 Ω', '24 Ω', '5 Ω'],
    correctOption: 2,
    answer: '1/R = 1/4 + 1/6 = 5/12. R = 12/5 = 2.4 Ω.',
    keywords: ['parallel', 'equivalent resistance', '1/R = 1/R₁ + 1/R₂', '2.4 Ω']
  },
  {
    id: 'g10-s-elec-2',
    grade: 10,
    subject: 'Science',
    chapter: 'Electricity',
    type: QUESTION_TYPES.NUMERICAL,
    source: 'rdSharma',
    tags: ['practice'],
    question: 'An electric heater of 1000 W is used for 2 hours daily. Calculate electrical energy consumed in 30 days.',
    answer: 'Energy = Power × Time. Daily energy = 1000 W × 2 h = 2000 Wh = 2 kWh. Monthly energy = 2 × 30 = 60 kWh = 60 units.',
    keywords: ['electrical energy', 'kWh', 'power × time', '60 units']
  },

  // Magnetic Effects of Electric Current
  {
    id: 'g10-s-mag-1',
    grade: 10,
    subject: 'Science',
    chapter: 'Magnetic Effects of Electric Current',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'The pattern of magnetic field lines around a straight current-carrying conductor is:',
    options: ['Straight lines', 'Concentric circles', 'Elliptical', 'Spiral'],
    correctOption: 2,
    answer: 'Magnetic field lines around a straight conductor are concentric circles. Direction given by right-hand thumb rule.',
    keywords: ['magnetic field', 'concentric circles', 'right-hand thumb rule', 'current']
  },

  // ============================================
  // GRADE 11 - MATHEMATICS (Sample)
  // ============================================
  {
    id: 'g11-m-sets-1',
    grade: 11,
    subject: 'Mathematics',
    chapter: 'Sets',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'If A = {1, 2, 3} and B = {2, 3, 4}, then A ∪ B is:',
    options: ['{2, 3}', '{1, 2, 3, 4}', '{1, 4}', '{1, 2, 3}'],
    correctOption: 2,
    answer: 'A ∪ B (union) contains all elements in A or B or both. A ∪ B = {1, 2, 3, 4}.',
    keywords: ['union', 'A ∪ B', 'all elements', '{1, 2, 3, 4}']
  },
  {
    id: 'g11-m-trig-1',
    grade: 11,
    subject: 'Mathematics',
    chapter: 'Trigonometric Functions',
    type: QUESTION_TYPES.SHORT,
    source: 'exemplar',
    tags: ['formula'],
    question: 'If sin θ = 3/5, find cos θ and tan θ (θ in first quadrant).',
    answer: 'sin²θ + cos²θ = 1. cos²θ = 1 - 9/25 = 16/25. cos θ = 4/5 (positive in Q1). tan θ = sin θ/cos θ = (3/5)/(4/5) = 3/4.',
    keywords: ['sin²θ + cos²θ = 1', 'cos θ = 4/5', 'tan θ = 3/4', 'first quadrant']
  },
  {
    id: 'g11-m-pc-1',
    grade: 11,
    subject: 'Mathematics',
    chapter: 'Permutations and Combinations',
    type: QUESTION_TYPES.MCQ,
    source: 'pyq',
    tags: ['pyq', 'important'],
    question: 'The number of ways of arranging 5 boys in a row is:',
    options: ['5', '25', '120', '625'],
    correctOption: 3,
    answer: 'Number of arrangements = 5! = 5 × 4 × 3 × 2 × 1 = 120.',
    keywords: ['permutation', '5!', 'factorial', '120', 'arrangements']
  },

  // ============================================
  // GRADE 12 - MATHEMATICS (Sample)
  // ============================================
  {
    id: 'g12-m-rf-1',
    grade: 12,
    subject: 'Mathematics',
    chapter: 'Relations and Functions',
    type: QUESTION_TYPES.MCQ,
    source: 'ncert',
    tags: ['important'],
    question: 'A relation R on set A is said to be reflexive if:',
    options: ['(a,b) ∈ R ⇒ (b,a) ∈ R', '(a,a) ∈ R for all a ∈ A', '(a,b) ∈ R and (b,c) ∈ R ⇒ (a,c) ∈ R', 'None of these'],
    correctOption: 2,
    answer: 'Reflexive: (a,a) ∈ R for all a ∈ A. Symmetric: (a,b) ∈ R ⇒ (b,a) ∈ R. Transitive: (a,b) ∈ R and (b,c) ∈ R ⇒ (a,c) ∈ R.',
    keywords: ['reflexive', '(a,a) ∈ R', 'symmetric', 'transitive', 'relation']
  },
  {
    id: 'g12-m-diff-1',
    grade: 12,
    subject: 'Mathematics',
    chapter: 'Continuity and Differentiability',
    type: QUESTION_TYPES.SHORT,
    source: 'vedantu',
    tags: ['formula'],
    question: 'Differentiate: y = x³ + sin x - eˣ',
    answer: 'dy/dx = d/dx(x³) + d/dx(sin x) - d/dx(eˣ) = 3x² + cos x - eˣ',
    keywords: ['differentiation', 'd/dx', '3x²', 'cos x', 'eˣ']
  },
  {
    id: 'g12-m-int-1',
    grade: 12,
    subject: 'Mathematics',
    chapter: 'Integrals',
    type: QUESTION_TYPES.SHORT,
    source: 'rsAggarwal',
    tags: ['practice'],
    question: 'Evaluate: ∫(x² + 3x + 2)dx',
    answer: '∫(x² + 3x + 2)dx = x³/3 + 3x²/2 + 2x + C',
    keywords: ['integration', '∫', 'x³/3', 'constant C']
  },
  {
    id: 'g12-m-prob-1',
    grade: 12,
    subject: 'Mathematics',
    chapter: 'Probability',
    type: QUESTION_TYPES.LONG,
    source: 'pyq',
    tags: ['pyq', 'cbse-2023'],
    question: 'State and prove Bayes\' Theorem.',
    answer: 'Bayes\' Theorem: If E₁, E₂, ..., Eₙ are mutually exclusive and exhaustive events with P(Eᵢ) > 0, and A is any event with P(A) > 0, then P(Eᵢ|A) = P(Eᵢ)P(A|Eᵢ) / Σⱼ P(Eⱼ)P(A|Eⱼ). Proof: By definition, P(Eᵢ|A) = P(Eᵢ ∩ A)/P(A). P(Eᵢ ∩ A) = P(Eᵢ)P(A|Eᵢ). P(A) = Σⱼ P(Eⱼ ∩ A) = Σⱼ P(Eⱼ)P(A|Eⱼ). Substituting gives Bayes\' formula.',
    keywords: ['Bayes\' Theorem', 'conditional probability', 'P(Eᵢ|A)', 'posterior', 'prior', 'exhaustive']
  }
];

// Load any additional JSON question packs from ./question-packs
try {
  const extra = loadExternalQuestionPacks();
  if (extra.length) {
    const existingIds = new Set(QUESTION_BANK.map(q => q.id));
    extra.forEach(q => {
      if (!existingIds.has(q.id)) {
        QUESTION_BANK.push(q);
        existingIds.add(q.id);
      }
    });
    console.log(`[question-packs] total questions after merge: ${QUESTION_BANK.length}`);
  }
} catch (e) {
  console.warn('[question-packs] merge failed:', e?.message || e);
}

// Curriculum map (used to show chapters even if question bank is incomplete).
// This enables "all chapters" selection and falls back to live generation when needed.
const CURRICULUM = {
  9: {
    Mathematics: [
      'Number Systems',
      'Polynomials',
      'Coordinate Geometry',
      'Linear Equations in Two Variables',
      "Introduction to Euclid's Geometry",
      'Lines and Angles',
      'Triangles',
      'Quadrilaterals',
      'Areas of Parallelograms and Triangles',
      'Circles',
      'Constructions',
      "Heron's Formula",
      'Surface Areas and Volumes',
      'Statistics',
      'Probability'
    ],
    Science: [
      'Matter in Our Surroundings',
      'Is Matter Around Us Pure',
      'Atoms and Molecules',
      'Structure of the Atom',
      'The Fundamental Unit of Life',
      'Tissues',
      'Diversity in Living Organisms',
      'Motion',
      'Force and Laws of Motion',
      'Gravitation',
      'Work and Energy',
      'Sound',
      'Why Do We Fall Ill',
      'Natural Resources',
      'Improvement in Food Resources'
    ],
    'Social Science': [
      'The French Revolution',
      'Socialism in Europe and the Russian Revolution',
      'Nazism and the Rise of Hitler',
      'Forest Society and Colonialism',
      'Pastoralists in the Modern World',
      'India - Size and Location',
      'Physical Features of India',
      'Drainage',
      'Climate',
      'Natural Vegetation and Wildlife',
      'Population',
      'What is Democracy? Why Democracy?',
      'Constitutional Design',
      'Electoral Politics',
      'Working of Institutions',
      'Democratic Rights',
      'The Story of Village Palampur',
      'People as Resource',
      'Poverty as a Challenge',
      'Food Security in India'
    ]
  },
  10: {
    Mathematics: [
      'Real Numbers',
      'Polynomials',
      'Pair of Linear Equations',
      'Quadratic Equations',
      'Arithmetic Progressions',
      'Triangles',
      'Coordinate Geometry',
      'Introduction to Trigonometry',
      'Applications of Trigonometry',
      'Circles',
      'Constructions',
      'Areas Related to Circles',
      'Surface Areas and Volumes',
      'Statistics',
      'Probability'
    ],
    Science: [
      'Chemical Reactions and Equations',
      'Acids, Bases and Salts',
      'Metals and Non-metals',
      'Carbon and Its Compounds',
      'Periodic Classification of Elements',
      'Life Processes',
      'Control and Coordination',
      'How do Organisms Reproduce?',
      'Heredity and Evolution',
      'Light - Reflection and Refraction',
      'The Human Eye and the Colourful World',
      'Electricity',
      'Magnetic Effects of Electric Current',
      'Sources of Energy',
      'Our Environment',
      'Sustainable Management of Natural Resources'
    ],
    'Social Science': [
      'The Rise of Nationalism in Europe',
      'Nationalism in India',
      'The Making of a Global World',
      'The Age of Industrialisation',
      'Print Culture and the Modern World',
      'Resources and Development',
      'Forest and Wildlife Resources',
      'Water Resources',
      'Agriculture',
      'Minerals and Energy Resources',
      'Manufacturing Industries',
      'Lifelines of National Economy',
      'Power Sharing',
      'Federalism',
      'Gender, Religion and Caste',
      'Political Parties',
      'Outcomes of Democracy',
      'Challenges to Democracy',
      'Development',
      'Sectors of the Indian Economy',
      'Money and Credit',
      'Globalisation and the Indian Economy',
      'Consumer Rights'
    ]
  },
  11: {
    Mathematics: [
      'Sets',
      'Relations and Functions',
      'Trigonometric Functions',
      'Principle of Mathematical Induction',
      'Complex Numbers and Quadratic Equations',
      'Linear Inequalities',
      'Permutations and Combinations',
      'Binomial Theorem',
      'Sequence and Series',
      'Straight Lines',
      'Conic Sections',
      'Introduction to Three Dimensional Geometry',
      'Limits and Derivatives',
      'Mathematical Reasoning',
      'Statistics',
      'Probability'
    ],
    Physics: [
      'Physical World',
      'Units and Measurements',
      'Motion in a Straight Line',
      'Motion in a Plane',
      'Laws of Motion',
      'Work, Energy and Power',
      'System of Particles and Rotational Motion',
      'Gravitation',
      'Mechanical Properties of Solids',
      'Mechanical Properties of Fluids',
      'Thermal Properties of Matter',
      'Thermodynamics',
      'Kinetic Theory',
      'Oscillations',
      'Waves'
    ],
    Chemistry: [
      'Some Basic Concepts of Chemistry',
      'Structure of Atom',
      'Classification of Elements and Periodicity in Properties',
      'Chemical Bonding and Molecular Structure',
      'States of Matter',
      'Thermodynamics',
      'Equilibrium',
      'Redox Reactions',
      'Hydrogen',
      'The s-Block Elements',
      'The p-Block Elements',
      'Organic Chemistry: Some Basic Principles and Techniques',
      'Hydrocarbons',
      'Environmental Chemistry'
    ],
    Biology: [
      'The Living World',
      'Biological Classification',
      'Plant Kingdom',
      'Animal Kingdom',
      'Morphology of Flowering Plants',
      'Anatomy of Flowering Plants',
      'Structural Organisation in Animals',
      'Cell: The Unit of Life',
      'Biomolecules',
      'Cell Cycle and Cell Division',
      'Transport in Plants',
      'Mineral Nutrition',
      'Photosynthesis in Higher Plants',
      'Respiration in Plants',
      'Plant Growth and Development',
      'Digestion and Absorption',
      'Breathing and Exchange of Gases',
      'Body Fluids and Circulation',
      'Excretory Products and their Elimination',
      'Locomotion and Movement',
      'Neural Control and Coordination',
      'Chemical Coordination and Integration'
    ]
  },
  12: {
    Mathematics: [
      'Relations and Functions',
      'Inverse Trigonometric Functions',
      'Matrices',
      'Determinants',
      'Continuity and Differentiability',
      'Applications of Derivatives',
      'Integrals',
      'Applications of Integrals',
      'Differential Equations',
      'Vector Algebra',
      'Three-Dimensional Geometry',
      'Linear Programming',
      'Probability'
    ],
    Physics: [
      'Electric Charges and Fields',
      'Electrostatic Potential and Capacitance',
      'Current Electricity',
      'Moving Charges and Magnetism',
      'Magnetism and Matter',
      'Electromagnetic Induction',
      'Alternating Current',
      'Electromagnetic Waves',
      'Ray Optics and Optical Instruments',
      'Wave Optics',
      'Dual Nature of Radiation and Matter',
      'Atoms',
      'Nuclei',
      'Semiconductor Electronics',
      'Communication Systems'
    ],
    Chemistry: [
      'Solutions',
      'Electrochemistry',
      'Chemical Kinetics',
      'Surface Chemistry',
      'General Principles and Processes of Isolation of Elements',
      'The p-Block Elements',
      'The d- and f-Block Elements',
      'Coordination Compounds',
      'Haloalkanes and Haloarenes',
      'Alcohols, Phenols and Ethers',
      'Aldehydes, Ketones and Carboxylic Acids',
      'Amines',
      'Biomolecules',
      'Polymers',
      'Chemistry in Everyday Life'
    ],
    Biology: [
      'Reproduction in Organisms',
      'Sexual Reproduction in Flowering Plants',
      'Human Reproduction',
      'Reproductive Health',
      'Principles of Inheritance and Variation',
      'Molecular Basis of Inheritance',
      'Evolution',
      'Human Health and Disease',
      'Strategies for Enhancement in Food Production',
      'Microbes in Human Welfare',
      'Biotechnology: Principles and Processes',
      'Biotechnology and its Applications',
      'Organisms and Populations',
      'Ecosystem',
      'Biodiversity and Conservation',
      'Environmental Issues'
    ]
  }
};

// Get catalog of available questions
function getQuestionCatalog() {
  const gradeSet = new Set();
  Object.keys(CURRICULUM).forEach(g => gradeSet.add(Number(g)));
  QUESTION_BANK.forEach(q => gradeSet.add(q.grade));
  const grades = Array.from(gradeSet).filter(Number.isFinite).sort((a, b) => a - b);

  const subjectsByGrade = {};
  const chaptersByGradeSubject = {};

  // Seed from curriculum map
  Object.entries(CURRICULUM).forEach(([gradeKey, subjects]) => {
    const gKey = String(gradeKey);
    subjectsByGrade[gKey] ||= new Set();
    chaptersByGradeSubject[gKey] ||= {};

    Object.entries(subjects).forEach(([subject, chapters]) => {
      subjectsByGrade[gKey].add(subject);
      chaptersByGradeSubject[gKey][subject] ||= new Set();
      (chapters || []).forEach(ch => chaptersByGradeSubject[gKey][subject].add(ch));
    });
  });

  // Merge from available questions
  QUESTION_BANK.forEach(q => {
    const gKey = String(q.grade);
    subjectsByGrade[gKey] ||= new Set();
    subjectsByGrade[gKey].add(q.subject);

    chaptersByGradeSubject[gKey] ||= {};
    chaptersByGradeSubject[gKey][q.subject] ||= new Set();
    chaptersByGradeSubject[gKey][q.subject].add(q.chapter);
  });

  Object.keys(subjectsByGrade).forEach(g => {
    subjectsByGrade[g] = Array.from(subjectsByGrade[g]).sort();
  });
  Object.keys(chaptersByGradeSubject).forEach(g => {
    Object.keys(chaptersByGradeSubject[g]).forEach(s => {
      chaptersByGradeSubject[g][s] = Array.from(chaptersByGradeSubject[g][s]).sort();
    });
  });

  return { grades, subjectsByGrade, chaptersByGradeSubject };
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateMathQuestion({ grade, chapter }) {
  // A small set of template generators to keep questions fresh.
  // These are original, parameterized practice questions.

  // Quadratic equations: build one with integer roots.
  if (String(chapter).toLowerCase().includes('quadratic')) {
    const r1 = randInt(-6, 9);
    let r2 = randInt(-6, 9);
    if (r2 === r1) r2 += 1;
    const sum = r1 + r2;
    const prod = r1 * r2;
    const qText = `Solve: x² ${sum >= 0 ? '- ' + sum : '+ ' + Math.abs(sum)}x ${prod >= 0 ? '+ ' + prod : '- ' + Math.abs(prod)} = 0`;
    return {
      id: makeId(`live-g${grade}-m-qe`),
      grade,
      subject: 'Mathematics',
      chapter,
      type: QUESTION_TYPES.SHORT,
      source: 'practice',
      tags: ['live', 'practice'],
      question: qText,
      answer: `Factor: (x - ${r1}) (x - ${r2}) = 0 ⇒ x = ${r1} or x = ${r2}.`,
      keywords: ['factor', 'roots', 'x =', `x = ${r1}`, `x = ${r2}`]
    };
  }

  // Coordinate geometry: distance between points.
  if (String(chapter).toLowerCase().includes('coordinate')) {
    const x1 = randInt(-6, 6);
    const y1 = randInt(-6, 6);
    const dx = randInt(-6, 6);
    const dy = randInt(-6, 6);
    const x2 = x1 + (dx === 0 ? 3 : dx);
    const y2 = y1 + (dy === 0 ? 4 : dy);
    const a = x2 - x1;
    const b = y2 - y1;
    return {
      id: makeId(`live-g${grade}-m-cg`),
      grade,
      subject: 'Mathematics',
      chapter,
      type: QUESTION_TYPES.SHORT,
      source: 'practice',
      tags: ['live', 'practice'],
      question: `Find the distance between points (${x1}, ${y1}) and (${x2}, ${y2}).`,
      answer: `Distance = √[(${x2} - ${x1})² + (${y2} - ${y1})²] = √[(${a})² + (${b})²] = √(${a * a + b * b})`,
      keywords: ['distance', '√', '(x₂-x₁)²', '(y₂-y₁)²']
    };
  }

  // Arithmetic progression: nth term.
  if (String(chapter).toLowerCase().includes('arithmetic progression') || chapter === 'Arithmetic Progressions') {
    const a = randInt(-10, 15);
    const d = randInt(1, 9);
    const n = randInt(8, 18);
    const an = a + (n - 1) * d;
    return {
      id: makeId(`live-g${grade}-m-ap`),
      grade,
      subject: 'Mathematics',
      chapter,
      type: QUESTION_TYPES.MCQ,
      source: 'practice',
      tags: ['live', 'practice'],
      question: `In the AP with first term a = ${a} and common difference d = ${d}, find the ${n}th term.`,
      options: [String(an), String(an + d), String(an - d), String(an + 2 * d)],
      correctOption: 1,
      answer: `aₙ = a + (n-1)d = ${a} + (${n}-1)×${d} = ${an}.`,
      keywords: ['AP', 'aₙ = a + (n-1)d', `aₙ = ${an}`]
    };
  }

  // Number systems: simplify a surd.
  if (String(chapter).toLowerCase().includes('number system')) {
    const p = pickOne([2, 3, 5, 6, 7, 10]);
    const k = pickOne([2, 3, 4, 5]);
    const rad = p * k * k;
    return {
      id: makeId(`live-g${grade}-m-ns`),
      grade,
      subject: 'Mathematics',
      chapter,
      type: QUESTION_TYPES.SHORT,
      source: 'practice',
      tags: ['live', 'practice'],
      question: `Simplify: √${rad}`,
      answer: `√${rad} = √(${k * k}×${p}) = ${k}√${p}.`,
      keywords: ['simplify', `√${rad}`, `${k}√${p}`]
    };
  }

  // Probability (basic): dice.
  if (String(chapter).toLowerCase().includes('probability')) {
    const target = pickOne(['even', 'odd', 'prime']);
    const favorable = target === 'even' ? 3 : target === 'odd' ? 3 : 3;
    const answer = `P(${target}) = ${favorable}/6 = 1/2.`;
    return {
      id: makeId(`live-g${grade}-m-prob`),
      grade,
      subject: 'Mathematics',
      chapter,
      type: QUESTION_TYPES.MCQ,
      source: 'practice',
      tags: ['live', 'practice'],
      question: `A fair dice is thrown once. Find the probability of getting a ${target} number.`,
      options: ['1/6', '1/3', '1/2', '2/3'],
      correctOption: 3,
      answer,
      keywords: ['probability', 'favourable outcomes', 'sample space', '1/2']
    };
  }

  // Fallback: generic short question.
  return {
    id: makeId(`live-g${grade}-m`),
    grade,
    subject: 'Mathematics',
    chapter,
    type: QUESTION_TYPES.SHORT,
    source: 'practice',
    tags: ['live'],
    question: `Write the key definition / formula used in the chapter "${chapter}" and one worked example.`
      .trim(),
    answer: `This is an open-ended practice prompt. Write the main definition/formula and a solved example from the chapter.`,
    keywords: ['definition', 'formula', 'example']
  };
}

function generateScienceQuestion({ grade, chapter }) {
  // A couple of parameterized numericals for freshness.
  const ch = String(chapter).toLowerCase();
  if (ch === 'motion') {
    const d = randInt(200, 1200);
    const t = randInt(20, 180);
    const v = (d / t).toFixed(2);
    return {
      id: makeId(`live-g${grade}-s-motion`),
      grade,
      subject: 'Science',
      chapter,
      type: QUESTION_TYPES.NUMERICAL,
      source: 'practice',
      tags: ['live', 'numerical'],
      question: `A body covers ${d} m in ${t} s. Find its speed in m/s.`,
      answer: `Speed = distance/time = ${d}/${t} = ${v} m/s.`,
      keywords: ['speed', 'distance/time', `${v} m/s`]
    };
  }

  if (ch === 'electricity') {
    const v = randInt(6, 24);
    const r = randInt(2, 12);
    const i = (v / r).toFixed(2);
    return {
      id: makeId(`live-g${grade}-s-elec`),
      grade,
      subject: 'Science',
      chapter,
      type: QUESTION_TYPES.NUMERICAL,
      source: 'practice',
      tags: ['live', 'numerical'],
      question: `A resistor of ${r} Ω is connected across a ${v} V battery. Find the current.`,
      answer: `By Ohm's law: I = V/R = ${v}/${r} = ${i} A.`,
      keywords: ['Ohm\'s law', 'I = V/R', `${i} A`]
    };
  }

  return {
    id: makeId(`live-g${grade}-s`),
    grade,
    subject: 'Science',
    chapter,
    type: QUESTION_TYPES.SHORT,
    source: 'practice',
    tags: ['live'],
    question: `Write a concise explanation (5-7 lines) for a key concept from "${chapter}".`,
    answer: `This is an open-ended practice prompt. Answer with a short, structured explanation (definition → key points → example).`,
    keywords: ['definition', 'key points', 'example']
  };
}

function generateSocialScienceQuestion({ grade, chapter }) {
  // Social Science templates: dates, events, definitions.
  const ch = String(chapter).toLowerCase();

  // History: Date/Event matching
  if (ch.includes('nationalism') || ch.includes('revolution') || ch.includes('world')) {
    return {
      id: makeId(`live-g${grade}-ss-hist`),
      grade,
      subject: 'Social Science',
      chapter,
      type: QUESTION_TYPES.SHORT,
      source: 'practice',
      tags: ['live', 'history'],
      question: `Describe the significance of a major event or figure from "${chapter}".`,
      answer: `This is an open-ended practice prompt. Identify a key event/figure (e.g., year, location, impact) and explain its importance in 3-4 sentences.`,
      keywords: ['significance', 'impact', 'date', 'event']
    };
  }

  // Geography: Map/Resource questions
  if (ch.includes('resource') || ch.includes('agriculture') || ch.includes('industry') || ch.includes('india')) {
    return {
      id: makeId(`live-g${grade}-ss-geo`),
      grade,
      subject: 'Social Science',
      chapter,
      type: QUESTION_TYPES.SHORT,
      source: 'practice',
      tags: ['live', 'geography'],
      question: `Explain the geographical conditions required for a specific crop or industry discussed in "${chapter}".`,
      answer: `This is an open-ended practice prompt. Mention climate (temperature, rainfall), soil type, and major producing regions.`,
      keywords: ['climate', 'soil', 'region', 'temperature', 'rainfall']
    };
  }

  // Civics/Pol Sci: Rights/Democracy
  if (ch.includes('democracy') || ch.includes('power') || ch.includes('federalism') || ch.includes('party')) {
    return {
      id: makeId(`live-g${grade}-ss-civ`),
      grade,
      subject: 'Social Science',
      chapter,
      type: QUESTION_TYPES.MCQ,
      source: 'practice',
      tags: ['live', 'civics'],
      question: `Which of the following is a key feature of the political system discussed in "${chapter}"?`,
      options: ['Feature A', 'Feature B', 'Feature C', 'Feature D'],
      correctOption: 1,
      answer: `Identify the correct feature based on the chapter content (e.g., power sharing arrangement, federal provision, or democratic right).`,
      keywords: ['feature', 'democracy', 'right', 'provision']
    };
  }

  // Economics: Development/Sectors
  if (ch.includes('development') || ch.includes('sector') || ch.includes('economy') || ch.includes('credit')) {
    return {
      id: makeId(`live-g${grade}-ss-eco`),
      grade,
      subject: 'Social Science',
      chapter,
      type: QUESTION_TYPES.SHORT,
      source: 'practice',
      tags: ['live', 'economics'],
      question: `Define a key economic term from "${chapter}" and give an example.`,
      answer: `This is an open-ended practice prompt. Define the term (e.g., GDP, formal sector, collateral) and provide a relevant example from daily life.`,
      keywords: ['definition', 'example', 'economic term']
    };
  }

  // Fallback Social Science
  return {
    id: makeId(`live-g${grade}-ss`),
    grade,
    subject: 'Social Science',
    chapter,
    type: QUESTION_TYPES.SHORT,
    source: 'practice',
    tags: ['live'],
    question: `Write a short note on a central theme of "${chapter}".`,
    answer: `This is an open-ended practice prompt. Summarize the main idea or theme of the chapter in 4-5 lines.`,
    keywords: ['summary', 'theme', 'key points']
  };
}

function generateQuestionsFallback({ grade, subject, chapter, count, excludeIds = new Set() }) {
  const out = [];
  let attempts = 0;

  while (out.length < count && attempts < count * 12) {
    attempts += 1;
    const g = Number(grade);
    const s = String(subject);
    const c = String(chapter || '');

    let q = null;
    if (s === 'Mathematics') q = generateMathQuestion({ grade: g, chapter: c });
    else if (s === 'Science') q = generateScienceQuestion({ grade: g, chapter: c });
    else if (s === 'Social Science') q = generateSocialScienceQuestion({ grade: g, chapter: c });

    if (!q) {
      q = {
        id: makeId(`live-g${g}`),
        grade: g,
        subject: s,
        chapter: c || 'General',
        type: QUESTION_TYPES.SHORT,
        source: 'practice',
        tags: ['live'],
        question: `Write a short answer practice response for: ${c || s}.`,
        answer: `This is an open-ended practice prompt.`,
        keywords: []
      };
    }

    if (excludeIds.has(q.id)) continue;
    excludeIds.add(q.id);
    out.push(q);
  }

  return out;
}

async function generateQuestionsAI({ grade, subject, chapter, chapterChoices = [], count, questionType, excludeIds = new Set() }) {
  if (!gemini?.isGeminiEnabled?.()) return [];

  try {
    const generated = await gemini.generateQuestions({
      grade: Number(grade),
      subject: String(subject),
      chapter: chapter ? String(chapter) : '',
      chapterChoices: Array.isArray(chapterChoices) ? chapterChoices : [],
      count,
      questionType: questionType || null,
      timeoutMs: 30000
    });

    const out = [];
    for (const q of generated) {
      if (!q || typeof q !== 'object') continue;
      if (!q.id || excludeIds.has(q.id)) continue;
      excludeIds.add(q.id);
      out.push(q);
    }
    return out;
  } catch (e) {
    console.warn('[ai] Gemini generation failed:', e?.message || e);
    return [];
  }
}

async function selectQuestions({ grade, subject, chapter, rounds, questionType, useAi }) {
  const requested = Math.max(1, parseInt(rounds, 10) || 5);
  let selected = [];
  const excludeIds = new Set();

  const g = Number(grade) || 10;
  const s = subject || 'Mathematics';
  const c = chapter || '';

  // 1. If AI is enabled, try to fetch ALL questions from AI first (Main Source)
  if (useAi) {
    // For "All chapters" selection, allow AI to pick from curriculum map when available.
    let chapterChoices = [];
    if (!c) {
      const fromCurriculum = CURRICULUM?.[g]?.[s];
      if (Array.isArray(fromCurriculum) && fromCurriculum.length) {
        chapterChoices = fromCurriculum;
      } else {
        const set = new Set(
          QUESTION_BANK.filter(q => q.grade === g && q.subject === s).map(q => q.chapter)
        );
        chapterChoices = Array.from(set);
      }
    }

    const generated = await generateQuestionsAI({
      grade: g,
      subject: s,
      chapter: c,
      chapterChoices,
      count: requested,
      questionType,
      excludeIds
    });
    
    selected = selected.concat(generated);
    generated.forEach(q => excludeIds.add(q.id));
  }

  // 2. If we still need questions, try the Static Question Bank
  if (selected.length < requested) {
    let filtered = [...QUESTION_BANK];
    if (grade) filtered = filtered.filter(q => q.grade === Number(grade));
    if (subject) filtered = filtered.filter(q => q.subject === subject);
    if (chapter) filtered = filtered.filter(q => q.chapter === chapter);
    if (questionType) filtered = filtered.filter(q => q.type === questionType);
    
    // Filter out ones we already got from AI (unlikely collision, but safe)
    filtered = filtered.filter(q => !excludeIds.has(q.id));

    shuffleArray(filtered);
    const needed = requested - selected.length;
    const fromBank = filtered.slice(0, needed);
    
    selected = selected.concat(fromBank);
    fromBank.forEach(q => excludeIds.add(q.id));
  }

  // 3. If still short, use Fallback Generator
  if (selected.length < requested) {
    const needed = requested - selected.length;
    const fallback = generateQuestionsFallback({
      grade: g,
      subject: s,
      chapter: c,
      count: needed,
      excludeIds
    });
    selected = selected.concat(fallback);
  }

  return {
    questions: selected,
    rounds: selected.length,
    available: selected.length // Approximation since we generated on demand
  };
}

// Express routes
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

app.get('/styles.css', (req, res) => {
  if (!STYLES_CSS_PATH) return res.status(404).send('styles.css not found');
  res.sendFile(STYLES_CSS_PATH);
});

app.get('/', (req, res) => res.redirect('/host'));
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get('/host', (req, res) => {
  if (!HOST_HTML_PATH) return res.status(500).send('host.html not found');
  res.sendFile(HOST_HTML_PATH);
});

app.get('/join/:roomId', (req, res) => {
  if (!PLAYER_HTML_PATH) return res.status(500).send('player.html not found');
  res.sendFile(PLAYER_HTML_PATH);
});

function createRoomId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getPublicRoomState(room) {
  const q = room.questions[room.questionIndex];
  return {
    questionIndex: room.questionIndex,
    totalRounds: room.totalRounds,
    state: room.state,
    players: Object.values(room.players),
    currentQuestion: room.state === 'in_question' || room.state === 'showing_answer' ? {
      question: q.question,
      type: q.type,
      options: q.options,
      diagramUrl: getDiagramUrl(q.diagram),
      imageSearchQuery: q.image_search_query || null,
      source: TRUSTED_SOURCES[q.source] || { name: q.source }
    } : null
  };
}

// Socket.IO
io.on('connection', socket => {
  socket.on('getQuestionCatalog', () => {
    socket.emit('questionCatalog', getQuestionCatalog());
  });

  socket.on('createRoom', async ({ hostName, totalRounds, grade, subject, chapter, useAi, playAsHost }) => {
    const roomId = createRoomId();

    // If unlimited rounds (-1), set a flag and fetch a small initial batch (e.g. 5)
    // The "rounds" variable here will track the *currently available* count for display, or we can use a special value.
    // However, the client expects a number. Let's handle it.
    let isUnlimited = false;
    let requestedRounds = parseInt(totalRounds, 10) || 5;
    
    if (requestedRounds === -1) {
      isUnlimited = true;
      requestedRounds = 5; // Initial batch
    }

    const { questions, rounds } = await selectQuestions({
      grade,
      subject,
      chapter,
      rounds: requestedRounds,
      useAi: Boolean(useAi)
    });

    if (!questions.length) {
      return socket.emit('errorMessage', 'No questions found for selected filters.');
    }

    rooms[roomId] = {
      id: roomId,
      hostId: socket.id,
      hostName: hostName?.trim() || 'Host',
      players: {},
      questions,
      questionIndex: 0,
      totalRounds: isUnlimited ? 'Unlimited' : rounds,
      isUnlimited,
      // Store filter params for re-fetching
      filterParams: { grade, subject, chapter, useAi: Boolean(useAi) },
      done: new Set(),
      finishTimes: {},
      answers: {},
      state: 'waiting',
      startTime: null
    };

    // If host wants to play, add them to players list immediately
    if (playAsHost) {
      rooms[roomId].players[socket.id] = { 
        id: socket.id, 
        name: (hostName?.trim() || 'Host') + ' (Host)' 
      };
    }

    socket.join(roomId);
    const baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || null;
    socket.emit('roomCreated', {
      roomId,
      joinUrl: baseUrl ? `${baseUrl}/join/${roomId}` : null,
      totalRounds: rounds,
      hostName: rooms[roomId].hostName
    });
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMessage', 'Room not found.');
    if (room.hostId === socket.id) return socket.emit('errorMessage', 'You are the host.');

    room.players[socket.id] = { id: socket.id, name: name?.trim() || 'Player' };
    socket.join(roomId);
    io.to(room.hostId).emit('playerListUpdate', { players: Object.values(room.players) });
    socket.emit('joinedRoom', { roomId, playerName: room.players[socket.id].name, state: getPublicRoomState(room) });
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    room.state = 'in_question';
    room.questionIndex = 0;
    room.done = new Set();
    room.finishTimes = {};
    room.answers = {};
    room.startTime = Date.now();

    const q = room.questions[room.questionIndex];
    io.to(roomId).emit('questionStarted', {
      questionIndex: room.questionIndex + 1,
      totalRounds: room.totalRounds,
      question: q.question,
      type: q.type,
      options: q.options,
      diagramUrl: getDiagramUrl(q.diagram),
      imageSearchQuery: q.image_search_query || null,
      source: TRUSTED_SOURCES[q.source] || { name: q.source },
      startTime: room.startTime
    });
  });

  socket.on('playerDone', ({ roomId, answer }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'in_question' || !room.players[socket.id]) return;
    if (room.done.has(socket.id)) return;

    room.done.add(socket.id);
    room.finishTimes[socket.id] = Date.now() - room.startTime;
    if (answer !== undefined) room.answers[socket.id] = answer;

    // Check if all players done
    if (room.done.size >= Object.keys(room.players).length) {
      const q = room.questions[room.questionIndex];
      room.state = 'showing_answer';

      const times = {};
      const playerAnswers = {};
      Object.entries(room.players).forEach(([id, player]) => {
        times[player.name] = room.finishTimes[id] || null;
        if (room.answers[id] !== undefined) {
          playerAnswers[player.name] = {
            answer: room.answers[id],
            correct: q.type === QUESTION_TYPES.MCQ ? room.answers[id] === q.correctOption : null
          };
        }
      });

      io.to(roomId).emit('showAnswer', {
        questionIndex: room.questionIndex + 1,
        totalRounds: room.totalRounds,
        question: q.question,
        type: q.type,
        options: q.options,
        correctOption: q.correctOption,
        answer: q.answer,
        keywords: q.keywords,
        diagramUrl: getDiagramUrl(q.diagram),
        imageSearchQuery: q.image_search_query || null,
        source: TRUSTED_SOURCES[q.source] || { name: q.source },
        finishTimes: times,
        playerAnswers
      });
    }
  });

  // Solo mode convenience: if there are no connected players, allow host to reveal the answer.
  // This keeps multiplayer behavior unchanged (host cannot reveal early when players are present).
  socket.on('hostRevealAnswer', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id || room.state !== 'in_question') return;
    if (Object.keys(room.players || {}).length > 0) return;

    const q = room.questions[room.questionIndex];
    room.state = 'showing_answer';

    io.to(roomId).emit('showAnswer', {
      questionIndex: room.questionIndex + 1,
      totalRounds: room.totalRounds,
      question: q.question,
      type: q.type,
      options: q.options,
      correctOption: q.correctOption,
      answer: q.answer,
      keywords: q.keywords,
      diagramUrl: getDiagramUrl(q.diagram),
      imageSearchQuery: q.image_search_query || null,
      source: TRUSTED_SOURCES[q.source] || { name: q.source },
      finishTimes: {},
      playerAnswers: {}
    });
  });

  socket.on('hostNext', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id || room.state !== 'showing_answer') return;

    room.questionIndex += 1;

    // Check if game should end (only if NOT unlimited)
    if (!room.isUnlimited && room.questionIndex >= room.totalRounds) {
      room.state = 'finished';
      return io.to(roomId).emit('gameOver', { totalRounds: room.totalRounds });
    }

    // Unlimited Logic: If we are near the end of the question buffer, fetch more!
    if (room.isUnlimited && (room.questions.length - room.questionIndex) <= 2) {
      // Fetch 5 more questions
      const { questions: newQuestions } = await selectQuestions({
        ...room.filterParams,
        rounds: 5
      });
      
      // Filter duplicates just in case
      const existingIds = new Set(room.questions.map(q => q.id));
      for (const nq of newQuestions) {
        if (!existingIds.has(nq.id)) {
          room.questions.push(nq);
        }
      }
      
      // If we still ran out (e.g. static bank exhausted and AI failed), handle gracefully
      if (room.questionIndex >= room.questions.length) {
         room.state = 'finished';
         return io.to(roomId).emit('gameOver', { totalRounds: room.questionIndex });
      }
    }

    room.state = 'in_question';
    room.done = new Set();
    room.finishTimes = {};
    room.answers = {};
    room.startTime = Date.now();

    const q = room.questions[room.questionIndex];
    io.to(roomId).emit('questionStarted', {
      questionIndex: room.questionIndex + 1,
      totalRounds: room.totalRounds,
      question: q.question,
      type: q.type,
      options: q.options,
      diagramUrl: getDiagramUrl(q.diagram),
      imageSearchQuery: q.image_search_query || null,
      source: TRUSTED_SOURCES[q.source] || { name: q.source },
      startTime: room.startTime
    });
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.hostId === socket.id) {
        io.to(roomId).emit('errorMessage', 'Host disconnected.');
        delete rooms[roomId];
      } else if (room.players[socket.id]) {
        delete room.players[socket.id];
        room.done.delete(socket.id);
        delete room.finishTimes[socket.id];
        delete room.answers[socket.id];
        if (room.hostId) {
          io.to(room.hostId).emit('playerListUpdate', { players: Object.values(room.players) });
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`NCERT Timer Study running on http://localhost:${PORT}`);
});
