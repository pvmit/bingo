(() => {
  const COLORS = [
    "#e8c200", "#3ecf8e", "#5b8cff", "#e23d4a",
    "#c084fc", "#fb923c", "#22d3ee", "#f472b6",
  ];

  const el = {
    setup: document.getElementById("setup"),
    game: document.getElementById("game"),
    size: document.getElementById("size"),
    names: document.getElementById("names"),
    btnNew: document.getElementById("btn-new"),
    btnLeave: document.getElementById("btn-leave"),
    btnCopy: document.getElementById("btn-copy"),
    setupError: document.getElementById("setup-error"),
    roomCode: document.getElementById("room-code"),
    activeLabel: document.getElementById("active-label"),
    players: document.getElementById("players"),
    winner: document.getElementById("winner"),
    board: document.getElementById("board"),
  };

  let state = null;
  // { code, size, seed, board, players:[{id,nick,color,done:{} }], activeId, winnerId }

  function showError(msg) {
    el.setupError.hidden = !msg;
    el.setupError.textContent = msg || "";
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function randomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    for (let i = 0; i < 4; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function pickBoard(size, seedStr) {
    const pool = Array.isArray(window.GOALS) ? window.GOALS.slice() : [];
    const need = size * size;
    if (pool.length < need) {
      throw new Error(`Za mało celów w goals.js (potrzeba ${need}, jest ${pool.length}).`);
    }
    const rand = mulberry32(hashSeed(seedStr));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, need);
  }

  function countLines(done, size) {
    const at = (r, c) => !!done[r * size + c];
    let lines = 0;
    for (let r = 0; r < size; r++) {
      let ok = true;
      for (let c = 0; c < size; c++) if (!at(r, c)) { ok = false; break; }
      if (ok) lines++;
    }
    for (let c = 0; c < size; c++) {
      let ok = true;
      for (let r = 0; r < size; r++) if (!at(r, c)) { ok = false; break; }
      if (ok) lines++;
    }
    let d1 = true;
    let d2 = true;
    for (let i = 0; i < size; i++) {
      if (!at(i, i)) d1 = false;
      if (!at(i, size - 1 - i)) d2 = false;
    }
    if (d1) lines++;
    if (d2) lines++;
    return lines;
  }

  function lineCellIndexes(done, size) {
    const marked = new Set();
    const at = (r, c) => !!done[r * size + c];
    for (let r = 0; r < size; r++) {
      let ok = true;
      for (let c = 0; c < size; c++) if (!at(r, c)) { ok = false; break; }
      if (ok) for (let c = 0; c < size; c++) marked.add(r * size + c);
    }
    for (let c = 0; c < size; c++) {
      let ok = true;
      for (let r = 0; r < size; r++) if (!at(r, c)) { ok = false; break; }
      if (ok) for (let r = 0; r < size; r++) marked.add(r * size + c);
    }
    let d1 = true;
    let d2 = true;
    for (let i = 0; i < size; i++) {
      if (!at(i, i)) d1 = false;
      if (!at(i, size - 1 - i)) d2 = false;
    }
    if (d1) for (let i = 0; i < size; i++) marked.add(i * size + i);
    if (d2) for (let i = 0; i < size; i++) marked.add(i * size + (size - 1 - i));
    return marked;
  }

  function parseNames(raw) {
    return String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function persist() {
    if (!state) {
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    const payload = {
      c: state.code,
      s: state.size,
      seed: state.seed,
      a: state.activeId,
      w: state.winnerId,
      p: state.players.map((p) => ({
        id: p.id,
        n: p.nick,
        col: p.color,
        d: Object.keys(p.done).filter((k) => p.done[k]).map(Number),
      })),
    };
    const hash = "#g=" + encodeURIComponent(JSON.stringify(payload));
    history.replaceState(null, "", location.pathname + location.search + hash);
  }

  function loadFromHash() {
    const m = location.hash.match(/#g=(.+)$/);
    if (!m) return null;
    try {
      const raw = JSON.parse(decodeURIComponent(m[1]));
      const size = Number(raw.s) || 5;
      const seed = String(raw.seed || "");
      const board = pickBoard(size, seed);
      const players = (raw.p || []).map((p, i) => {
        const done = {};
        (p.d || []).forEach((idx) => { done[idx] = true; });
        return {
          id: p.id || `p${i}`,
          nick: p.n || `Gracz ${i + 1}`,
          color: p.col || COLORS[i % COLORS.length],
          done,
        };
      });
      if (!players.length) return null;
      return {
        code: raw.c || randomCode(),
        size,
        seed,
        board,
        players,
        activeId: raw.a || players[0].id,
        winnerId: raw.w || null,
      };
    } catch (_) {
      return null;
    }
  }

  function showSetup() {
    el.setup.classList.remove("hidden");
    el.game.classList.add("hidden");
  }

  function showGame() {
    el.setup.classList.add("hidden");
    el.game.classList.remove("hidden");
  }

  function activePlayer() {
    if (!state) return null;
    return state.players.find((p) => p.id === state.activeId) || state.players[0];
  }

  function render() {
    if (!state) return;
    const size = state.size;
    const me = activePlayer();
    const myDone = (me && me.done) || {};
    const winCells =
      me && countLines(myDone, size) > 0 ? lineCellIndexes(myDone, size) : new Set();
    const ended = !!state.winnerId;

    el.roomCode.textContent = state.code;
    el.activeLabel.textContent = me ? `· klika: ${me.nick}` : "";

    el.players.innerHTML = "";
    state.players.forEach((p) => {
      const lines = countLines(p.done, size);
      const li = document.createElement("li");
      if (p.id === state.activeId) li.classList.add("me");
      li.innerHTML =
        `<span class="dot" style="background:${p.color}"></span>` +
        `<span>${escapeHtml(p.nick)}</span>` +
        `<span class="lines">${lines} lin.</span>`;
      li.title = "Ustaw jako aktywnego gracza";
      li.addEventListener("click", () => {
        if (state.winnerId) return;
        state.activeId = p.id;
        persist();
        render();
      });
      el.players.appendChild(li);
    });

    if (state.winnerId) {
      const win = state.players.find((p) => p.id === state.winnerId);
      el.winner.classList.remove("hidden");
      el.winner.textContent = win ? `Bingo! Wygrywa ${win.nick}.` : "Bingo!";
    } else {
      el.winner.classList.add("hidden");
      el.winner.textContent = "";
    }

    el.board.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
    el.board.innerHTML = "";
    state.board.forEach((text, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell";
      btn.textContent = text;
      if (myDone[idx]) btn.classList.add("done");
      if (winCells.has(idx)) btn.classList.add("line-win");

      // Show small dots for other players who also have this cell
      const others = state.players.filter(
        (p) => p.id !== state.activeId && p.done[idx]
      );
      if (others.length) {
        const marks = document.createElement("span");
        marks.className = "cell-marks";
        others.forEach((p) => {
          const d = document.createElement("i");
          d.style.background = p.color;
          marks.appendChild(d);
        });
        btn.appendChild(marks);
      }

      btn.disabled = ended;
      btn.addEventListener("click", () => toggleCell(idx));
      el.board.appendChild(btn);
    });
  }

  function toggleCell(idx) {
    if (!state || state.winnerId) return;
    const me = activePlayer();
    if (!me) return;
    me.done[idx] = !me.done[idx];
    if (!me.done[idx]) delete me.done[idx];

    const lines = countLines(me.done, state.size);
    if (lines >= 1) {
      state.winnerId = me.id;
    }
    persist();
    render();
  }

  function createGame() {
    showError("");
    const size = Number(el.size.value) || 5;
    let names = parseNames(el.names.value);
    if (!names.length) names = ["Gracz 1"];
    const code = randomCode();
    const seed = `${code}-${Date.now()}`;
    let board;
    try {
      board = pickBoard(size, seed);
    } catch (err) {
      showError(err.message);
      return;
    }

    state = {
      code,
      size,
      seed,
      board,
      players: names.map((nick, i) => ({
        id: `p${i}-${code}`,
        nick,
        color: COLORS[i % COLORS.length],
        done: {},
      })),
      activeId: null,
      winnerId: null,
    };
    state.activeId = state.players[0].id;
    persist();
    showGame();
    render();
  }

  function leaveGame() {
    state = null;
    persist();
    showSetup();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      el.btnCopy.textContent = "Skopiowano";
      setTimeout(() => { el.btnCopy.textContent = "Kopiuj link"; }, 1200);
    } catch (_) {
      prompt("Skopiuj link:", location.href);
    }
  }

  el.btnNew.addEventListener("click", createGame);
  el.btnLeave.addEventListener("click", leaveGame);
  el.btnCopy.addEventListener("click", copyLink);

  const restored = loadFromHash();
  if (restored) {
    state = restored;
    showGame();
    render();
  }
})();
