(() => {
  const SIZE = 5;
  const CELL_COUNT = SIZE * SIZE;
  const COLORS = { 1: "#e23d4a", 2: "#5b8cff" };
  const LABELS = { 1: "Gracz 1", 2: "Gracz 2" };
  const ROOM_KEY = "bingo.room";
  const ROLE_KEY = "bingo.role";
  const GAME_KEY = "bingo.game";
  const GOALS_KEY = "bingo.goals";
  const GOALS_VER_KEY = "bingo.goalsVer";
  const GOALS_VER = "katowice-1";
  const KIND = "duo";
  const LIVE = "LIVE";

  const app = document.getElementById("app");
  let game = null;
  let roomCode = LIVE;
  let playerRole = (function () {
    const raw = localStorage.getItem(ROLE_KEY);
    if (raw === "admin") return 9;
    return Number(raw) || 0;
  })();
  let customGoals = null;
  let watchStop = null;
  let watchingCode = "";
  let emptyPublish = false;
  let repaint = null;
  let syncStatus = "offline";
  let syncError = "";
  let reconnectTimer = null;
  let joining = false;
  let lastResetAt = Number(localStorage.getItem("bingo.resetAt") || "0") || 0;

  try {
    const cached = localStorage.getItem(GAME_KEY);
    if (cached) game = JSON.parse(cached);
  } catch (e) {
    game = null;
  }
  try {
    if (localStorage.getItem(GOALS_VER_KEY) !== GOALS_VER) {
      localStorage.removeItem(GOALS_KEY);
      localStorage.setItem(GOALS_VER_KEY, GOALS_VER);
    }
    const rawGoals = localStorage.getItem(GOALS_KEY);
    if (rawGoals) {
      const parsed = JSON.parse(rawGoals);
      if (Array.isArray(parsed) && parsed.length) customGoals = parsed;
    }
  } catch (e) {
    customGoals = null;
  }

  function defaultGoals() {
    return Array.isArray(window.GOALS) ? window.GOALS.slice() : [];
  }

  function getGoalsPool() {
    if (customGoals && customGoals.length) return customGoals.slice();
    return defaultGoals();
  }

  function parseGoalsText(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  function goalsToText(list) {
    return (list || []).join("\n");
  }

  function saveCustomGoals(list) {
    if (!list || !list.length) {
      customGoals = null;
      localStorage.removeItem(GOALS_KEY);
      return;
    }
    customGoals = list.slice();
    try {
      localStorage.setItem(GOALS_KEY, JSON.stringify(customGoals));
    } catch (e) { /* ignore quota */ }
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

  function pickBoard(seedStr) {
    const pool = getGoalsPool();
    if (pool.length < CELL_COUNT) {
      throw new Error("Za malo pytan (potrzeba min. " + CELL_COUNT + ", masz " + pool.length + ").");
    }
    const rand = mulberry32(hashSeed(seedStr));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, CELL_COUNT);
  }

  function countLines(done) {
    const at = function (r, c) {
      return !!(done && done[r * SIZE + c]);
    };
    let lines = 0;
    let r;
    let c;
    for (r = 0; r < SIZE; r++) {
      let ok = true;
      for (c = 0; c < SIZE; c++) if (!at(r, c)) { ok = false; break; }
      if (ok) lines++;
    }
    for (c = 0; c < SIZE; c++) {
      let ok = true;
      for (r = 0; r < SIZE; r++) if (!at(r, c)) { ok = false; break; }
      if (ok) lines++;
    }
    let d1 = true;
    let d2 = true;
    for (let i = 0; i < SIZE; i++) {
      if (!at(i, i)) d1 = false;
      if (!at(i, SIZE - 1 - i)) d2 = false;
    }
    if (d1) lines++;
    if (d2) lines++;
    return lines;
  }

  function lineCells(done) {
    const marked = {};
    const at = function (r, c) {
      return !!(done && done[r * SIZE + c]);
    };
    const add = function (idx) {
      marked[idx] = true;
    };
    let r;
    let c;
    for (r = 0; r < SIZE; r++) {
      let ok = true;
      for (c = 0; c < SIZE; c++) if (!at(r, c)) { ok = false; break; }
      if (ok) for (c = 0; c < SIZE; c++) add(r * SIZE + c);
    }
    for (c = 0; c < SIZE; c++) {
      let ok = true;
      for (r = 0; r < SIZE; r++) if (!at(r, c)) { ok = false; break; }
      if (ok) for (r = 0; r < SIZE; r++) add(r * SIZE + c);
    }
    let d1 = true;
    let d2 = true;
    for (let i = 0; i < SIZE; i++) {
      if (!at(i, i)) d1 = false;
      if (!at(i, SIZE - 1 - i)) d2 = false;
    }
    if (d1) for (let i = 0; i < SIZE; i++) add(i * SIZE + i);
    if (d2) for (let i = 0; i < SIZE; i++) add(i * SIZE + (SIZE - 1 - i));
    return marked;
  }

  function doneCount(done) {
    let n = 0;
    if (!done) return 0;
    for (const k in done) if (done[k]) n++;
    return n;
  }

  function newGame(nicks, code) {
    const seed =
      "bingo-board-" +
      String(code || "").toUpperCase() +
      "-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 8);
    return {
      seed: seed,
      code: String(code || "").toUpperCase(),
      board: pickBoard(seed),
      owners: {},
      players: {
        1: { nick: nicks[1] || LABELS[1], done: {} },
        2: { nick: nicks[2] || LABELS[2], done: {} },
      },
      winnerId: null,
      updatedAt: Date.now(),
    };
  }

  /** Single owner per cell: game.owners[idx] = 1|2. Keep players.*.done in sync for line counts. */
  function syncDoneFromOwners() {
    if (!game || !game.players) return;
    if (!game.owners) game.owners = {};
    if (game.players[1]) game.players[1].done = {};
    if (game.players[2]) game.players[2].done = {};
    Object.keys(game.owners).forEach(function (key) {
      const owner = Number(game.owners[key]);
      if (owner !== 1 && owner !== 2) {
        delete game.owners[key];
        return;
      }
      if (game.players[owner]) game.players[owner].done[key] = true;
    });
  }

  function migrateOwnersFromDone() {
    if (!game || !game.players) return;
    if (game.owners && typeof game.owners === "object") {
      syncDoneFromOwners();
      return;
    }
    game.owners = {};
    for (let i = 0; i < CELL_COUNT; i++) {
      const k = String(i);
      const d1 = !!(game.players[1] && game.players[1].done && (game.players[1].done[i] || game.players[1].done[k]));
      const d2 = !!(game.players[2] && game.players[2].done && (game.players[2].done[i] || game.players[2].done[k]));
      if (d1) game.owners[k] = 1;
      else if (d2) game.owners[k] = 2;
    }
    syncDoneFromOwners();
  }

  function cellOwner(idx) {
    if (!game) return 0;
    migrateOwnersFromDone();
    const owner = Number(game.owners[String(idx)] || 0);
    return owner === 1 || owner === 2 ? owner : 0;
  }

  function setRoom() {
    roomCode = LIVE;
    try { localStorage.setItem(ROOM_KEY, LIVE); } catch (e) { /* ignore */ }
  }

  function setRole(role) {
    playerRole = Number(role) || 0;
    if (playerRole === 1 || playerRole === 2) localStorage.setItem(ROLE_KEY, String(playerRole));
    else if (playerRole === 9) localStorage.setItem(ROLE_KEY, "admin");
    else localStorage.removeItem(ROLE_KEY);
  }

  function saveGameCache() {
    try {
      if (game) localStorage.setItem(GAME_KEY, JSON.stringify(game));
      else localStorage.removeItem(GAME_KEY);
    } catch (e) { /* ignore quota */ }
  }

  function clearSession() {
    setRoom("");
    setRole(0);
    game = null;
    saveGameCache();
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      resumeIfNeeded();
    }, 1500);
  }

  function roomConnected() {
    return syncStatus === "polaczono";
  }

  function publishState() {
    if (!game || !roomCode || typeof BingoCloud === "undefined") return Promise.resolve();
    return BingoCloud.save(roomCode, KIND, game).catch(function (err) {
      syncError = err.message || String(err);
      if (typeof repaint === "function") repaint();
    });
  }

  function noteResetAt(at) {
    const t = Number(at) || Date.now();
    if (t >= lastResetAt) {
      lastResetAt = t;
      try {
        localStorage.setItem("bingo.resetAt", String(lastResetAt));
      } catch (e) { /* ignore */ }
    }
  }

  function acceptIncomingGame(incoming) {
    // Nigdy nie kasuj lokalnej planszy pustym state (admin bez cache).
    if (incoming == null) return false;
    if (!incoming.board || !incoming.players) return false;
    if (lastResetAt && (incoming.updatedAt || 0) < lastResetAt) return false;
    if (!game || (incoming.updatedAt || 0) >= (game.updatedAt || 0)) {
      game = incoming;
      migrateOwnersFromDone();
      saveGameCache();
      return true;
    }
    return false;
  }

  /** Clear marks on current board; keep room, board, nicks, peer. */
  function clearGameMarks() {
    if (!game || !game.players) return false;
    game.owners = {};
    if (game.players[1]) game.players[1].done = {};
    if (game.players[2]) game.players[2].done = {};
    game.winnerId = null;
    game.updatedAt = Date.now();
    noteResetAt(game.updatedAt);
    saveGameCache();
    return true;
  }

  /** New random board in the same room; keep nicks and peer. */
  function reshuffleSameRoom(nicks) {
    if (!roomCode) return false;
    const nickMap = {
      1: (nicks && nicks[1]) || (game && game.players[1] && game.players[1].nick) || LABELS[1],
      2: (nicks && nicks[2]) || (game && game.players[2] && game.players[2].nick) || LABELS[2],
    };
    game = newGame(nickMap, roomCode);
    noteResetAt(game.updatedAt);
    saveGameCache();
    return true;
  }

  function publishGameState() {
    return publishState();
  }

  function applyToggle(playerId, idx) {
    if (!game) return false;
    if (playerId !== 1 && playerId !== 2) return false;
    migrateOwnersFromDone();
    const key = String(idx);
    const owner = Number(game.owners[key] || 0);
    if (owner === playerId) {
      delete game.owners[key];
    } else if (!owner) {
      game.owners[key] = playerId;
    } else {
      // Zajete przez przeciwnika — bez zmian.
      return false;
    }
    syncDoneFromOwners();
    game.updatedAt = Date.now();
    saveGameCache();
    return true;
  }

  function stopSync() {
    if (watchStop) {
      watchStop();
      watchStop = null;
    }
    watchingCode = "";
    joining = false;
    syncStatus = "offline";
  }

  function ensureRoomConnection() {
    const r = route();
    if (r.view === "home" || !roomCode) {
      stopSync();
      return;
    }
    if (typeof BingoCloud === "undefined") {
      syncError = "Brak sync.js";
      return;
    }
    if (watchingCode === roomCode && watchStop && syncStatus !== "blad") return;
    if (joining) return;
    joining = true;
    if (watchStop) watchStop();
    watchingCode = roomCode;
    syncStatus = "laczenie";
    syncError = "";
    watchStop = BingoCloud.watch(roomCode, KIND, function (state) {
      joining = false;
      if (!state) {
        if (playerRole === 9 && game && game.code === roomCode) {
          syncStatus = "polaczono";
          if (!emptyPublish) {
            emptyPublish = true;
            publishState();
          }
        } else {
          syncStatus = "brak gry";
        }
      } else {
        emptyPublish = false;
        if (state.updatedAt) noteResetAt(state.updatedAt);
        acceptIncomingGame(state);
        syncStatus = "polaczono";
        syncError = "";
      }
      if (typeof repaint === "function") repaint();
    }, function (err) {
      joining = false;
      syncError = err;
      syncStatus = "blad";
      if (typeof repaint === "function") repaint();
      scheduleReconnect();
    });
  }

  function resumeIfNeeded() {
    if (document.visibilityState === "hidden") return;
    const r = route();
    if (r.view === "player" || r.view === "admin") ensureRoomConnection();
  }

  function sendToggle(playerId, idx) {
    if (!applyToggle(playerId, idx)) return false;
    publishState();
    return true;
  }

  function route() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    setRoom();
    if (parts[0] === "admin") {
      setRole(9);
      return { view: "admin" };
    }
    if (parts[0] === "p1") {
      setRole(1);
      return { view: "player", id: 1 };
    }
    if (parts[0] === "p2") {
      setRole(2);
      return { view: "player", id: 2 };
    }
    return { view: "home" };
  }

  function restoreHashFromStorage() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (parts.length) return false;
    if (playerRole === 1 || playerRole === 2) {
      location.replace("#/p" + playerRole);
      return true;
    }
    if (playerRole === 9) {
      location.replace("#/admin");
      return true;
    }
    return false;
  }

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== false && v != null) {
          node.setAttribute(k, v === true ? "" : String(v));
        }
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function go(hash) {
    location.hash = hash;
  }

  function syncBadge() {
    if (syncError && syncError !== "no-host") {
      return el("p", { class: "error" }, ["Sync: " + syncError]);
    }
    let label = "Oczekiwanie";
    if (syncStatus === "polaczono") label = "Polaczono — gra na zywo";
    else if (syncStatus === "laczenie") label = "Laczenie…";
    else if (syncStatus === "brak gry") label = "Czekam az admin kliknie Nowa gra";
    else label = syncStatus;
    const ok = syncStatus === "polaczono";
    return el("p", { class: ok ? "status-ok" : "status-muted" }, [label]);
  }

  function renderHome() {
    const kids = [
      el("h1", null, ["BINGO"]),
      el("p", { class: "lead" }, ["Wybierz role tego urzadzenia"]),
      el("div", { class: "role-grid" }, [
        el("button", {
          class: "role p1",
          type: "button",
          onClick: function () {
            setRole(1);
            go("#/p1");
          },
        }, ["GRACZ 1"]),
        el("button", {
          class: "role p2",
          type: "button",
          onClick: function () {
            setRole(2);
            go("#/p2");
          },
        }, ["GRACZ 2"]),
      ]),
      el("div", { class: "role-grid" }, [
        el("button", {
          class: "role",
          type: "button",
          onClick: function () {
            setRole(9);
            go("#/admin");
          },
        }, ["ADMINISTRATOR"]),
      ]),
      el("p", { class: "hint" }, [
        "Bez kodu — wszyscy sa w jednej grze, jak w Conquest.",
      ]),
      el("p", { class: "hint" }, [
        el("a", { href: "klasyczne.html" }, ["Bingo klasyczne — wlasna plansza, admin odznacza"]),
      ]),
    ];
    app.replaceChildren(el("section", { class: "screen home" }, kids));
  }

  function renderAdmin() {
    let busy = false;
    const nick1 = el("input", {
      type: "text",
      maxlength: "16",
      value: (game && game.players[1] && game.players[1].nick) || LABELS[1],
    });
    const nick2 = el("input", {
      type: "text",
      maxlength: "16",
      value: (game && game.players[2] && game.players[2].nick) || LABELS[2],
    });
    const goalsArea = el("textarea", {
      class: "goals-editor",
      rows: "12",
      placeholder: "Jedno pytanie / cel w linii (min. 25)…",
    });
    goalsArea.value = goalsToText(getGoalsPool());
    const goalsMeta = el("p", { class: "hint goals-meta" });
    const goalsBlock = el("div", { class: "goals-block" });
    const error = el("p", { class: "error hidden" });
    const status = el("div");
    const codeBox = el("div", { class: "room-code" });
    const summary = el("div", { class: "admin-summary" });
    const boardWrap = el("div", { class: "admin-boards" });

    function showErr(msg) {
      if (!msg) {
        error.classList.add("hidden");
        error.textContent = "";
        return;
      }
      error.textContent = msg;
      error.classList.remove("hidden");
    }

    function refreshGoalsMeta() {
      const n = parseGoalsText(goalsArea.value).length;
      goalsMeta.textContent =
        n + " pytan w puli (min. " + CELL_COUNT + "). Nowa gra / Reset wylosuje plansze dla wszystkich.";
    }

    function applyGoalsFromEditor() {
      const list = parseGoalsText(goalsArea.value);
      if (list.length < CELL_COUNT) {
        throw new Error("Za malo pytan (potrzeba min. " + CELL_COUNT + ", masz " + list.length + ").");
      }
      saveCustomGoals(list);
      return list;
    }

    function paint() {
      status.replaceChildren(syncBadge());
      codeBox.replaceChildren(
        el("p", { class: "hint" }, [
          "Telefony: ten sam link → GRACZ 1 / GRACZ 2. Bez kodu.",
        ])
      );
      const editing = true;
      goalsArea.disabled = false;
      goalsBlock.classList.remove("locked");
      refreshGoalsMeta();
      summary.replaceChildren();
      boardWrap.replaceChildren();
      if (!game) {
        summary.appendChild(
          el("p", { class: "status-muted" }, ["Brak aktywnej gry — ustaw pytania i kliknij Nowa gra."])
        );
        return;
      }
      [1, 2].forEach(function (id) {
        const p = game.players[id];
        summary.appendChild(
          el("div", { class: "sum-card p" + id }, [
            el("strong", null, [p.nick]),
            el("span", null, [countLines(p.done) + " lin."]),
            el("span", { class: "muted" }, [doneCount(p.done) + "/" + CELL_COUNT]),
          ])
        );
      });
      const board = el("div", { class: "board" });
      board.style.gridTemplateColumns = "repeat(" + SIZE + ", minmax(0, 1fr))";
      const win1 = lineCells(game.players[1].done);
      const win2 = lineCells(game.players[2].done);
      game.board.forEach(function (text, idx) {
        const owner = cellOwner(idx);
        const cell = el("div", { class: "cell readonly" }, [text]);
        if (owner === 1) cell.classList.add("done-p1");
        else if (owner === 2) cell.classList.add("done-p2");
        if (win1[idx] || win2[idx]) cell.classList.add("line-win");
        board.appendChild(cell);
      });
      boardWrap.appendChild(board);
    }

    function startNew() {
      if (busy) return;
      showErr("");
      busy = true;
      try {
        applyGoalsFromEditor();
        game = newGame(
          {
            1: nick1.value.trim() || LABELS[1],
            2: nick2.value.trim() || LABELS[2],
          },
          LIVE
        );
        game.winnerId = null;
        noteResetAt(game.updatedAt);
      } catch (err) {
        busy = false;
        showErr(err.message || String(err));
        return;
      }
      stopSync();
      setRoom();
      setRole(9);
      saveGameCache();
      history.replaceState(null, "", "#/admin");
      paint();
      publishState()
        .then(function () {
          syncStatus = "polaczono";
          ensureRoomConnection();
          paint();
        })
        .catch(function (err) {
          showErr(err.message || String(err));
          paint();
        })
        .finally(function () {
          busy = false;
        });
    }

    function resetGame() {
      if (!roomCode) {
        showErr("Brak pokoju — najpierw Nowa gra.");
        return;
      }
      if (!confirm("Wylosowac nowa plansze dla wszystkich?")) return;
      showErr("");
      try {
        applyGoalsFromEditor();
        if (!reshuffleSameRoom({
          1: nick1.value.trim() || LABELS[1],
          2: nick2.value.trim() || LABELS[2],
        })) {
          showErr("Nie udalo sie wylosowac planszy.");
          return;
        }
      } catch (err) {
        showErr(err.message || String(err));
        return;
      }
      paint();
      publishGameState()
        .then(function () {
          paint();
        })
        .catch(function (err) {
          showErr(err.message || String(err));
          paint();
        });
    }

    function restoreDefaultGoals() {
      goalsArea.value = goalsToText(defaultGoals());
      saveCustomGoals(null);
      refreshGoalsMeta();
    }

    goalsArea.addEventListener("input", refreshGoalsMeta);
    goalsBlock.replaceChildren(
      el("label", { class: "field" }, [
        el("span", null, ["Pytania / cele (jedno w linii)"]),
        goalsArea,
      ]),
      goalsMeta,
      el("button", {
        class: "ghost small",
        type: "button",
        onClick: restoreDefaultGoals,
      }, ["Przywroc domyslne z goals.js"])
    );

    app.replaceChildren(
      el("section", { class: "screen admin" }, [
        el("div", { class: "topbar" }, [
          el("button", {
            class: "ghost small",
            type: "button",
            onClick: function () { go("#/"); },
          }, ["← Menu"]),
          el("strong", null, ["ADMIN"]),
        ]),
        el("h1", { class: "admin-title" }, ["BINGO"]),
        el("p", { class: "lead" }, [
          "Ustaw pytania i startuj gre. Telefony tylko wybieraja GRACZ 1 / GRACZ 2.",
        ]),
        status,
        codeBox,
        goalsBlock,
        el("div", { class: "admin-nicks" }, [
          el("label", { class: "field" }, [el("span", null, ["Gracz 1"]), nick1]),
          el("label", { class: "field" }, [el("span", null, ["Gracz 2"]), nick2]),
        ]),
        el("div", { class: "admin-actions" }, [
          el("button", { class: "primary", type: "button", onClick: startNew }, ["Nowa gra"]),
          el("button", { class: "danger", type: "button", onClick: resetGame }, ["Reset gry"]),
        ]),
        error,
        summary,
        boardWrap,
      ])
    );
    paint();

    if (roomCode && !roomConnected()) {
      ensureRoomConnection();
    }

    return paint;
  }

  function renderPlayer(id) {
    const title = el("strong", null, [LABELS[id]]);
    const linesEl = el("span", { class: "muted" }, [""]);
    const status = el("div");
    const scoreboard = el("div", { class: "admin-summary player-score" });
    const empty = el("p", { class: "status-muted" }, [
      "Czekam na gre… Admin klika Nowa gra na tym samym linku.",
    ]);
    const boardEl = el("div", { class: "board" });
    boardEl.style.gridTemplateColumns = "repeat(" + SIZE + ", minmax(0, 1fr))";

    function toggle(idx) {
      if (!game) return;
      const owner = cellOwner(idx);
      if (owner && owner !== id) return;
      if (owner === id && !confirm("Odznaczyc to pole?")) return;
      if (!sendToggle(id, idx)) {
        syncError = "Nie da sie odznaczyc tego pola";
      }
      paint();
    }

    function paintScore() {
      scoreboard.replaceChildren();
      if (!game) {
        scoreboard.classList.add("hidden");
        return;
      }
      scoreboard.classList.remove("hidden");
      [1, 2].forEach(function (pid) {
        const p = game.players[pid];
        const card = el("div", { class: "sum-card p" + pid + (pid === id ? " me" : "") }, [
          el("strong", null, [(p && p.nick) || LABELS[pid]]),
          el("span", { class: "score-lines" }, [countLines(p.done) + " lin."]),
          el("span", { class: "muted" }, [doneCount(p.done) + "/" + CELL_COUNT + " pol"]),
        ]);
        scoreboard.appendChild(card);
      });
    }

    function paint() {
      status.replaceChildren(syncBadge());
      paintScore();
      boardEl.replaceChildren();
      if (!game) {
        empty.classList.remove("hidden");
        boardEl.classList.add("hidden");
        linesEl.textContent = "";
        title.textContent = LABELS[id];
        return;
      }
      empty.classList.add("hidden");
      boardEl.classList.remove("hidden");
      const p = game.players[id];
      title.textContent = p.nick || LABELS[id];
      linesEl.textContent = " - " + countLines(p.done) + " lin.";
      const winSet = lineCells(p.done);
      game.board.forEach(function (text, idx) {
        const owner = cellOwner(idx);
        const cls =
          "cell" +
          (owner === 1 ? " done-p1" : owner === 2 ? " done-p2" : "") +
          (winSet[idx] ? " line-win" : "") +
          (owner && owner !== id ? " locked" : "");
        boardEl.appendChild(
          el(
            "button",
            {
              type: "button",
              class: cls,
              onClick: function () { toggle(idx); },
            },
            [text]
          )
        );
      });
    }

    app.replaceChildren(
      el("section", { class: "screen player" }, [
        el("div", { class: "topbar" }, [
          el("button", {
            class: "ghost small",
            type: "button",
            onClick: function () { go("#/"); },
          }, ["← Menu"]),
          el("div", null, [title, linesEl]),
          el("span", {
            class: "badge",
            style: "background:" + COLORS[id],
          }, ["P" + id]),
        ]),
        status,
        scoreboard,
        empty,
        boardEl,
      ])
    );
    paint();

    if (roomCode && !roomConnected()) {
      ensureRoomConnection();
    }

    return paint;
  }

  function showBootError(err) {
    const msg = err && err.message ? err.message : String(err);
    app.innerHTML =
      '<section class="screen"><h1>BINGO</h1>' +
      '<p class="error">Blad: ' + msg.replace(/</g, "&lt;") + "</p></section>";
  }

  function mount() {
    const r = route();
    if (r.view === "admin") repaint = renderAdmin();
    else if (r.view === "player") repaint = renderPlayer(r.id);
    else {
      stopSync();
      repaint = null;
      renderHome();
    }
  }

  window.addEventListener("hashchange", function () {
    try {
      mount();
    } catch (err) {
      showBootError(err);
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") resumeIfNeeded();
  });
  window.addEventListener("pageshow", function () {
    resumeIfNeeded();
  });
  window.addEventListener("online", function () {
    resumeIfNeeded();
  });

  try {
    if (!app) throw new Error("Brak #app");
    if (!restoreHashFromStorage()) mount();
  } catch (err) {
    showBootError(err);
  }
})();
