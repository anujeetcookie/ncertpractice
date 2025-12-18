const path = require('path');
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
      ? {
          origin: allowedOrigins,
          methods: ['GET', 'POST']
        }
      : undefined
});

const PORT = process.env.PORT || 3000;

// In-memory room state
const rooms = {};

// Simple NCERT-style sample questions.
// Replace text/keywords with official NCERT content as needed.
const QUESTION_BANK = [
  {
    id: 1,
    grade: 10,
    subject: 'Science',
    chapter: 'Life Processes',
    question:
      'Explain the process of photosynthesis in plants. Mention the raw materials and products.',
    answer:
      'Photosynthesis is the process by which green plants prepare their own food using light energy. It occurs in the chloroplasts present in the green parts of the plant. In this process, carbon dioxide from the air and water absorbed by roots combine in the presence of chlorophyll and sunlight to form carbohydrates (glucose). Oxygen is released as a by-product. Thus, the essential raw materials are carbon dioxide, water, chlorophyll and sunlight, and the main products are carbohydrates and oxygen.',
    source: {
      label: 'NCERT (official) textbook resource',
      url: 'https://ncert.nic.in/textbook.php'
    },
    keywords: [
      'chloroplasts',
      'chlorophyll',
      'sunlight',
      'carbon dioxide',
      'water',
      'carbohydrates',
      'glucose',
      'oxygen',
      'raw materials',
      'by-product'
    ]
  },
  {
    id: 2,
    grade: 10,
    subject: 'Physics',
    chapter: 'Force and Laws of Motion',
    question:
      'State Newton’s third law of motion and give one example to illustrate it.',
    answer:
      "Newton's third law of motion states that to every action there is an equal and opposite reaction and they act on two different bodies. When a body A exerts a force on body B, body B simultaneously exerts a force of the same magnitude but in the opposite direction on body A. For example, when a person walks on the ground, their foot pushes the ground backward (action) and the ground pushes the foot forward with an equal and opposite force (reaction), enabling the person to move forward.",
    source: {
      label: 'NCERT (official) textbook resource',
      url: 'https://ncert.nic.in/textbook.php'
    },
    keywords: [
      'equal and opposite',
      'action',
      'reaction',
      'different bodies',
      'same magnitude',
      'opposite direction',
      'example',
      'walking',
      'pushes the ground',
      'pushes the foot forward'
    ]
  },
  {
    id: 3,
    grade: 10,
    subject: 'Chemistry',
    chapter: 'Acids, Bases and Salts',
    question:
      'What is neutralisation? Write a balanced chemical equation for the reaction between hydrochloric acid and sodium hydroxide.',
    answer:
      'Neutralisation is the reaction in which an acid reacts with a base to form salt and water. In this reaction, the hydrogen ions from the acid combine with hydroxide ions from the base to form water, and the remaining ions form a salt. For example, when hydrochloric acid reacts with sodium hydroxide, sodium chloride and water are formed. The balanced chemical equation is: HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l).',
    source: {
      label: 'NCERT (official) textbook resource',
      url: 'https://ncert.nic.in/textbook.php'
    },
    keywords: [
      'neutralisation',
      'acid',
      'base',
      'salt',
      'water',
      'hydrogen ions',
      'hydroxide ions',
      'sodium chloride',
      'HCl',
      'NaOH',
      'H₂O'
    ]
  }
];

const TRUSTED_SOURCE_HOSTS = ['ncert.nic.in'];

