(function () {
  "use strict";

  const COLORS = [
    "#e8c200",
    "#3ecf8e",
    "#5b8cff",
    "#ff7a59",
    "#c77dff",
    "#2dd4bf",
    "#f472b6",
    "#94a3b8",
  ];

  const els = {
    lobby: document.getElementById("lobby"),
    game: document.getElementById("game"),
    nick: document.getElementById("nick"),
    code: document.getElementById("code"),
    size: document.getElementById("size"),
    btnJoin: document.getElementById("btn-join"),
    btnNew: document.getElementById("btn-new"),
    btnLeave: document.getElementById("btn-leave"),
    lobbyMsg: document.getElementById("lobby-msg"),
    board: document.getElementById("board"),
    playerList: document.getElementById("player-list"),
    gameCode: document.getElementById("game-code"),
    gameNick: document.getElementById("game-nick"),
    winnerBanner: document.getElementById("winner-banner"),
  };

  const state = {
    db: null,
    gameRef: null,
    unsub: null,
    playerId: localStorage.getItem("bingoPlayerId") || makeId(),
    nick: localStorage.getItem("bingoNick") || "",
    game: null,
  };

  localStorage.setItem("bingoPlayerId", state.playerId);
  if (state.nick) els.nick.value = state.nick;

  function makeId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function roomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 4; i++) {
      out += alphabet[(Math.random() * alphabet.length) | 0];
    }
    return out;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
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

  function pickBoard(size, seedStr) {
    const pool = Array.isArray(window.GOALS) ? window.GOALS.slice() : [];
    const need = size * size;
    if (pool.length < need) {
      throw new Error(
        "Za mało celów w goals.js (potrzeba " + need + ", jest " + pool.length + ")."
      );
    }
    const rnd = mulberry32(hashSeed(seedStr));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, need);
  }

  function countLines(doneMap, size) {
    let lines = 0;
    const done = (i) => !!doneMap[i];

    for (let r = 0; r < size; r++) {
      let ok = true;
      for (let c = 0; c < size; c++) {
        if (!done(r * size + c)) {
          ok = false;
          break;
        }
      }
      if (ok) lines++;
    }

    for (let c = 0; c < size; c++) {
      let ok = true;
      for (let r = 0; r < size; r++) {
        if (!done(r * size + c)) {
          ok = false;
          break;
        }
      }
      if (ok) lines++;
    }

    let diag1 = true;
    let diag2 = true;
    for (let i = 0; i < size; i++) {
      if (!done(i * size + i)) diag1 = false;
      if (!done(i * size + (size - 1 - i))) diag2 = false;
    }
    if (diag1) lines++;
    if (diag2) lines++;

    return lines;
  }

  function winningCells(doneMap, size) {
    const marked = new Set();
    const done = (i) => !!doneMap[i];

    function markLine(indices) {
      if (indices.every(done)) indices.forEach((i) => marked.add(i));
    }

    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) row.push(r * size + c);
      markLine(row);
    }
    for (let c = 0; c < size; c++) {
      const col = [];
      for (let r = 0; r < size; r++) col.push(r * size + c);
      markLine(col);
    }
    const d1 = [];
    const d2 = [];
    for (let i = 0; i < size; i++) {
      d1.push(i * size + i);
      d2.push(i * size + (size - 1 - i));
    }
    markLine(d1);
    markLine(d2);
    return marked;
  }

  function showLobbyMsg(text, isError) {
    els.lobbyMsg.textContent = text;
    els.lobbyMsg.classList.toggle("hidden", !text);
    els.lobbyMsg.classList.toggle("error", !!isError);
  }

  function initFirebase() {
    if (!window.FIREBASE_READY) {
      showLobbyMsg(
        "Uzupełnij firebase-config.js (projekt Firebase + Realtime Database). Szczegóły w README.",
        true
      );
      els.btnJoin.disabled = true;
      els.btnNew.disabled = true;
      return false;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      state.db = firebase.database();
      return true;
    } catch (err) {
      showLobbyMsg("Firebase: " + (err && err.message ? err.message : err), true);
      els.btnJoin.disabled = true;
      els.btnNew.disabled = true;
      return false;
    }
  }

  function stopListen() {
    if (state.unsub) {
      state.unsub();
      state.unsub = null;
    }
    state.gameRef = null;
    state.game = null;
  }

  function showLobby() {
    stopListen();
    els.game.classList.add("hidden");
    els.lobby.classList.remove("hidden");
  }

  function showGame() {
    els.lobby.classList.add("hidden");
    els.game.classList.remove("hidden");
  }

  function readNick() {
    const nick = (els.nick.value || "").trim().slice(0, 24);
    if (!nick) {
      showLobbyMsg("Podaj nick.", true);
      return null;
    }
    state.nick = nick;
    localStorage.setItem("bingoNick", nick);
    return nick;
  }

  async function createGame() {
    if (!state.db && !initFirebase()) return;
    const nick = readNick();
    if (!nick) return;

    const size = Math.max(3, Math.min(6, parseInt(els.size.value, 10) || 5));
    const code = roomCode();
    const seed = code + "-" + Date.now().toString(36);
    let board;
    try {
      board = pickBoard(size, seed);
    } catch (err) {
      showLobbyMsg(err.message, true);
      return;
    }

    const player = {
      id: state.playerId,
      nick,
      color: COLORS[0],
      done: {},
      lines: 0,
      joinedAt: Date.now(),
    };

    const payload = {
      code,
      seed,
      size,
      board,
      createdAt: Date.now(),
      winnerId: null,
      winnerNick: null,
      players: {
        [state.playerId]: player,
      },
    };

    try {
      await state.db.ref("game").set(payload);
      els.code.value = code;
      showLobbyMsg("");
      listenGame();
    } catch (err) {
      showLobbyMsg("Nie udało się utworzyć gry: " + err.message, true);
    }
  }

  async function joinGame() {
    if (!state.db && !initFirebase()) return;
    const nick = readNick();
    if (!nick) return;

    const code = (els.code.value || "").trim().toUpperCase();
    if (!code) {
      showLobbyMsg("Podaj kod pokoju.", true);
      return;
    }

    try {
      const snap = await state.db.ref("game").once("value");
      const game = snap.val();
      if (!game || !game.code) {
        showLobbyMsg("Brak aktywnej gry. Utwórz nową.", true);
        return;
      }
      if (String(game.code).toUpperCase() !== code) {
        showLobbyMsg("Zły kod — aktywna jest gra " + game.code + ".", true);
        return;
      }

      const players = game.players || {};
      const existing = players[state.playerId];
      const colorIndex = Object.keys(players).length % COLORS.length;
      const player = {
        id: state.playerId,
        nick,
        color: (existing && existing.color) || COLORS[colorIndex],
        done: (existing && existing.done) || {},
        lines: (existing && existing.lines) || 0,
        joinedAt: (existing && existing.joinedAt) || Date.now(),
      };

      await state.db.ref("game/players/" + state.playerId).set(player);
      showLobbyMsg("");
      listenGame();
    } catch (err) {
      showLobbyMsg("Dołączanie nieudane: " + err.message, true);
    }
  }

  function listenGame() {
    stopListen();
    state.gameRef = state.db.ref("game");
    const handler = state.gameRef.on("value", (snap) => {
      const game = snap.val();
      if (!game || !game.board) {
        showLobby();
        showLobbyMsg("Gra zakończona lub usunięta.", false);
        return;
      }
      state.game = game;
      renderGame(game);
    });
    state.unsub = function () {
      state.gameRef.off("value", handler);
    };
  }

  async function toggleCell(index) {
    const game = state.game;
    if (!game || game.winnerId) return;
    const me = game.players && game.players[state.playerId];
    if (!me) return;

    const done = Object.assign({}, me.done || {});
    if (done[index]) delete done[index];
    else done[index] = true;

    const lines = countLines(done, game.size);
    const updates = {
      ["players/" + state.playerId + "/done"]: done,
      ["players/" + state.playerId + "/lines"]: lines,
      ["players/" + state.playerId + "/nick"]: state.nick,
    };

    if (lines >= 1 && !game.winnerId) {
      updates.winnerId = state.playerId;
      updates.winnerNick = state.nick;
    }

    try {
      await state.db.ref("game").update(updates);
    } catch (err) {
      console.error(err);
    }
  }

  function renderGame(game) {
    showGame();
    els.gameCode.textContent = game.code || "----";
    els.gameNick.textContent = state.nick || "—";

    const players = Object.values(game.players || {}).sort(
      (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)
    );

    els.playerList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      if (p.id === state.playerId) li.classList.add("you");
      if (game.winnerId && p.id === game.winnerId) li.classList.add("winner");
      li.innerHTML =
        '<span class="swatch" style="background:' +
        (p.color || "#888") +
        '"></span>' +
        '<span class="player-name"></span>' +
        '<span class="player-lines"></span>';
      li.querySelector(".player-name").textContent =
        p.nick + (p.id === state.playerId ? " (ty)" : "");
      li.querySelector(".player-lines").textContent = (p.lines || 0) + " lin.";
      els.playerList.appendChild(li);
    });

    if (game.winnerId) {
      els.winnerBanner.classList.remove("hidden");
      const name =
        game.winnerNick ||
        (game.players[game.winnerId] && game.players[game.winnerId].nick) ||
        "Gracz";
      els.winnerBanner.textContent = "Bingo! Wygrywa: " + name;
    } else {
      els.winnerBanner.classList.add("hidden");
    }

    const me = game.players && game.players[state.playerId];
    const myDone = (me && me.done) || {};
    const myColor = (me && me.color) || COLORS[0];
    const winSet =
      game.winnerId === state.playerId
        ? winningCells(myDone, game.size)
        : new Set();

    els.board.style.gridTemplateColumns = "repeat(" + game.size + ", 1fr)";
    els.board.style.setProperty("--player-color", myColor);
    els.board.innerHTML = "";

    (game.board || []).forEach((text, index) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      cell.textContent = text;
      if (myDone[index]) cell.classList.add("mine");
      if (winSet.has(index)) cell.classList.add("won-line");

      const dots = document.createElement("div");
      dots.className = "dots";
      players.forEach((p) => {
        if (p.done && p.done[index] && p.id !== state.playerId) {
          const d = document.createElement("span");
          d.style.background = p.color || "#888";
          d.title = p.nick;
          dots.appendChild(d);
        }
      });
      if (dots.childNodes.length) cell.appendChild(dots);

      cell.disabled = !!game.winnerId;
      cell.addEventListener("click", function () {
        toggleCell(index);
      });
      els.board.appendChild(cell);
    });
  }

  els.btnNew.addEventListener("click", createGame);
  els.btnJoin.addEventListener("click", joinGame);
  els.btnLeave.addEventListener("click", function () {
    showLobby();
  });

  els.code.addEventListener("keydown", function (e) {
    if (e.key === "Enter") joinGame();
  });
  els.nick.addEventListener("keydown", function (e) {
    if (e.key === "Enter") joinGame();
  });

  initFirebase();
})();
