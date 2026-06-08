/* 将棋「次の一手」単語帳 — アプリ本体（純フロントエンド / localStorage） */
"use strict";

const DECK_KEY = "shogi_tango_deck";
const DECK_VERSION = 1;

let deck = { version: DECK_VERSION, cards: [] };

// ------------------------------------------------------------ ストレージ
function loadDeck() {
  try {
    const raw = localStorage.getItem(DECK_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.cards)) deck = { version: d.version || 1, cards: d.cards };
    }
  } catch (e) { console.warn("deck 読み込み失敗", e); }
}
function saveDeck() {
  try {
    localStorage.setItem(DECK_KEY, JSON.stringify(deck));
  } catch (e) {
    alert("保存に失敗しました（ストレージ容量超過の可能性）。書き出しでバックアップしてください。");
    console.error(e);
  }
}
function newId() {
  return "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

// ------------------------------------------------------------ 音
let audioCtx = null;
function tone(freq, dur, when, type) {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  const t0 = audioCtx.currentTime + (when || 0);
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function soundCorrect() { tone(660, 0.12, 0); tone(880, 0.16, 0.12); }
function soundWrong() { tone(180, 0.22, 0, "square"); }

// ------------------------------------------------------------ 成りモーダル
const promoteModal = document.getElementById("promote-modal");
function promptPromotion() {
  return new Promise((resolve) => {
    promoteModal.style.display = "flex";
    const yes = document.getElementById("promote-yes");
    const no = document.getElementById("promote-no");
    const done = (v) => { promoteModal.style.display = "none"; yes.onclick = null; no.onclick = null; resolve(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
  });
}

// ------------------------------------------------------------ タブ切替
const tabs = document.querySelectorAll(".tab");
const views = { quiz: document.getElementById("view-quiz"), edit: document.getElementById("view-edit"), list: document.getElementById("view-list") };
tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === name));
  if (name === "quiz") startQuiz();
  if (name === "list") renderList();
}

function turnText(sfen) {
  const turn = (sfen.split(/\s+/)[1] || "b");
  return turn === "w" ? "☖ 後手番（次の一手）" : "☗ 先手番（次の一手）";
}

// ============================================================ 出題
let quizBoard = null;
let quizQueue = [];
let quizPos = 0;
let quizCard = null;
let quizAnswered = false;

const quizOrderEl = document.getElementById("quiz-order");
const quizWrongOnlyEl = document.getElementById("quiz-wrong-only");
const quizProgressEl = document.getElementById("quiz-progress");
const quizTurnEl = document.getElementById("quiz-turn");
const quizMessageEl = document.getElementById("quiz-message");
const quizCommentEl = document.getElementById("quiz-comment");
const quizBodyEl = document.getElementById("quiz-body");
const quizEmptyEl = document.getElementById("quiz-empty");

function ensureQuizBoard() {
  if (quizBoard) return;
  quizBoard = new ShogiBoard(document.getElementById("quiz-board"), {
    assetBase: "assets",
    interactive: true,
    promote: promptPromotion,
    onMove: onQuizMove,
  });
}

function buildQueue() {
  let cards = deck.cards.slice();
  if (quizWrongOnlyEl.checked) cards = cards.filter((c) => c.stats && c.stats.lastResult === "wrong");
  if (quizOrderEl.value === "random") {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }
  quizQueue = cards;
  quizPos = 0;
}

function startQuiz() {
  if (deck.cards.length === 0) { quizEmptyEl.style.display = "block"; quizBodyEl.style.display = "none"; return; }
  ensureQuizBoard();
  buildQueue();
  if (quizQueue.length === 0) {
    quizEmptyEl.textContent = "条件に合うカードがありません。";
    quizEmptyEl.style.display = "block"; quizBodyEl.style.display = "none";
    return;
  }
  quizEmptyEl.style.display = "none"; quizBodyEl.style.display = "block";
  showQuizCard();
}

let quizMoves = [];        // 一直線の手順（[0]=正解手, 以降=続き）
let quizHadWrong = false;
let quizTimers = [];
function clearQuizTimers() { quizTimers.forEach(clearTimeout); quizTimers = []; }

function showQuizCard() {
  clearQuizTimers();
  quizCard = quizQueue[quizPos];
  quizAnswered = false;
  quizHadWrong = false;
  quizMoves = (quizCard.moves && quizCard.moves.length) ? quizCard.moves.slice() : (quizCard.answers || []).slice();
  quizCard.stats = quizCard.stats || { seen: 0, correct: 0, wrong: 0, lastResult: null };
  quizCard.stats.seen++;
  saveDeck();
  quizBoard.clearArrow();
  quizBoard.setInteractive(true);
  // 後手番のときは指す側を手前にするため盤を自動反転
  quizBoard.setFlip((quizCard.sfen.split(/\s+/)[1] || "b") === "w");
  quizBoard.setSFEN(quizCard.sfen);
  quizTurnEl.textContent = turnText(quizCard.sfen);
  quizMessageEl.textContent = "";
  quizMessageEl.className = "message";
  quizCommentEl.style.display = "none";
  quizProgressEl.textContent = `${quizPos + 1} / ${quizQueue.length}`;
}

// 正解手の後、記録した続きを順に自動再生して最終局面で終了
function playContinuation() {
  let i = 1;
  function step() {
    if (i >= quizMoves.length) { finishQuiz(); return; }
    quizBoard.applyUsi(quizMoves[i]);
    quizBoard.showArrow(quizMoves[i], i % 2 === 0 ? "#5fb98f" : "#fcb74e"); // 自=緑 / 相=橙
    i++;
    quizTimers.push(setTimeout(step, 750));
  }
  quizTimers.push(setTimeout(step, 900));
}
function finishQuiz() {
  quizBoard.clearArrow();
  quizMessageEl.textContent = quizMoves.length > 1 ? "最終局面まで再生 ✅" : "正解！ ⭕";
  quizMessageEl.className = "message ok";
  if (quizCard.comment) { quizCommentEl.textContent = quizCard.comment; quizCommentEl.style.display = "block"; }
}

function onQuizMove(usi) {
  if (quizAnswered) return;
  if (usi === quizMoves[0]) {
    quizAnswered = true;
    if (!quizHadWrong) quizCard.stats.correct++;
    quizCard.stats.lastResult = quizHadWrong ? "wrong" : "correct";
    saveDeck();
    soundCorrect();
    quizBoard.setInteractive(false);
    // 盤は既に正解手を指した状態。矢印を出し、続きを再生。
    quizBoard.showArrow(usi, "#5fb98f");
    quizMessageEl.textContent = quizMoves.length > 1 ? "正解！ 続きを再生…" : "正解！ ⭕";
    quizMessageEl.className = "message ok";
    playContinuation();
  } else {
    quizHadWrong = true;
    quizCard.stats.wrong++;
    quizCard.stats.lastResult = "wrong";
    saveDeck();
    soundWrong();
    quizMessageEl.textContent = "ちがいます ❌ もう一度";
    quizMessageEl.className = "message ng";
    quizTimers.push(setTimeout(() => { if (!quizAnswered) quizBoard.setSFEN(quizCard.sfen); }, 600));
  }
}

document.getElementById("quiz-retry-btn").addEventListener("click", () => {
  if (!quizCard) return;
  clearQuizTimers();
  quizAnswered = false;
  quizBoard.setInteractive(true);
  quizBoard.clearArrow();
  quizBoard.setSFEN(quizCard.sfen);
  quizMessageEl.textContent = ""; quizMessageEl.className = "message";
  quizCommentEl.style.display = "none";
});
document.getElementById("quiz-reveal-btn").addEventListener("click", () => {
  if (!quizCard || quizAnswered) return;
  clearQuizTimers();
  quizAnswered = true;
  quizHadWrong = true; // 見たので正解にはカウントしない
  quizCard.stats.lastResult = "wrong";
  saveDeck();
  quizBoard.setInteractive(false);
  quizBoard.setSFEN(quizCard.sfen);
  quizBoard.applyUsi(quizMoves[0]);          // 正解手を指す（onMoveは発火しない）
  quizBoard.showArrow(quizMoves[0], "#fc7494");
  quizMessageEl.textContent = quizMoves.length > 1 ? "正解はこの手。続きを再生…" : "正解はこの手です";
  quizMessageEl.className = "message";
  playContinuation();
});
document.getElementById("quiz-next-btn").addEventListener("click", () => {
  if (quizQueue.length === 0) return;
  clearQuizTimers();
  quizPos = (quizPos + 1) % quizQueue.length;
  showQuizCard();
});
quizOrderEl.addEventListener("change", startQuiz);
quizWrongOnlyEl.addEventListener("change", startQuiz);

// ============================================================ 登録 / 編集
let editBoard = null;
let editingId = null;
let editProblemSfen = null;   // 問題局面（指す前）
let editMoves = [];           // 一直線の手順（[0]=正解手, 以降=続き）

const editSfenEl = document.getElementById("edit-sfen");
const editSfenErrorEl = document.getElementById("edit-sfen-error");
const editCommentEl = document.getElementById("edit-comment");
const editTagsEl = document.getElementById("edit-tags");
const editMovesEl = document.getElementById("edit-moves");
const editTurnEl = document.getElementById("edit-turn");
const editSaveBtn = document.getElementById("edit-save");
const editStatusEl = document.getElementById("edit-status");

function ensureEditBoard() {
  if (editBoard) return;
  editBoard = new ShogiBoard(document.getElementById("edit-board"), {
    assetBase: "assets",
    interactive: false,
    promote: promptPromotion,
    onMove: onEditMove,
  });
}

function refreshSaveBtn() {
  editSaveBtn.disabled = !(editProblemSfen && editMoves.length >= 1);
}

function renderEditMoves() {
  if (!editMoves.length) { editMovesEl.textContent = "（まだ手がありません）"; return; }
  editMovesEl.innerHTML = editMoves.map((m, i) =>
    `<span class="mv ${i % 2 === 0 ? "self" : "opp"}">${i + 1}.${i % 2 === 0 ? "自" : "相"} ${escapeHtml(m)}</span>`
  ).join(" ");
}

function loadSfenToBoard() {
  const raw = editSfenEl.value.trim();
  editSfenErrorEl.textContent = "";
  if (!raw) { editSfenErrorEl.textContent = "SFEN を入力してください"; return; }
  ensureEditBoard();
  try {
    const sfen = ShogiBoard.looksLikeBod(raw) ? ShogiBoard.bodToSfen(raw) : raw;
    editBoard.setSFEN(sfen);
  } catch (e) {
    editSfenErrorEl.textContent = "局面を解釈できません（SFEN/BOD）: " + e.message;
    return;
  }
  editProblemSfen = editBoard.toSFEN();
  editMoves = [];
  renderEditMoves();
  editTurnEl.textContent = turnText(editProblemSfen);
  editBoard.clearArrow();
  editBoard.setInteractive(true);
  refreshSaveBtn();
}

function onEditMove(usi) {
  // 指した手を手順に追加。駒は動いたまま残し、続けて次の手を指せる。
  editMoves.push(usi);
  renderEditMoves();
  editTurnEl.textContent = turnText(editBoard.toSFEN());
  refreshSaveBtn();
}

function undoEditMove() {
  if (!editMoves.length) return;
  editMoves.pop();
  editBoard.clearArrow();
  editBoard.setSFEN(editProblemSfen);
  editMoves.forEach((m) => editBoard.applyUsi(m));
  editBoard.setInteractive(true);
  renderEditMoves();
  editTurnEl.textContent = turnText(editBoard.toSFEN());
  refreshSaveBtn();
}

function clearEdit() {
  ensureEditBoard();
  editingId = null;
  editProblemSfen = null;
  editMoves = [];
  editSfenEl.value = "";
  editCommentEl.value = "";
  editTagsEl.value = "";
  editSfenErrorEl.textContent = "";
  editStatusEl.textContent = "";
  editTurnEl.textContent = "";
  renderEditMoves();
  editBoard.setInteractive(false);
  editBoard.clearArrow();
  editBoard.setSFEN(ShogiBoard.START_SFEN);
  refreshSaveBtn();
}

function loadForEdit(id) {
  const card = deck.cards.find((c) => c.id === id);
  if (!card) return;
  switchTab("edit");
  ensureEditBoard();
  editingId = id;
  editSfenEl.value = card.sfen;
  editCommentEl.value = card.comment || "";
  editTagsEl.value = (card.tags || []).join(", ");
  editSfenErrorEl.textContent = "";
  editBoard.setSFEN(card.sfen);
  editProblemSfen = editBoard.toSFEN();
  editMoves = (card.moves && card.moves.length)
    ? card.moves.slice()
    : ((card.answers && card.answers[0]) ? [card.answers[0]] : []);
  editMoves.forEach((m) => editBoard.applyUsi(m));   // 最終局面まで再生して表示
  editBoard.setInteractive(true);                    // 続き追加・1手戻しで修正可
  renderEditMoves();
  editTurnEl.textContent = turnText(editBoard.toSFEN());
  editStatusEl.textContent = "編集中（盤に反映でやり直し / 1手戻すで修正）";
  refreshSaveBtn();
}

function saveCard() {
  if (!(editProblemSfen && editMoves.length)) return;
  const tags = editTagsEl.value.split(",").map((s) => s.trim()).filter(Boolean);
  const comment = editCommentEl.value.trim();
  const moves = editMoves.slice();
  const finalSfen = editBoard.toSFEN();
  if (editingId) {
    const card = deck.cards.find((c) => c.id === editingId);
    if (card) {
      card.sfen = editProblemSfen;
      card.moves = moves;
      card.answers = [moves[0]];
      card.answerSfen = finalSfen;
      card.comment = comment;
      card.tags = tags;
    }
  } else {
    deck.cards.push({
      id: newId(),
      sfen: editProblemSfen,
      moves,
      answers: [moves[0]],
      answerSfen: finalSfen,
      comment,
      tags,
      stats: { seen: 0, correct: 0, wrong: 0, lastResult: null },
    });
  }
  saveDeck();
  renderCount();
  editStatusEl.textContent = `保存しました（カード数 ${deck.cards.length}）`;
  clearEdit();
}

document.getElementById("edit-load-sfen").addEventListener("click", loadSfenToBoard);
document.getElementById("edit-flip").addEventListener("click", () => { ensureEditBoard(); editBoard.setFlip(!editBoard.flip); });
document.getElementById("edit-undo").addEventListener("click", undoEditMove);
document.getElementById("edit-save").addEventListener("click", saveCard);
document.getElementById("edit-clear").addEventListener("click", clearEdit);

// ============================================================ 一覧
const cardListEl = document.getElementById("card-list");
const listEmptyEl = document.getElementById("list-empty");
function renderCount() { document.getElementById("card-count").textContent = deck.cards.length; }

function renderList() {
  renderCount();
  cardListEl.innerHTML = "";
  if (deck.cards.length === 0) { listEmptyEl.style.display = "block"; return; }
  listEmptyEl.style.display = "none";
  deck.cards.forEach((card, i) => {
    const li = document.createElement("li");
    li.className = "card-item";
    const st = card.stats || { correct: 0, wrong: 0 };
    const tags = (card.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const nMoves = (card.moves && card.moves.length) || (card.answers ? card.answers.length : 0);
    const moreMoves = nMoves > 1 ? `<span class="muted">＋続き${nMoves - 1}手</span>` : "";
    li.innerHTML = `
      <div class="card-main">
        <div class="card-no">#${i + 1}</div>
        <div class="card-body">
          <div class="card-answer">正解: <code>${escapeHtml((card.answers || [])[0] || "")}</code> ${moreMoves} ${tags}</div>
          <div class="card-comment">${escapeHtml(card.comment || "（コメントなし）")}</div>
          <div class="card-sfen">${escapeHtml(card.sfen)}</div>
          <div class="card-stats muted">⭕${st.correct || 0} / ❌${st.wrong || 0}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn-ghost" data-act="edit">編集</button>
        <button class="btn-ghost danger" data-act="del">削除</button>
      </div>`;
    li.querySelector('[data-act="edit"]').addEventListener("click", () => loadForEdit(card.id));
    li.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (confirm("このカードを削除しますか？")) {
        deck.cards = deck.cards.filter((c) => c.id !== card.id);
        saveDeck(); renderList();
      }
    });
    cardListEl.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================ 入出力
document.getElementById("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(deck, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `shogi_tango_${ts}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const importInput = document.getElementById("import-input");
const importModal = document.getElementById("import-modal");
let pendingImport = null;
importInput.addEventListener("change", () => {
  const file = importInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.cards)) throw new Error("cards 配列がありません");
      pendingImport = d;
      document.getElementById("import-summary").textContent = `読み込んだカード: ${d.cards.length} 件 / 現在: ${deck.cards.length} 件`;
      importModal.style.display = "flex";
    } catch (e) {
      alert("JSON を読み込めません: " + e.message);
    }
    importInput.value = "";
  };
  reader.readAsText(file);
});
document.getElementById("import-merge").addEventListener("click", () => {
  if (pendingImport) {
    const existing = new Set(deck.cards.map((c) => c.id));
    pendingImport.cards.forEach((c) => {
      if (!c.id || existing.has(c.id)) c.id = newId();
      c.stats = c.stats || { seen: 0, correct: 0, wrong: 0, lastResult: null };
      deck.cards.push(c);
    });
    saveDeck(); finishImport();
  }
});
document.getElementById("import-replace").addEventListener("click", () => {
  if (pendingImport) {
    deck = { version: pendingImport.version || DECK_VERSION, cards: pendingImport.cards };
    deck.cards.forEach((c) => { c.stats = c.stats || { seen: 0, correct: 0, wrong: 0, lastResult: null }; });
    saveDeck(); finishImport();
  }
});
document.getElementById("import-cancel").addEventListener("click", () => { pendingImport = null; importModal.style.display = "none"; });
function finishImport() {
  pendingImport = null;
  importModal.style.display = "none";
  renderCount(); renderList();
  alert("読み込みました。");
}

// ============================================================ 起動
loadDeck();
renderCount();
ensureEditBoard();
clearEdit();
startQuiz();
// 起動時にタブを指定できる（#edit / #list）。スクショ検証やブックマーク用。
if (location.hash === "#edit") switchTab("edit");
else if (location.hash === "#list") switchTab("list");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW 登録失敗", e)));
}