function isTrustedSource(source) {
  if (!source || !source.url) return false;
  try {
    const u = new URL(source.url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return TRUSTED_SOURCE_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

function getQuestionCatalog() {
  const trusted = QUESTION_BANK.filter(q => isTrustedSource(q.source));

  const grades = Array.from(
    new Set(trusted.map(q => q.grade).filter(g => typeof g === 'number'))
  ).sort((a, b) => a - b);

  const subjectsByGrade = {};
  const chaptersByGradeSubject = {};

  trusted.forEach(q => {
    const gradeKey = String(q.grade);
    subjectsByGrade[gradeKey] ||= new Set();
    subjectsByGrade[gradeKey].add(q.subject);

    chaptersByGradeSubject[gradeKey] ||= {};
    chaptersByGradeSubject[gradeKey][q.subject] ||= new Set();
    chaptersByGradeSubject[gradeKey][q.subject].add(q.chapter);
  });

  Object.keys(subjectsByGrade).forEach(g => {
    subjectsByGrade[g] = Array.from(subjectsByGrade[g]).sort();
  });
  Object.keys(chaptersByGradeSubject).forEach(g => {
    Object.keys(chaptersByGradeSubject[g]).forEach(s => {
      chaptersByGradeSubject[g][s] = Array.from(chaptersByGradeSubject[g][s]).sort();
    });
  });

  return {
    grades,
    subjectsByGrade,
    chaptersByGradeSubject
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function selectQuestions({ grade, subject, chapter, rounds }) {
  const trusted = QUESTION_BANK.filter(q => isTrustedSource(q.source));

  const g = grade !== undefined && grade !== null && grade !== '' ? Number(grade) : null;
  const s = subject ? String(subject) : '';
  const c = chapter ? String(chapter) : '';

  const filtered = trusted.filter(q => {
    if (g !== null && Number.isFinite(g) && q.grade !== g) return false;
    if (s && q.subject !== s) return false;
    if (c && q.chapter !== c) return false;
    return true;
  });

  shuffleInPlace(filtered);
  const take = Math.min(filtered.length, Math.max(1, parseInt(rounds, 10) || 1));
  return {
    questions: filtered.slice(0, take),
    rounds: take,
    available: filtered.length
  };
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/host');
});

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/join/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

function createRoomId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function getPublicRoomState(room) {
  return {
    questionIndex: room.questionIndex,
    totalRounds: room.totalRounds,
    state: room.state,
    players: Object.values(room.players),
    currentQuestion:
      room.state === 'in_question' || room.state === 'showing_answer'
        ? {
            question: room.questions[room.questionIndex].question,
            grade: room.questions[room.questionIndex].grade,
            subject: room.questions[room.questionIndex].subject,
            chapter: room.questions[room.questionIndex].chapter,
            source: room.questions[room.questionIndex].source
          }
        : null
  };
}

io.on('connection', socket => {
  socket.on('getQuestionCatalog', () => {
    socket.emit('questionCatalog', getQuestionCatalog());
  });

  socket.on('createRoom', ({ hostName, totalRounds, grade, subject, chapter }) => {
    const roomId = createRoomId();

    const { questions, rounds, available } = selectQuestions({
      grade,
      subject,
      chapter,
      rounds: totalRounds
    });

    if (!questions.length) {
      socket.emit(
        'errorMessage',
        'No questions match your Class/Subject/Chapter filters with trusted sources.'
      );
      return;
    }

    rooms[roomId] = {
      id: roomId,
      hostId: socket.id,
      hostName: hostName?.trim() || 'Host',
      players: {},
      questions,
      questionIndex: 0,
      totalRounds: rounds,
      done: new Set(),
      finishTimes: {},
      state: 'waiting',
      startTime: null,
      filters: {
        grade: questions[0]?.grade ?? null,
        subject: subject || '',
        chapter: chapter || '',
        available
      }
    };

    socket.join(roomId);

    const baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || null;
    const joinUrl = baseUrl ? `${baseUrl}/join/${roomId}` : null;

    socket.emit('roomCreated', {
      roomId,
      joinUrl,
      totalRounds: rounds,
      hostName: rooms[roomId].hostName
    });
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('errorMessage', 'Room not found.');
      return;
    }

    // Prevent host from joining as a player again
    if (room.hostId === socket.id) {
      socket.emit('errorMessage', 'You are already the host of this room.');
      return;
    }

    const playerName = name?.trim() || 'Player';
    room.players[socket.id] = {
      id: socket.id,
      name: playerName
    };

    socket.join(roomId);

    // Notify host about new player
    io.to(room.hostId).emit('playerListUpdate', {
      players: Object.values(room.players)
    });

    socket.emit('joinedRoom', {
      roomId,
      playerName,
      state: getPublicRoomState(room)
    });
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    room.state = 'in_question';
    room.questionIndex = 0;
    room.done = new Set();
    room.finishTimes = {};
    room.startTime = Date.now();

    const q = room.questions[room.questionIndex];

    io.to(roomId).emit('questionStarted', {
      questionIndex: room.questionIndex + 1,
      totalRounds: room.totalRounds,
      grade: q.grade,
      subject: q.subject,
      chapter: q.chapter,
      question: q.question,
      source: q.source,
      startTime: room.startTime
    });
  });

  socket.on('playerDone', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.state !== 'in_question') return;
    if (!room.players[socket.id]) return; // only players, not host

    if (room.done.has(socket.id)) return;

    room.done.add(socket.id);
    if (room.startTime) {
      room.finishTimes[socket.id] = Date.now() - room.startTime;
    }

    // If all players are done, reveal answer
    const totalPlayers = Object.keys(room.players).length;
    if (room.done.size >= totalPlayers) {
      const q = room.questions[room.questionIndex];
      room.state = 'showing_answer';

      const times = {};
      Object.entries(room.players).forEach(([id, player]) => {
        times[player.name] = room.finishTimes[id] || null;
      });

      io.to(roomId).emit('showAnswer', {
        questionIndex: room.questionIndex + 1,
        totalRounds: room.totalRounds,
        grade: q.grade,
        subject: q.subject,
        chapter: q.chapter,
        question: q.question,
        answer: q.answer,
        keywords: q.keywords,
        source: q.source,
        finishTimes: times
      });
    }
  });

  socket.on('hostNext', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'showing_answer') return;

    room.questionIndex += 1;

    if (room.questionIndex >= room.totalRounds) {
      room.state = 'finished';
      io.to(roomId).emit('gameOver', {
        totalRounds: room.totalRounds
      });
      return;
    }

    room.state = 'in_question';
    room.done = new Set();
    room.finishTimes = {};
    room.startTime = Date.now();

    const q = room.questions[room.questionIndex];

    io.to(roomId).emit('questionStarted', {
      questionIndex: room.questionIndex + 1,
      totalRounds: room.totalRounds,
      grade: q.grade,
      subject: q.subject,
      chapter: q.chapter,
      question: q.question,
      source: q.source,
      startTime: room.startTime
    });
  });

  socket.on('disconnect', () => {
    // Clean up from any rooms
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.hostId === socket.id) {
        // Host disconnected → end room
        io.to(roomId).emit('errorMessage', 'Host disconnected. Room closed.');
        delete rooms[roomId];
      } else if (room.players[socket.id]) {
        delete room.players[socket.id];
        room.done.delete(socket.id);
        delete room.finishTimes[socket.id];

        if (io.sockets.adapter.rooms.get(roomId)) {
          // Room still exists
          if (room.hostId) {
            io.to(room.hostId).emit('playerListUpdate', {
              players: Object.values(room.players)
            });
          }
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`NCERT Timer Study server running on http://localhost:${PORT}`);
});


