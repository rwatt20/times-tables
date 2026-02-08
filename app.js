const $ = (id) => document.getElementById(id);

// Sections
const setupEl = $("setup");
const gameEl = $("game");
const resultsEl = $("results");
const teacherEl = $("teacher");

// Inputs
const kidNameEl = $("kidName");
const levelEl = $("level");
const modeEl = $("mode");
const numQuestionsEl = $("numQuestions");
const focusTableEl = $("focusTable");
const focusWrapEl = $("focusWrap");
const minTableEl = $("minTable");
const maxTableEl = $("maxTable");
const timedEl = $("timed");
const soundsEl = $("sounds");
const bigUIEl = $("bigUI");

// Buttons
const startBtn = $("startBtn");
const submitBtn = $("submitBtn");
const quitBtn = $("quitBtn");
const restartBtn = $("restartBtn");
const reviewMissedBtn = $("reviewMissedBtn");

const teacherBtn = $("teacherBtn");
const backBtn = $("backBtn");
const clearHistoryBtn = $("clearHistoryBtn");

// Game display
const aEl = $("a");
const bEl = $("b");
const answerEl = $("answer");
const feedbackEl = $("feedback");
const scoreEl = $("score");
const streakEl = $("streak");
const progressEl = $("progress");
const timerBoxEl = $("timerBox");
const timeLeftEl = $("timeLeft");
const starsEl = $("stars");
const badgeEl = $("badge");

// Results display
const finalScoreEl = $("finalScore");
const accuracyEl = $("accuracy");
const finalStarsEl = $("finalStars");
const finalBadgeEl = $("finalBadge");
const missedBoxEl = $("missedBox");
const missedListEl = $("missedList");

// Teacher dashboard
const filterNameEl = $("filterName");
const filterCountEl = $("filterCount");
const summaryEl = $("summary");
const historyTableBody = $("historyTable").querySelector("tbody");
const topMissedEl = $("topMissed");

// Keypad
const keypadEl = $("keypad");

// Storage keys
const HISTORY_KEY = "ttt_history_v1";
const MISSED_KEY = "ttt_missed_counts_v1";

let state = null;
let timerId = null;

// ---------- helpers ----------
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function nowISO() { return new Date().toISOString(); }
function niceDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------- sounds (Web Audio API, no files needed) ----------
let audioCtx = null;
function beep(type) {
  if (!soundsEl.checked) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);

    let freq = 440, dur = 0.12;
    if (type === "good") { freq = 880; dur = 0.10; }
    if (type === "bad")  { freq = 220; dur = 0.14; }
    if (type === "end")  { freq = 660; dur = 0.18; }

    o.frequency.value = freq;
    o.type = "sine";

    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.start(t0);
    o.stop(t0 + dur);
  } catch {
    // ignore sound errors
  }
}

// ---------- level logic ----------
function levelSettings(level) {
  // Factor range for b, and time limits
  // bRange grows with difficulty; also allows 0 early for confidence.
  // You can tweak these easily.
  const L = clamp(level, 1, 5);
  const bMin = (L <= 2) ? 0 : 1;
  const bMax = [5, 8, 10, 12, 12][L - 1];
  const time = [90, 75, 60, 60, 45][L - 1];
  return { bMin, bMax, timeLimit: time };
}

// ---------- rewards ----------
function calcStars({ accuracy, bestStreak, timed, level }) {
  // simple + motivating:
  // - base from accuracy
  // - bonus for streaks
  // - bonus for timed
  // - bonus for higher levels
  let stars = 0;
  if (accuracy >= 60) stars += 1;
  if (accuracy >= 75) stars += 1;
  if (accuracy >= 90) stars += 1;
  if (bestStreak >= 5) stars += 1;
  if (bestStreak >= 10) stars += 1;
  if (timed) stars += 1;
  if (level >= 4) stars += 1;
  return clamp(stars, 0, 7);
}

function calcBadge({ accuracy, bestStreak, timed, level, missedCount }) {
  if (accuracy === 100 && timed && level >= 4) return "Lightning Legend ⚡";
  if (accuracy === 100) return "Perfect Round 💯";
  if (bestStreak >= 12) return "Streak Star ⭐";
  if (accuracy >= 90) return "Accuracy Ace 🎯";
  if (missedCount === 0 && accuracy >= 85) return "Clean Run 🧼";
  if (accuracy >= 75) return "Solid Work 👍";
  return "Keep Going 💪";
}

