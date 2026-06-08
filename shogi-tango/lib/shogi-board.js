/* 将棋単語帳 — ShogiBoard
 *
 * 「天下一将棋会の盤駒」の ShogiBoard を単語帳用に拡張したもの。
 * 元の sandbox 移動に加えて、
 *   - opts.onMove(usi)         指した手を USI 文字列で通知（"7g7f" / "7g7f+" / "P*5e"）
 *   - opts.promote(info)       成り可能時に呼ぶ async 判定（true で成る）
 * を持つ。合法手判定はせず「指した手 = 正解か」を USI 比較する用途に特化。
 *
 * Asset-driven renderer. 駒は assets/pieces/{sente,gote}/<usiKey>.png、
 * 盤は assets/board/board_full.png。純フロントエンド、バックエンド不要。
 *
 * 座標モデル: cellIndex 0..80（row-major, rank a=上, file 9=左, flip=false 時）。
 */
(function (global) {
  "use strict";

  const FILES = 9, RANKS = 9;
  const START_SFEN =
    "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

  // 駒台の並び順（強い→弱い）
  const HAND_ORDER = ["r", "b", "g", "s", "n", "l", "p"];

  // 盤画像の内側 9x9 グリッドの幾何（make_board.py 由来）
  const INSET = 4.698, GRID = 90.604, CELL = GRID / 9;

  function parseSFEN(sfen) {
    const parts = sfen.trim().split(/\s+/);
    const boardStr = parts[0];
    const turn = parts[1] || "b";
    const handStr = parts[2] || "-";

    const board = new Array(81).fill(null); // {key, owner} owner: 'b'|'w'
    const rows = boardStr.split("/");
    if (rows.length !== 9) throw new Error("SFEN は 9 段必要です: " + sfen);
    for (let r = 0; r < 9; r++) {
      let c = 0, promoted = false;
      for (const ch of rows[r]) {
        if (ch === "+") { promoted = true; continue; }
        if (/\d/.test(ch)) { c += parseInt(ch, 10); continue; }
        const owner = ch === ch.toUpperCase() ? "b" : "w";
        const key = (promoted ? "+" : "") + ch.toLowerCase();
        if (c > 8) throw new Error("SFEN の段が長すぎます: " + sfen);
        board[r * 9 + c] = { key, owner };
        promoted = false;
        c++;
      }
      if (c !== 9) throw new Error("SFEN の段の長さが不正です: " + sfen);
    }
    const hands = { b: {}, w: {} };
    if (handStr !== "-") {
      let i = 0;
      while (i < handStr.length) {
        let num = "";
        while (i < handStr.length && /\d/.test(handStr[i])) num += handStr[i++];
        const ch = handStr[i++];
        const owner = ch === ch.toUpperCase() ? "b" : "w";
        const k = ch.toLowerCase();
        hands[owner][k] = (hands[owner][k] || 0) + (num ? parseInt(num, 10) : 1);
      }
    }
    return { board, hands, turn };
  }

  function buildSFEN(state) {
    const { board, hands, turn } = state;
    const rows = [];
    for (let r = 0; r < 9; r++) {
      let row = "", empty = 0;
      for (let c = 0; c < 9; c++) {
        const p = board[r * 9 + c];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        let s = p.key.replace("+", "");
        s = p.owner === "b" ? s.toUpperCase() : s.toLowerCase();
        if (p.key[0] === "+") s = "+" + s;
        row += s;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let hand = "";
    for (const owner of ["b", "w"]) {
      for (const k of HAND_ORDER) {
        const n = hands[owner][k] || 0;
        if (!n) continue;
        const ch = owner === "b" ? k.toUpperCase() : k.toLowerCase();
        hand += (n > 1 ? n : "") + ch;
      }
    }
    return `${rows.join("/")} ${turn} ${hand || "-"} 1`;
  }

  // cellIndex(0..80) -> USI 升("7g" 等)
  function idxToUsi(idx) {
    const file = 9 - (idx % 9);
    const rank = String.fromCharCode(97 + Math.floor(idx / 9));
    return "" + file + rank;
  }
  // USI 升("7g") -> cellIndex
  function usiToIdx(sq) {
    const file = parseInt(sq[0], 10);
    const rank = sq.charCodeAt(1) - 97;
    return rank * 9 + (9 - file);
  }

  class ShogiBoard {
    constructor(rootEl, opts = {}) {
      this.root = rootEl;
      this.assetBase = (opts.assetBase || "assets").replace(/\/$/, "");
      this._bust = opts.cacheBust ? "?v=" + Date.now() : "";
      this.flip = !!opts.flip;
      this.interactive = opts.interactive !== false;
      this.onChange = opts.onChange || null;
      this.onMove = opts.onMove || null;       // (usi) => void
      this.promote = opts.promote || null;      // async (info) => bool
      this.showHands = opts.showHands !== false;

      this.state = parseSFEN(opts.sfen || START_SFEN);
      this.selected = null;
      this.lastMove = null;
      this._busy = false;

      this._build();
      this.render();
    }

    _pieceURL(key, owner) {
      const dir = owner === "b" ? "sente" : "gote";
      return `${this.assetBase}/pieces/${dir}/${key}.png${this._bust}`;
    }

    _build() {
      this.root.classList.add("sb-root");
      this.root.innerHTML = "";

      this.boardEl = document.createElement("div");
      this.boardEl.className = "sb-board";
      this.boardEl.style.backgroundImage =
        `url(${this.assetBase}/board/board_full.png${this._bust})`;

      this.gridEl = document.createElement("div");
      this.gridEl.className = "sb-grid";
      this.cells = [];
      for (let i = 0; i < 81; i++) {
        const cell = document.createElement("div");
        cell.className = "sb-cell";
        cell.dataset.idx = i;
        // リスナーは常に付け、有効/無効は this.interactive でハンドラ内判定
        cell.addEventListener("click", () => this._clickCell(i));
        this.gridEl.appendChild(cell);
        this.cells.push(cell);
      }
      this.boardEl.appendChild(this.gridEl);

      // 矢印オーバーレイ（正解表示用）
      this.arrowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.arrowSvg.setAttribute("class", "sb-arrow");
      this.arrowSvg.setAttribute("viewBox", "0 0 100 100");
      this.arrowSvg.setAttribute("preserveAspectRatio", "none");
      this.boardEl.appendChild(this.arrowSvg);

      this.handTop = document.createElement("div");
      this.handTop.className = "sb-hand";
      this.handBottom = document.createElement("div");
      this.handBottom.className = "sb-hand";

      const wrap = document.createElement("div");
      wrap.className = "sb-hands";
      if (this.showHands) wrap.appendChild(this.handTop);
      wrap.appendChild(this.boardEl);
      if (this.showHands) wrap.appendChild(this.handBottom);
      this.root.appendChild(wrap);
    }

    _disp(idx) { return this.flip ? 80 - idx : idx; }

    render() {
      const { board } = this.state;
      for (let i = 0; i < 81; i++) {
        const cell = this.cells[this._disp(i)];
        cell.className = "sb-cell";
        cell.innerHTML = "";
        const p = board[i];
        if (p) {
          const el = document.createElement("div");
          el.className = "sb-piece";
          const upright = (p.owner === "b") !== this.flip;
          const imgOwner = upright ? "b" : "w";
          el.style.backgroundImage = `url(${this._pieceURL(p.key, imgOwner)})`;
          cell.appendChild(el);
        }
      }
      if (this.selected && this.selected.type === "board") {
        this.cells[this._disp(this.selected.idx)].classList.add("sb-selected");
      }
      if (this.lastMove) {
        this.cells[this._disp(this.lastMove[1])].classList.add("sb-lastmove");
      }
      if (this.showHands) this._renderHands();
    }

    _renderHands() {
      const farOwner = this.flip ? "b" : "w";
      const nearOwner = this.flip ? "w" : "b";
      this._fillHand(this.handTop, farOwner);
      this._fillHand(this.handBottom, nearOwner);
    }

    _fillHand(el, owner) {
      el.innerHTML = "";
      const label = document.createElement("span");
      label.className = "sb-hand-label";
      label.textContent = owner === "b" ? "☗先手" : "☖後手";
      el.appendChild(label);
      const hands = this.state.hands[owner];
      for (const k of HAND_ORDER) {
        const n = hands[k] || 0;
        if (!n) continue;
        const hp = document.createElement("div");
        hp.className = "sb-hand-piece";
        const upright = (owner === "b") !== this.flip;
        hp.style.backgroundImage = `url(${this._pieceURL(k, upright ? "b" : "w")})`;
        if (this.selected && this.selected.type === "hand" &&
            this.selected.owner === owner && this.selected.key === k) {
          hp.classList.add("sb-selected");
        }
        if (n > 1) {
          const c = document.createElement("span");
          c.className = "sb-hand-count";
          c.textContent = n;
          hp.appendChild(c);
        }
        hp.addEventListener("click", () => this._clickHand(owner, k));
        el.appendChild(hp);
      }
    }

    // ---- interaction（合法手判定なし。指した手を USI で通知） ----
    async _clickCell(dispIdx) {
      if (!this.interactive || this._busy) return;
      const idx = this.flip ? 80 - dispIdx : dispIdx;
      const board = this.state.board;
      const sel = this.selected;

      if (sel && sel.type === "hand") {
        if (!board[idx]) {
          this.selected = null;
          await this._drop(sel.owner, sel.key, idx);
        } else {
          this.selected = null; this.render();
        }
        return;
      }
      if (sel && sel.type === "board") {
        if (sel.idx === idx) { this.selected = null; this.render(); return; }
        this.selected = null;
        await this._move(sel.idx, idx);
        return;
      }
      if (board[idx]) { this.selected = { type: "board", idx }; this.render(); }
    }

    _clickHand(owner, key) {
      if (!this.interactive || this._busy) return;
      const sel = this.selected;
      if (sel && sel.type === "hand" && sel.owner === owner && sel.key === key) {
        this.selected = null;
      } else {
        this.selected = { type: "hand", owner, key };
      }
      this.render();
    }

    _canPromote(piece, from, to) {
      if (piece.key[0] === "+") return false;
      const base = piece.key;
      if (base === "g" || base === "k") return false;
      const fromR = Math.floor(from / 9), toR = Math.floor(to / 9);
      const zone = piece.owner === "b" ? [0, 1, 2] : [6, 7, 8];
      return zone.includes(fromR) || zone.includes(toR);
    }

    async _move(from, to) {
      const board = this.state.board;
      const moving = board[from];
      if (!moving) { this.render(); return; }

      let promo = false;
      if (this._canPromote(moving, from, to) && this.promote) {
        this._busy = true;
        try {
          promo = await this.promote({ key: moving.key, owner: moving.owner, from, to });
        } finally { this._busy = false; }
      }

      const captured = board[to];
      if (captured && captured.owner !== moving.owner) {
        const base = captured.key.replace("+", "");
        this.state.hands[moving.owner][base] =
          (this.state.hands[moving.owner][base] || 0) + 1;
      }
      board[to] = promo ? { key: "+" + moving.key, owner: moving.owner } : moving;
      board[from] = null;
      this.lastMove = [from, to];
      this.state.turn = this.state.turn === "b" ? "w" : "b";
      this.render();
      const usi = idxToUsi(from) + idxToUsi(to) + (promo ? "+" : "");
      this._changed(usi);
    }

    async _drop(owner, key, idx) {
      this.state.board[idx] = { key, owner };
      const h = this.state.hands[owner];
      h[key]--; if (h[key] <= 0) delete h[key];
      this.lastMove = [idx, idx];
      this.state.turn = this.state.turn === "b" ? "w" : "b";
      this.render();
      const usi = key.toUpperCase() + "*" + idxToUsi(idx);
      this._changed(usi);
    }

    /** USI 手をプログラムから適用（onMove は発火しない）。手順の再生・巻き戻し用。 */
    applyUsi(usi) {
      const board = this.state.board;
      if (usi[1] === "*") {
        const key = usi[0].toLowerCase();
        const idx = usiToIdx(usi.slice(2, 4));
        const owner = this.state.turn;
        board[idx] = { key, owner };
        const h = this.state.hands[owner];
        if (h[key]) { h[key]--; if (h[key] <= 0) delete h[key]; }
        this.lastMove = [idx, idx];
      } else {
        const from = usiToIdx(usi.slice(0, 2));
        const to = usiToIdx(usi.slice(2, 4));
        const promo = usi.endsWith("+");
        const moving = board[from];
        if (!moving) { this.render(); return; }
        const captured = board[to];
        if (captured && captured.owner !== moving.owner) {
          const base = captured.key.replace("+", "");
          this.state.hands[moving.owner][base] = (this.state.hands[moving.owner][base] || 0) + 1;
        }
        board[to] = promo ? { key: "+" + moving.key.replace("+", ""), owner: moving.owner } : moving;
        board[from] = null;
        this.lastMove = [from, to];
      }
      this.state.turn = this.state.turn === "b" ? "w" : "b";
      this.render();
    }

    _changed(usi) {
      if (this.onChange) this.onChange(this.toSFEN());
      if (usi && this.onMove) this.onMove(usi);
    }

    // ---- 正解手の矢印表示 ----
    _centerPct(dispIdx) {
      const c = dispIdx % 9, r = Math.floor(dispIdx / 9);
      return [INSET + (c + 0.5) * CELL, INSET + (r + 0.5) * CELL];
    }

    showArrow(usi, color) {
      this.clearArrow();
      if (!usi) return;
      color = color || "#fc7494";
      const isDrop = usi[1] === "*";
      const toSq = isDrop ? usi.slice(2, 4) : usi.slice(2, 4);
      const toDisp = this._disp(usiToIdx(toSq));
      const [tx, ty] = this._centerPct(toDisp);
      const ns = "http://www.w3.org/2000/svg";

      if (isDrop) {
        const circ = document.createElementNS(ns, "circle");
        circ.setAttribute("cx", tx); circ.setAttribute("cy", ty);
        circ.setAttribute("r", 5.5);
        circ.setAttribute("fill", "none");
        circ.setAttribute("stroke", color);
        circ.setAttribute("stroke-width", 1.6);
        this.arrowSvg.appendChild(circ);
        return;
      }
      const fromSq = usi.slice(0, 2);
      const fromDisp = this._disp(usiToIdx(fromSq));
      const [fx, fy] = this._centerPct(fromDisp);

      const defs = document.createElementNS(ns, "defs");
      const marker = document.createElementNS(ns, "marker");
      marker.setAttribute("id", "sb-arrowhead");
      marker.setAttribute("markerWidth", "5"); marker.setAttribute("markerHeight", "5");
      marker.setAttribute("refX", "3"); marker.setAttribute("refY", "2.5");
      marker.setAttribute("orient", "auto");
      const poly = document.createElementNS(ns, "polygon");
      poly.setAttribute("points", "0 0, 5 2.5, 0 5");
      poly.setAttribute("fill", color);
      marker.appendChild(poly); defs.appendChild(marker);
      this.arrowSvg.appendChild(defs);

      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", fx); line.setAttribute("y1", fy);
      line.setAttribute("x2", tx); line.setAttribute("y2", ty);
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2");
      line.setAttribute("marker-end", "url(#sb-arrowhead)");
      this.arrowSvg.appendChild(line);
    }

    clearArrow() { if (this.arrowSvg) this.arrowSvg.innerHTML = ""; }

    // ---- public API ----
    setSFEN(sfen) {
      this.state = parseSFEN(sfen);
      this.selected = null;
      this.lastMove = null;
      this.clearArrow();
      this.render();
    }
    toSFEN() { return buildSFEN(this.state); }
    setFlip(v) { this.flip = !!v; this.selected = null; this.clearArrow(); this.render(); }
    setInteractive(v) { this.interactive = !!v; }
    reset() { this.setSFEN(START_SFEN); }
  }

  ShogiBoard.START_SFEN = START_SFEN;
  ShogiBoard.parseSFEN = parseSFEN;
  ShogiBoard.buildSFEN = buildSFEN;
  ShogiBoard.idxToUsi = idxToUsi;
  ShogiBoard.usiToIdx = usiToIdx;
  global.ShogiBoard = ShogiBoard;
})(window);
