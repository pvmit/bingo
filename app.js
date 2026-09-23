(() => {
  const SIZE = 5;
  const CELL_COUNT = SIZE * SIZE;
  const COLORS = { 1: "#e23d4a", 2: "#5b8cff" };
  const LABELS = { 1: "Gracz 1", 2: "Gracz 2" };
  const ROOM_KEY = "bingo.room";
  const ROLE_KEY = "bingo.role";
  const GAME_KEY = "bingo.game";
  const GOALS_KEY = "bingo.goals";

  const app = document.getElementById("app");
  let game = null;
  let roomCode = localStorage.getItem(ROOM_KEY) || "";
  let playerRole = (function () {
    const raw = localStorage.getItem(ROLE_KEY);
    if (raw === "admin") return 9;
    return Number(raw) || 0;
  })();
  let customGoals = null;
  let peer = null;
  let hostConn = null;
  const clients = [];
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

  function randomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    for (let i = 0; i < 4; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function peerIdFor(code) {
    return "bingo-" + String(code).toUpperCase();
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
      players: {
        1: { nick: nicks[1] || LABELS[1], done: {} },
        2: { nick: nicks[2] || LABELS[2], done: {} },
      },
      winnerId: null,
      updatedAt: Date.now(),
    };
  }

  function setRoom(code) {
    roomCode = String(code || "").toUpperCase();
    if (roomCode) localStorage.setItem(ROOM_KEY, roomCode);
    else localStorage.removeItem(ROOM_KEY);
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

  function openClients() {
    return clients.filter(function (c) {
      return c.open;
    }).length;
  }

  function isHosting() {
    return !!(peer && !peer.destroyed && !hostConn && String(syncStatus).indexOf("host") === 0);
  }

  function isClientConnected() {
    return !!(hostConn && hostConn.open && syncStatus === "polaczono");
  }

  function roomConnected() {
    return isHosting() || isClientConnected();
  }

  function broadcastState() {
    const payload = { type: "state", game: game };
    clients.forEach(function (c) {
      if (c.open) c.send(payload);
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
    if (incoming == null) {
      if (game == null) return false;
      game = null;
      saveGameCache();
      return true;
    }
    if (lastResetAt && (incoming.updatedAt || 0) < lastResetAt) return false;
    if (!game || (incoming.updatedAt || 0) >= (game.updatedAt || 0)) {
      game = incoming;
      saveGameCache();
      return true;
    }
    return false;
  }

  /** Clear marks on current board; keep room, board, nicks, peer. */
  function clearGameMarks() {
    if (!game || !game.players) return false;
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
    if (isHosting()) {
      broadcastState();
      return Promise.resolve();
    }
    if (hostConn && hostConn.open) {
      hostConn.send({ type: "reset", at: lastResetAt, game: game });
      return Promise.resolve();
    }
    if (!roomCode) return Promise.resolve();
    return tryBecomeHost(roomCode).then(function () {
      broadcastState();
    });
  }

  function applyToggle(playerId, idx) {
    if (!game) return false;
    const p = game.players[playerId];
    if (!p) return false;
    if (p.done[idx]) delete p.done[idx];
    else p.done[idx] = true;
    game.updatedAt = Date.now();
    saveGameCache();
    return true;
  }

  function updateHostStatus() {
    syncStatus = "host (" + openClients() + " pol.)";
    if (typeof repaint === "function") repaint();
  }

  function destroyPeer() {
    while (clients.length) clients.pop();
    if (hostConn) {
      try { hostConn.close(); } catch (e) { /* ignore */ }
      hostConn = null;
    }
    if (peer) {
      try { peer.destroy(); } catch (e) { /* ignore */ }
      peer = null;
    }
    syncStatus = "offline";
  }

  function wireHostConnection(conn) {
    clients.push(conn);
    conn.on("open", function () {
      conn.send({ type: "state", game: game });
      updateHostStatus();
    });
    conn.on("data", function (msg) {
      if (!msg) return;
      if (msg.type === "toggle") {
        if (applyToggle(msg.playerId, msg.idx)) {
          broadcastState();
          if (typeof repaint === "function") repaint();
        }
        return;
      }
      if (msg.type === "reset") {
        if (msg.at) noteResetAt(msg.at);
        if (acceptIncomingGame(msg.game)) {
          broadcastState();
          if (typeof repaint === "function") repaint();
        }
        return;
      }
      if (msg.type === "state") {
        if (acceptIncomingGame(msg.game)) {
          broadcastState();
          if (typeof repaint === "function") repaint();
        }
      }
    });
    conn.on("close", function () {
      const i = clients.indexOf(conn);
      if (i >= 0) clients.splice(i, 1);
      updateHostStatus();
    });
  }

  function tryJoinAsClient(code) {
    return new Promise(function (resolve, reject) {
      destroyPeer();
      setRoom(code);
      if (typeof Peer === "undefined") {
        reject(new Error("PeerJS nie zaladowany — sprawdz internet / CDN."));
        return;
      }
      syncStatus = "laczenie";
      syncError = "";
      let settled = false;
      const failTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
        peer = null;
        hostConn = null;
        syncStatus = "offline";
        reject(new Error("no-host"));
      }, 4500);

      peer = new Peer({ debug: 0 });
      peer.on("open", function () {
        hostConn = peer.connect(peerIdFor(code), { reliable: true });
        hostConn.on("open", function () {
          if (settled) return;
          settled = true;
          clearTimeout(failTimer);
          syncStatus = "polaczono";
          syncError = "";
          if (game) hostConn.send({ type: "state", game: game });
          if (typeof repaint === "function") repaint();
          resolve();
        });
        hostConn.on("data", function (msg) {
          if (!msg || msg.type !== "state") return;
          if (acceptIncomingGame(msg.game) && typeof repaint === "function") repaint();
        });
        hostConn.on("close", function () {
          syncStatus = "rozlaczono";
          if (typeof repaint === "function") repaint();
          scheduleReconnect();
        });
        hostConn.on("error", function (err) {
          if (!settled) {
            settled = true;
            clearTimeout(failTimer);
            reject(err);
            return;
          }
          syncError = err.message || String(err);
          syncStatus = "blad";
          if (typeof repaint === "function") repaint();
          scheduleReconnect();
        });
      });
      peer.on("error", function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        reject(err);
      });
    });
  }

  function tryBecomeHost(code) {
    return new Promise(function (resolve, reject) {
      destroyPeer();
      setRoom(code);
      if (typeof Peer === "undefined") {
        reject(new Error("PeerJS nie zaladowany — sprawdz internet / CDN."));
        return;
      }
      syncStatus = "laczenie";
      syncError = "";
      let settled = false;
      const failTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        syncError = "Timeout PeerJS — sprobuj ponownie";
        syncStatus = "blad";
        reject(new Error(syncError));
      }, 10000);

      peer = new Peer(peerIdFor(code), { debug: 0 });
      peer.on("open", function () {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        syncStatus = "host (0 pol.)";
        syncError = "";
        if (typeof repaint === "function") repaint();
        resolve();
      });
      peer.on("connection", wireHostConnection);
      peer.on("error", function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        if (err && err.type === "unavailable-id") {
          tryJoinAsClient(code).then(resolve).catch(reject);
          return;
        }
        syncError = (err && (err.type || err.message)) || String(err);
        syncStatus = "blad";
        if (typeof repaint === "function") repaint();
        reject(err);
      });
    });
  }

  /** Anyone online can host — admin can close after players joined. */
  function enterRoom(code) {
    return tryJoinAsClient(code).catch(function () {
      return tryBecomeHost(code);
    });
  }

  function ensureRoomConnection() {
    const r = route();
    if (r.view === "home" || !roomCode || joining) return;
    if (roomConnected()) return;
    joining = true;
    enterRoom(roomCode)
      .catch(function (err) {
        syncError = err.message || String(err);
        scheduleReconnect();
      })
      .finally(function () {
        joining = false;
        if (typeof repaint === "function") repaint();
      });
  }

  function resumeIfNeeded() {
    if (document.visibilityState === "hidden") return;
    const r = route();
    if (r.view === "player" || r.view === "admin") ensureRoomConnection();
  }

  function sendToggle(playerId, idx) {
    if (hostConn && hostConn.open) {
      hostConn.send({ type: "toggle", playerId: playerId, idx: idx });
      return true;
    }
    if (isHosting() && applyToggle(playerId, idx)) {
      broadcastState();
      return true;
    }
    return false;
  }

  function route() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (parts[0] === "admin") {
      if (parts[1]) setRoom(parts[1]);
      setRole(9);
      return { view: "admin" };
    }
    if (parts[0] === "p1") {
      if (parts[1]) setRoom(parts[1]);
      setRole(1);
      return { view: "player", id: 1 };
    }
    if (parts[0] === "p2") {
      if (parts[1]) setRoom(parts[1]);
      setRole(2);
      return { view: "player", id: 2 };
    }
    return { view: "home" };
  }

  function restoreHashFromStorage() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (parts.length) return false;
    if ((playerRole === 1 || playerRole === 2) && roomCode) {
      location.replace("#/p" + playerRole + "/" + roomCode);
      return true;
    }
    if (playerRole === 9 && roomCode) {
      location.replace("#/admin/" + roomCode);
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
    let label = "Brak pokoju";
    if (roomCode) {
      if (syncStatus.indexOf("host") === 0) {
        label = "Host pokoju " + roomCode + " · " + syncStatus + " (admin nie musi byc online)";
      } else if (syncStatus === "polaczono") label = "Polaczono z " + roomCode;
      else if (syncStatus === "laczenie") label = "Laczenie z " + roomCode + "…";
      else label = "Pokoj " + roomCode + " · " + syncStatus;
    }
    const ok = syncStatus === "polaczono" || syncStatus.indexOf("host") === 0;
    return el("p", { class: ok ? "status-ok" : "status-muted" }, [label]);
  }

  function renderHome() {
    const codeInput = el("input", {
      type: "text",
      maxlength: "4",
      placeholder: "ABCD",
      value: roomCode,
      class: "code-input",
    });
    const kids = [
      el("h1", null, ["BINGO"]),
      el("p", { class: "lead" }, ["3 urzadzenia · wspolna plansza 5×5"]),
    ];
    if (roomCode && (playerRole === 1 || playerRole === 2)) {
      kids.push(
        el("button", {
          class: "primary",
          type: "button",
          onClick: function () {
            go("#/p" + playerRole + "/" + roomCode);
          },
        }, ["Wroc do gry (" + roomCode + ")"])
      );
    }
    kids.push(
      el("label", { class: "field" }, [
        el("span", null, ["Kod pokoju (od admina)"]),
        codeInput,
      ]),
      el("div", { class: "role-grid" }, [
        el("button", {
          class: "role p1",
          type: "button",
          onClick: function () {
            const c = codeInput.value.trim().toUpperCase();
            if (c.length !== 4) {
              alert("Wpisz 4-znakowy kod z panelu admina.");
              return;
            }
            setRoom(c);
            setRole(1);
            go("#/p1/" + c);
          },
        }, ["GRACZ 1"]),
        el("button", {
          class: "role p2",
          type: "button",
          onClick: function () {
            const c = codeInput.value.trim().toUpperCase();
            if (c.length !== 4) {
              alert("Wpisz 4-znakowy kod z panelu admina.");
              return;
            }
            setRoom(c);
            setRole(2);
            go("#/p2/" + c);
          },
        }, ["GRACZ 2"]),
      ]),
      el("p", { class: "hint" }, [
        "Wpisz kod od prowadzacego i wybierz gracza.",
      ])
    );
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
        n + " pytan w puli (min. " + CELL_COUNT + "). Nowa gra = nowy pokoj; Reset = nowa plansza w tym samym.";
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
        el("div", { class: "code-big" }, [roomCode || "----"]),
        el("p", { class: "hint" }, [
          "Na telefonach: ten sam link + kod, albo ",
          "#/p1/" + (roomCode || "KOD"),
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
        const d1 = !!game.players[1].done[idx];
        const d2 = !!game.players[2].done[idx];
        const cell = el("div", { class: "cell readonly" }, [text]);
        if (d1) cell.classList.add("done-p1");
        if (d2) cell.classList.add("done-p2");
        if (win1[idx] || win2[idx]) cell.classList.add("line-win");
        board.appendChild(cell);
      });
      boardWrap.appendChild(board);
    }

    function startNew() {
      if (busy) return;
      showErr("");
      busy = true;
      const code = randomCode();
      try {
        applyGoalsFromEditor();
        game = newGame(
          {
            1: nick1.value.trim() || LABELS[1],
            2: nick2.value.trim() || LABELS[2],
          },
          code
        );
        game.winnerId = null;
        noteResetAt(game.updatedAt);
      } catch (err) {
        busy = false;
        showErr(err.message || String(err));
        return;
      }
      destroyPeer();
      setRoom(code);
      setRole(9);
      saveGameCache();
      history.replaceState(null, "", "#/admin/" + code);
      paint();
      tryBecomeHost(code)
        .then(function () {
          broadcastState();
          paint();
        })
        .catch(function (err) {
          showErr(err.type || err.message || String(err));
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
      if (!confirm("Wylosowac nowa plansze w tym samym pokoju (" + roomCode + ")?")) return;
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
          "Ustaw pytania, startuj gre i rozdaj kod. Potem mozesz zamknac laptopa. Bingo nie konczy gry.",
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
    const empty = el("p", { class: "status-muted" }, [
      "Brak gry albo laczenie… Wejdz po starcie u admina (wystarczy raz pobrac plansze).",
    ]);
    const boardEl = el("div", { class: "board" });
    boardEl.style.gridTemplateColumns = "repeat(" + SIZE + ", minmax(0, 1fr))";

    function toggle(idx) {
      if (!game) return;
      if (!sendToggle(id, idx)) {
        syncError = "Brak polaczenia z hostem";
        paint();
      }
    }

    function paint() {
      status.replaceChildren(syncBadge());
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
        const d1 = !!game.players[1].done[idx];
        const d2 = !!game.players[2].done[idx];
        const cls =
          "cell" +
          (d1 ? " done-p1" : "") +
          (d2 ? " done-p2" : "") +
          (winSet[idx] ? " line-win" : "");
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
      destroyPeer();
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