// ---------- question generation ----------
function makeFactKey(a, b) { return `${a}x${b}`; }

function nextQuestion() {
  const { bMin, bMax } = state.levelCfg;

  if (state.mode === "missed") {
    // pull from missed pool; if empty, fallback to mixed
    if (state.missedPool.length === 0) {
      state.mode = "mixed";
      state.modeWasAutoFallback = true;
    } else {
      // weighted choice: pick items with higher missCount more often
      const totalWeight = state.missedPool.reduce((s, x) => s + x.weight, 0);
      let r = Math.random() * totalWeight;
      for (const item of state.missedPool) {
        r -= item.weight;
        if (r <= 0) {
          state.current = { a: item.a, b: item.b, correct: item.a * item.b, key: makeFactKey(item.a, item.b) };
          aEl.textContent = item.a;
          bEl.textContent = item.b;
          answerEl.value = "";
          answerEl.focus();
          return;
        }
      }
    }
  }

  let a, b;
  if (state.mode === "focus") {
    a = clamp(parseInt(state.focusTable, 10) || 7, 1, 12);
    b = randInt(bMin, bMax);
  } else {
    // mixed
    a = randInt(state.minTable, state.maxTable);
    b = randInt(bMin, bMax);
  }

  state.current = { a, b, correct: a * b, key: makeFactKey(a, b) };
  aEl.textContent = a;
  bEl.textContent = b;
  answerEl.value = "";
  answerEl.focus();
}

// ---------- missed tracking ----------
function bumpMissedCount(key) {
  const counts = loadJSON(MISSED_KEY, {});
  counts[key] = (counts[key] || 0) + 1;
  saveJSON(MISSED_KEY, counts);
}

function buildMissedPool() {
  const counts = loadJSON(MISSED_KEY, {});
  // only include facts that match current table constraints
  const pool = [];
  const { bMin, bMax } = state.levelCfg;

  const within = (a, b) => {
    if (b < bMin || b > bMax) return false;
    if (state.mode === "focus") return a === state.focusTable;
    // in review mode we still honor the table-range from setup unless user is focus
    return a >= state.minTable && a <= state.maxTable;
  };

  for (const [key, c] of Object.entries(counts)) {
    const [aStr, bStr] = key.split("x");
    const a = Number(aStr), b = Number(bStr);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (!within(a, b)) continue;
    pool.push({ a, b, weight: Math.min(1 + c, 10) }); // cap weight
  }
  return pool;
}

// ---------- UI helpers ----------
function applyBigUI() {
  document.body.style.fontSize = bigUIEl.checked ? "18px" : "16px";
  answerEl.style.fontSize = bigUIEl.checked ? "30px" : "26px";
}

function setBadgeAndStarsLive() {
  // updated at end of each answer
  starsEl.textContent = String(state.stars);
  badgeEl.textContent = state.badge || "—";
}

// ---------- game lifecycle ----------
function startGame(opts = {}) {
  applyBigUI();

  const kidName = (kidNameEl.value || "").trim();
  const level = clamp(parseInt(levelEl.value, 10) || 4, 1, 5);
  const levelCfg = levelSettings(level);

  const mode = modeEl.value; // mixed | focus | missed
  const total = clamp(parseInt(numQuestionsEl.value, 10) || 20, 5, 100);

  const minT = clamp(parseInt(minTableEl.value || "2", 10), 1, 12);
  const maxT = clamp(parseInt(maxTableEl.value || "12", 10), 1, 12);
  const minTable = Math.min(minT, maxT);
  const maxTable = Math.max(minT, maxT);

  const focusTable = clamp(parseInt(focusTableEl.value || "7", 10), 1, 12);

  const timed = !!timedEl.checked;
  const timeLimit = timed ? levelCfg.timeLimit : null;

  // If starting review from results button, we can force missed mode
  const forcedMode = opts.forceMode || mode;

  state = {
    kidName,
    level,
    levelCfg,
    mode: forcedMode,
    modeWasAutoFallback: false,
    total,
    index: 0,
    score: 0,
    correctCount: 0,
    streak: 0,
    bestStreak: 0,
    missedThisSession: [],
    minTable,
    maxTable,
    focusTable,
    timed,
    timeLeft: timeLimit,
    stars: 0,
    badge: "—",
    current: null,
    missedPool: []
  };

  // Build missed pool if needed
  if (state.mode === "missed") {
    state.missedPool = buildMissedPool();
  }

  // UI resets
  scoreEl.textContent = "0";
  streakEl.textContent = "0";
  progressEl.textContent = `0/${state.total}`;
  feedbackEl.textContent = "";
  starsEl.textContent = "0";
  badgeEl.textContent = "—";

  hide(setupEl);
  hide(resultsEl);
  hide(teacherEl);
  show(gameEl);

  if (state.timed) {
    show(timerBoxEl);
    timeLeftEl.textContent = String(state.timeLeft);
    timerId = setInterval(() => {
      if (!state) return;
      state.timeLeft -= 1;
      timeLeftEl.textContent = String(state.timeLeft);
      if (state.timeLeft <= 0) endGame();
    }, 1000);
  } else {
    hide(timerBoxEl);
  }

  nextQuestion();
}

