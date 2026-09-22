(() => {
  const COLORS = [
    "#e8c200", "#3ecf8e", "#5b8cff", "#e23d4a",
    "#c084fc", "#fb923c", "#22d3ee", "#f472b6",
  ];

  const el = {
    setup: document.getElementById("setup"),
    game: document.getElementById("game"),
    nick: document.getElementById("nick"),
    size: document.getElementById("size"),
    code: document.getElementById("code"),
    btnNew: document.getElementById("btn-new"),
    btnJoin: document.getElementById("btn-join"),
    btnLeave: document.getElementById("btn-leave"),
    setupError: document.getElementById("setup-error"),
    firebaseWarn: document.getElementById("firebase-warn"),
    roomCode: document.getElementById("room-code"),
    youLabel: document.getElementById("you-label"),
    players: document.getElementById("players"),
    winner: document.getElementById("winner"),
    board: document.getElementById("board"),
  };

  let db = null;
  let gameRef = null;
  let unsub = null;
  let playerId = localStorage.getItem("bingoPlayerId");
  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem("bingoPlayerId", playerId);
  }

  let state = {
    nick: localStorage.getItem("bingoNick") || "",
    code: "",
    game: null,
  };

  el.nick.value = state.nick;

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
    const markRow = (r) => {
      for (let c = 0; c < size; c++) marked.add(r * size + c);
    };
    const markCol = (c) => {
      for (let r = 0; r < size; r++) marked.add(r * size + c);
    };
    for (let r = 0; r < size; r++) {
      let ok = true;
      for (let c = 0; c < size; c++) if (!at(r, c)) { ok = false; break; }
      if (ok) markRow(r);
    }
    for (let c = 0; c < size; c++) {
      let ok = true;
      for (let r = 0; r < size; r++) if (!at(r, c)) { ok = false; break; }
      if (ok) markCol(c);
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

  function ensureFirebase() {
    if (!window.FIREBASE_READY) {
      el.firebaseWarn.classList.remove("hidden");
      return false;
    }
    el.firebaseWarn.classList.add("hidden");
    if (!db) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      db = firebase.database();
    }
    return true;
  }

  function detach() {
    if (typeof unsub === "function") {
      unsub();
      unsub = null;
    }
    gameRef = null;
  }

  function showSetup() {
    el.setup.classList.remove("hidden");
    el.game.classList.add("hidden");
  }

  function showGame() {
    el.setup.classList.add("hidden");
    el.game.classList.remove("hidden");
  }

  function doneMap(player) {
    const raw = (player && player.done) || {};
    const map = {};
    Object.keys(raw).forEach((k) => {
      if (raw[k]) map[Number(k)] = true;
    });
    return map;
  }

  function render() {
    const g = state.game;
    if (!g || !g.board) return;

    const size = Number(g.size) || 5;
    const board = g.board;
    const players = g.players || {};
    const me = players[playerId];
    const myDone = doneMap(me);
    const winCells = me && countLines(myDone, size) > 0
      ? lineCellIndexes(myDone, size)
      : new Set();
    const ended = !!g.winnerId;

    el.roomCode.textContent = g.code || state.code;
    el.youLabel.textContent = me ? `· Ty: ${me.nick}` : "";

    el.players.innerHTML = "";
    Object.entries(players)
      .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
      .forEach(([id, p]) => {
        const done = doneMap(p);
        const lines = countLines(done, size);
        const li = document.createElement("li");
        if (id === playerId) li.classList.add("me");
        li.innerHTML =
          `<span class="dot" style="background:${p.color || "#888"}"></span>` +
          `<span>${escapeHtml(p.nick || "?")}</span>` +
          `<span class="lines">${lines} lin.</span>`;
        el.players.appendChild(li);
      });

    if (g.winnerId && players[g.winnerId]) {
      el.winner.classList.remove("hidden");
      const name = players[g.winnerId].nick || "Gracz";
      el.winner.textContent =
        g.winnerId === playerId
          ? `Bingo! Wygrywasz, ${name}.`
          : `Bingo! Wygrywa ${name}.`;
    } else {
      el.winner.classList.add("hidden");
      el.winner.textContent = "";
    }

    el.board.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
    el.board.innerHTML = "";
    board.forEach((text, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell";
      btn.textContent = text;
      if (myDone[idx]) btn.classList.add("done");
      if (winCells.has(idx)) btn.classList.add("line-win");
      btn.disabled = ended;
      btn.addEventListener("click", () => toggleCell(idx));
      el.board.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function toggleCell(idx) {
    const g = state.game;
    if (!g || g.winnerId || !gameRef) return;
    const meRef = gameRef.child(`players/${playerId}`);
    const snap = await meRef.child(`done/${idx}`).get();
    const next = !snap.val();
    await meRef.child(`done/${idx}`).set(next || null);

    const playerSnap = await meRef.get();
    const player = playerSnap.val() || {};
    const done = doneMap(player);
    if (next) done[idx] = true;
    else delete done[idx];
    const size = Number(g.size) || 5;
    const lines = countLines(done, size);
    await meRef.child("lines").set(lines);

    if (lines >= 1) {
      await gameRef.transaction((cur) => {
        if (!cur) return cur;
        if (cur.winnerId) return;
        cur.winnerId = playerId;
        cur.winnerAt = Date.now();
        return cur;
      });
    }
  }

  function colorForPlayer(existingPlayers) {
    const used = new Set(
      Object.values(existingPlayers || {}).map((p) => p.color)
    );
    const free = COLORS.find((c) => !used.has(c));
    return free || COLORS[Object.keys(existingPlayers || {}).length % COLORS.length];
  }

  async function joinGame(code, asHostPayload) {
    if (!ensureFirebase()) {
      showError("Skonfiguruj Firebase (firebase-config.js).");
      return;
    }
    const nick = el.nick.value.trim();
    if (!nick) {
      showError("Podaj nick.");
      return;
    }
    state.nick = nick;
    localStorage.setItem("bingoNick", nick);
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(normalized)) {
      showError("Kod pokoju musi mieć 4 znaki.");
      return;
    }

    detach();
    gameRef = db.ref("game");

    if (asHostPayload) {
      await gameRef.set(asHostPayload);
    }

    const snap = await gameRef.get();
    const data = snap.val();
    if (!data || data.code !== normalized) {
      showError("Nie ma aktywnej gry z tym kodem. Utwórz nową lub sprawdź kod.");
      detach();
      return;
    }

    const players = data.players || {};
    if (!players[playerId]) {
      const color = colorForPlayer(players);
      await gameRef.child(`players/${playerId}`).set({
        nick,
        color,
        joinedAt: Date.now(),
        lines: 0,
        done: {},
      });
    } else {
      await gameRef.child(`players/${playerId}/nick`).set(nick);
    }

    state.code = normalized;
    showError("");
    showGame();

    const handler = (s) => {
      state.game = s.val();
      if (!state.game || state.game.code !== normalized) {
        alert("Gra została zresetowana lub kod się zmienił.");
        leaveGame();
        return;
      }
      render();
    };
    gameRef.on("value", handler);
    unsub = () => gameRef.off("value", handler);
  }

  async function createGame() {
    showError("");
    if (!ensureFirebase()) {
      showError("Skonfiguruj Firebase (firebase-config.js).");
      return;
    }
    const nick = el.nick.value.trim();
    if (!nick) {
      showError("Podaj nick.");
      return;
    }
    const size = Number(el.size.value) || 5;
    const code = randomCode();
    const seed = `${code}-${Date.now()}`;
    let board;
    try {
      board = pickBoard(size, seed);
    } catch (err) {
      showError(err.message);
      return;
    }

    const payload = {
      code,
      size,
      seed,
      board,
      createdAt: Date.now(),
      winnerId: null,
      players: {},
    };

    el.btnNew.disabled = true;
    try {
      await joinGame(code, payload);
      el.code.value = code;
    } finally {
      el.btnNew.disabled = false;
    }
  }

  function leaveGame() {
    detach();
    state.game = null;
    state.code = "";
    showSetup();
  }

  el.btnNew.addEventListener("click", () => {
    createGame().catch((e) => showError(e.message || String(e)));
  });
  el.btnJoin.addEventListener("click", () => {
    joinGame(el.code.value).catch((e) => showError(e.message || String(e)));
  });
  el.btnLeave.addEventListener("click", leaveGame);
  el.code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.btnJoin.click();
  });

  ensureFirebase();
})();