function submitAnswer() {
  if (!state) return;
  const raw = answerEl.value.trim();
  if (raw === "") return;

  const user = Number(raw);
  const { a, b, correct, key } = state.current;

  state.index += 1;
  const isCorrect = user === correct;

  if (isCorrect) {
    state.score += 1;
    state.correctCount += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    feedbackEl.textContent = "✅ Correct!";
    beep("good");
  } else {
    state.streak = 0;
    state.missedThisSession.push({ a, b, correct, user });
    feedbackEl.textContent = `❌ Not quite. ${a} × ${b} = ${correct}`;
    bumpMissedCount(key);
    beep("bad");
  }

  // live rewards estimate
  const accuracy = Math.round((state.correctCount / state.index) * 100);
  state.stars = calcStars({
    accuracy,
    bestStreak: state.bestStreak,
    timed: state.timed,
    level: state.level
  });
  state.badge = calcBadge({
    accuracy,
    bestStreak: state.bestStreak,
    timed: state.timed,
    level: state.level,
    missedCount: state.missedThisSession.length
  });
  setBadgeAndStarsLive();

  scoreEl.textContent = String(state.score);
  streakEl.textContent = String(state.streak);
  progressEl.textContent = `${state.index}/${state.total}`;

  if (state.index >= state.total) {
    endGame();
  } else {
    nextQuestion();
  }
}

function endGame() {
  if (!state) return;

  if (timerId) { clearInterval(timerId); timerId = null; }

  hide(gameEl);
  show(resultsEl);

  const accuracy = Math.round((state.correctCount / state.total) * 100);
  const stars = calcStars({
    accuracy,
    bestStreak: state.bestStreak,
    timed: state.timed,
    level: state.level
  });
  const badge = calcBadge({
    accuracy,
    bestStreak: state.bestStreak,
    timed: state.timed,
    level: state.level,
    missedCount: state.missedThisSession.length
  });

  finalScoreEl.textContent = `${state.score} / ${state.total}`;
  accuracyEl.textContent = String(accuracy);
  finalStarsEl.textContent = String(stars);
  finalBadgeEl.textContent = badge;

  // Missed list
  missedListEl.innerHTML = "";
  if (state.missedThisSession.length > 0) {
    show(missedBoxEl);
    for (const m of state.missedThisSession) {
      const li = document.createElement("li");
      li.textContent = `${m.a} × ${m.b} = ${m.correct} (you said ${m.user})`;
      missedListEl.appendChild(li);
    }
  } else {
    hide(missedBoxEl);
  }

  // Save session to history
  const history = loadJSON(HISTORY_KEY, []);
  history.unshift({
    date: nowISO(),
    kidName: state.kidName || "",
    mode: state.modeWasAutoFallback ? "review→mixed" : state.mode,
    level: state.level,
    timed: state.timed,
    total: state.total,
    score: state.score,
    accuracy,
    stars,
    badge
  });
  saveJSON(HISTORY_KEY, history.slice(0, 500)); // cap

  beep("end");

  // keep a tiny “last setup” for review button
  window.__lastSetup = {
    kidName: state.kidName,
    level: state.level,
    numQuestions: state.total,
    minTable: state.minTable,
    maxTable: state.maxTable,
    focusTable: state.focusTable,
    timed: state.timed
  };

  // clear state so Enter doesn’t keep answering
  state = null;
}

// ---------- teacher dashboard ----------
function renderTeacherDashboard() {
  const history = loadJSON(HISTORY_KEY, []);
  const counts = loadJSON(MISSED_KEY, {});
  const filterName = (filterNameEl.value || "").trim().toLowerCase();
  const maxCount = parseInt(filterCountEl.value, 10) || 25;

  let rows = history;
  if (filterName) {
    rows = rows.filter(r => (r.kidName || "").toLowerCase().includes(filterName));
  }
  rows = rows.slice(0, maxCount);

  // summary
  if (rows.length === 0) {
    summaryEl.textContent = "No sessions match your filter yet.";
  } else {
    const avgAcc = Math.round(rows.reduce((s, r) => s + (r.accuracy || 0), 0) / rows.length);
    const bestAcc = Math.max(...rows.map(r => r.accuracy || 0));
    const totalSessions = rows.length;
    const totalStars = rows.reduce((s, r) => s + (r.stars || 0), 0);
    summaryEl.innerHTML = `
      <strong>Sessions:</strong> ${totalSessions} &nbsp; | &nbsp;
      <strong>Avg accuracy:</strong> ${avgAcc}% &nbsp; | &nbsp;
      <strong>Best accuracy:</strong> ${bestAcc}% &nbsp; | &nbsp;
      <strong>Total stars:</strong> ${totalStars} ⭐
    `;
  }

  // table
  historyTableBody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${niceDate(r.date)}</td>
      <td>${escapeHTML(r.kidName || "")}</td>
      <td>${escapeHTML(r.mode || "")}</td>
      <td>${r.level}</td>
      <td>${r.timed ? "Yes" : "No"}</td>
      <td>${r.score}/${r.total}</td>
      <td>${r.accuracy}%</td>
      <td>${r.stars}</td>
      <td>${escapeHTML(r.badge || "")}</td>
    `;
    historyTableBody.appendChild(tr);
  }

  // Top missed facts
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  topMissedEl.innerHTML = "";
  if (top.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No missed facts recorded yet.";
    topMissedEl.appendChild(li);
  } else {
    for (const [key, c] of top) {
      const li = document.createElement("li");
      li.textContent = `${key.replace("x", " × ")}  — missed ${c} time(s)`;
      topMissedEl.appendChild(li);
    }
  }
}

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- event wiring ----------
modeEl.addEventListener("change", () => {
  const m = modeEl.value;
  if (m === "focus") show(focusWrapEl);
  else hide(focusWrapEl);
});

bigUIEl.addEventListener("change", applyBigUI);

// Keypad clicks
keypadEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const k = btn.getAttribute("data-k");
  if (!k) return;

  if (k === "bk") {
    answerEl.value = answerEl.value.slice(0, -1);
    answerEl.focus();
    return;
  }
  if (k === "ok") {
    submitAnswer();
    return;
  }
  answerEl.value += k;
  answerEl.focus();
});

startBtn.addEventListener("click", () => startGame());

submitBtn.addEventListener("click", submitAnswer);
quitBtn.addEventListener("click", endGame);

restartBtn.addEventListener("click", () => {
  hide(resultsEl);
  show(setupEl);
});

reviewMissedBtn.addEventListener("click", () => {
  // keep last settings but force missed mode
  if (window.__lastSetup) {
    kidNameEl.value = window.__lastSetup.kidName || "";
    levelEl.value = String(window.__lastSetup.level || 4);
    numQuestionsEl.value = String(window.__lastSetup.numQuestions || 20);
    minTableEl.value = String(window.__lastSetup.minTable || 2);
    maxTableEl.value = String(window.__lastSetup.maxTable || 12);
    focusTableEl.value = String(window.__lastSetup.focusTable || 7);
    timedEl.checked = !!window.__lastSetup.timed;
  }

  modeEl.value = "missed";
  hide(resultsEl);
  startGame({ forceMode: "missed" });
});

answerEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAnswer();
});

// Parent/Teacher
teacherBtn.addEventListener("click", () => {
  hide(setupEl);
  hide(gameEl);
  hide(resultsEl);
  show(teacherEl);
  renderTeacherDashboard();
});

backBtn.addEventListener("click", () => {
  hide(teacherEl);
  show(setupEl);
});

filterNameEl.addEventListener("input", renderTeacherDashboard);
filterCountEl.addEventListener("change", renderTeacherDashboard);

clearHistoryBtn.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(MISSED_KEY);
  renderTeacherDashboard();
});

// initial state
applyBigUI();
hide(focusWrapEl);
