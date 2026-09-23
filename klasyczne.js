(() => {
  const SIZE = 5;
  const CELL_COUNT = SIZE * SIZE;
  const ROOM_KEY = "bingo.k.room";
  const ROLE_KEY = "bingo.k.role";
  const PID_KEY = "bingo.k.pid";
  const NICK_KEY = "bingo.k.nick";
  const GAME_KEY = "bingo.k.game";
  const GOALS_KEY = "bingo.k.goals";
  const GOALS_VER_KEY = "bingo.k.goalsVer";
  const GOALS_VER = "katowice-1";

  const app = document.getElementById("app");
  let game = null;
  let roomCode = localStorage.getItem(ROOM_KEY) || "";
  let role = localStorage.getItem(ROLE_KEY) || "";
  let playerId = localStorage.getItem(PID_KEY) || "";
  let nickDraft = localStorage.getItem(NICK_KEY) || "";
  let customGoals = null;
  let peer = null;
  let hostConn = null;
  const clients = [];
  let repaint = null;
  let syncStatus = "offline";
  let syncError = "";
  let reconnectTimer = null;
  let joining = false;

  if (!playerId) {
    playerId = (crypto.randomUUID && crypto.randomUUID()) || ("p" + Math.random().toString(36).slice(2, 12));
    try { localStorage.setItem(PID_KEY, playerId); } catch (e) { /* ignore */ }
  }

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

  function pickBoard(seedStr, pool) {
    const list = (pool || []).slice();
    if (list.length < CELL_COUNT) {
      throw new Error("Za malo pytan (potrzeba min. " + CELL_COUNT + ", masz " + list.length + ").");
    }
    const rand = mulberry32(hashSeed(seedStr));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list.slice(0, CELL_COUNT);
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

  function boardDone(board, called) {
    const done = {};
    (board || []).forEach(function (text, idx) {
      if (called && called[text]) done[idx] = true;
    });
    return done;
  }

  function playerStats(p) {
    if (!p || !p.board) return { lines: 0, marks: 0, bingo: false, done: {} };
    const done = boardDone(p.board, game && game.called);
    const lines = countLines(done);
    let marks = 0;
    for (const k in done) if (done[k]) marks++;
    return { lines: lines, marks: marks, bingo: lines > 0, done: done };
  }

  function playerList() {
    if (!game || !game.players) return [];
    return Object.keys(game.players).map(function (id) {
      const p = game.players[id];
      const st = playerStats(p);
      return {
        id: id,
        nick: p.nick || "Gracz",
        board: p.board,
        lines: st.lines,
        marks: st.marks,
        bingo: st.bingo,
        done: st.done,
      };
    }).sort(function (a, b) {
      if (a.bingo !== b.bingo) return a.bingo ? -1 : 1;
      if (b.lines !== a.lines) return b.lines - a.lines;
      return String(a.nick).localeCompare(String(b.nick), "pl");
    });
  }

  function randomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    for (let i = 0; i < 4; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function peerIdFor(code) {
    return "bingo-k-" + String(code).toUpperCase();
  }

  function newGame(code, pool) {
    return {
      code: String(code || "").toUpperCase(),
      pool: (pool || getGoalsPool()).slice(),
      called: {},
      players: {},
      updatedAt: Date.now(),
    };
  }

  function setRoom(code) {
    roomCode = String(code || "").toUpperCase();
    if (roomCode) localStorage.setItem(ROOM_KEY, roomCode);
    else localStorage.removeItem(ROOM_KEY);
  }

  function setRole(next) {
    role = next || "";
    if (role) localStorage.setItem(ROLE_KEY, role);
    else localStorage.removeItem(ROLE_KEY);
  }

  function saveNick(nick) {
    nickDraft = String(nick || "").trim().slice(0, 20);
    if (nickDraft) localStorage.setItem(NICK_KEY, nickDraft);
    else localStorage.removeItem(NICK_KEY);
  }

  function saveGameCache() {
    try {
      if (game) localStorage.setItem(GAME_KEY, JSON.stringify(game));
      else localStorage.removeItem(GAME_KEY);
    } catch (e) { /* ignore quota */ }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      resumeIfNeeded();
    }, 1500);
  }

  function openClients() {
    return clients.filter(function (c) { return c.open; }).length;
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
    if (!game) return;
    const payload = { type: "state", game: game };
    clients.forEach(function (c) {
      if (c.open) c.send(payload);
    });
  }

  function acceptIncomingGame(incoming) {
    if (incoming == null) return false;
    if (!incoming.pool || !incoming.players) return false;
    if (!game || (incoming.updatedAt || 0) >= (game.updatedAt || 0)) {
      game = incoming;
      if (!game.called) game.called = {};
      if (!game.players) game.players = {};
      saveGameCache();
      return true;
    }
    return false;
  }

  function ensurePlayerBoard(pid, nick) {
    if (!game) return false;
    if (!game.players) game.players = {};
    const existing = game.players[pid];
    if (existing && existing.board && existing.board.length === CELL_COUNT) {
      if (nick && existing.nick !== nick) {
        existing.nick = nick;
        game.updatedAt = Date.now();
        saveGameCache();
      }
      return false;
    }
    const seed = "k-" + game.code + "-" + pid + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    game.players[pid] = {
      nick: (nick || "Gracz").slice(0, 20),
      board: pickBoard(seed, game.pool),
      locked: true,
      joinedAt: Date.now(),
    };
    game.updatedAt = Date.now();
    saveGameCache();
    return true;
  }

  function applyCall(text, on) {
    if (!game) return false;
    if (!game.called) game.called = {};
    const key = String(text || "");
    if (!key) return false;
    if (on) game.called[key] = true;
    else delete game.called[key];
    game.updatedAt = Date.now();
    saveGameCache();
    return true;
  }

  function clearCalled() {
    if (!game) return false;
    game.called = {};
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
      if (game) conn.send({ type: "state", game: game });
      updateHostStatus();
    });
    conn.on("data", function (msg) {
      if (!msg) return;
      if (msg.type === "join") {
        const pid = String(msg.playerId || "");
        const nick = String(msg.nick || "Gracz").trim().slice(0, 20) || "Gracz";
        if (!pid || !game) return;
        ensurePlayerBoard(pid, nick);
        broadcastState();
        if (typeof repaint === "function") repaint();
        return;
      }
      if (msg.type === "reset" && msg.game) {
        if (acceptIncomingGame(msg.game)) {
          broadcastState();
          if (typeof repaint === "function") repaint();
        }
        return;
      }
      if (msg.type === "admin-takeover") {
        if (game) {
          try { conn.send({ type: "state", game: game }); } catch (e) { /* ignore */ }
        }
        setTimeout(function () {
          destroyPeer();
          syncStatus = "rozlaczono";
          if (typeof repaint === "function") repaint();
          scheduleReconnect();
        }, 200);
        return;
      }
      if (msg.type === "state" && msg.game && !game) {
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

  function sendJoinIfPlayer() {
    if (role !== "player" || !nickDraft || !playerId) return;
    const payload = { type: "join", playerId: playerId, nick: nickDraft };
    if (isHosting()) {
      if (game) {
        ensurePlayerBoard(playerId, nickDraft);
        broadcastState();
      }
      return;
    }
    if (hostConn && hostConn.open) hostConn.send(payload);
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
          sendJoinIfPlayer();
          if (typeof repaint === "function") repaint();
          resolve();
        });
        hostConn.on("data", function (msg) {
          if (!msg) return;
          if (msg.type === "state") {
            if (acceptIncomingGame(msg.game) && typeof repaint === "function") repaint();
          }
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

  function tryBecomeHost(code, opts) {
    const allowClientFallback = !(opts && opts.strict);
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
        sendJoinIfPlayer();
        if (typeof repaint === "function") repaint();
        resolve();
      });
      peer.on("connection", wireHostConnection);
      peer.on("error", function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        if (err && err.type === "unavailable-id" && allowClientFallback) {
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

  function askHostToYield(code) {
    return tryJoinAsClient(code).then(function () {
      return new Promise(function (resolve) {
        if (!hostConn || !hostConn.open) {
          destroyPeer();
          resolve();
          return;
        }
        let done = false;
        const finish = function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          destroyPeer();
          resolve();
        };
        const timer = setTimeout(finish, 3500);
        setTimeout(function () {
          if (!hostConn || !hostConn.open) {
            finish();
            return;
          }
          try { hostConn.send({ type: "admin-takeover" }); } catch (e) { finish(); }
        }, 600);
        hostConn.on("close", finish);
      });
    });
  }

  function claimHostAsAdmin(code) {
    return tryBecomeHost(code, { strict: true }).catch(function () {
      return askHostToYield(code).then(function () {
        return tryBecomeHost(code, { strict: true });
      });
    }).then(function () {
      if (game) broadcastState();
    });
  }

  function enterRoom(code) {
    const r = route();
    if (r.view === "admin") return claimHostAsAdmin(code);
    return tryJoinAsClient(code).catch(function () {
      return Promise.reject(new Error("Brak hosta. Admin musi miec otwarty panel i kliknac Nowa gra."));
    });
  }

  function ensureRoomConnection() {
    const r = route();
    if (r.view === "home" || !roomCode || joining) return;
    if (r.view === "admin") {
      if (isHosting()) return;
      joining = true;
      claimHostAsAdmin(roomCode)
        .catch(function (err) {
          syncError = err.message || String(err);
          scheduleReconnect();
        })
        .finally(function () {
          joining = false;
          if (typeof repaint === "function") repaint();
        });
      return;
    }
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

  function sendCall(text, on) {
    if (isHosting()) {
      if (!applyCall(text, on)) return false;
      broadcastState();
      return true;
    }
    if (hostConn && hostConn.open) {
      hostConn.send({ type: "call", text: text, on: on });
      return true;
    }
    return applyCall(text, on);
  }

  function route() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (parts[0] === "admin") {
      if (parts[1]) setRoom(parts[1]);
      setRole("admin");
      return { view: "admin" };
    }
    if (parts[0] === "play") {
      if (parts[1]) setRoom(parts[1]);
      setRole("player");
      return { view: "player" };
    }
    return { view: "home" };
  }

  function restoreHashFromStorage() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (parts.length) return false;
    if (role === "player" && roomCode) {
      location.replace("#/play/" + roomCode);
      return true;
    }
    if (role === "admin" && roomCode) {
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
        label = "Host pokoju " + roomCode + " · " + syncStatus + " — laptop admina musi zostac wlaczony";
      } else if (syncStatus === "polaczono") label = "Polaczono z " + roomCode;
      else if (syncStatus === "laczenie") label = "Laczenie z " + roomCode + "…";
      else label = "Pokoj " + roomCode + " · " + syncStatus;
    }
    const ok = syncStatus === "polaczono" || syncStatus.indexOf("host") === 0;
    return el("p", { class: ok ? "status-ok" : "status-muted" }, [label]);
  }

  function renderBoard(board) {
    const wrap = el("div", { class: "board" });
    wrap.style.gridTemplateColumns = "repeat(" + SIZE + ", minmax(0, 1fr))";
    const called = (game && game.called) || {};
    const done = boardDone(board, called);
    const winSet = lineCells(done);
    (board || []).forEach(function (text, idx) {
      const marked = !!done[idx];
      const cls =
        "cell readonly" +
        (marked ? " called" : "") +
        (winSet[idx] ? " line-win" : "");
      wrap.appendChild(el("div", { class: cls }, [text]));
    });
    return wrap;
  }

  function renderHome() {
    const nickInput = el("input", {
      type: "text",
      maxlength: "20",
      placeholder: "np. Zosia",
      value: nickDraft,
    });
    const codeInput = el("input", {
      type: "text",
      maxlength: "4",
      placeholder: "ABCD",
      value: roomCode,
      class: "code-input",
    });
    const kids = [
      el("h1", null, ["BINGO"]),
      el("p", { class: "lead" }, ["Klasyczne: wlasna plansza, admin odznacza cele."]),
    ];
    if (role === "player" && roomCode && nickDraft) {
      kids.push(
        el("button", {
          class: "primary",
          type: "button",
          onClick: function () {
            go("#/play/" + roomCode);
          },
        }, ["Wroc do gry (" + roomCode + ")"])
      );
    }
    kids.push(
      el("label", { class: "field" }, [
        el("span", null, ["Pseudonim"]),
        nickInput,
      ]),
      el("label", { class: "field" }, [
        el("span", null, ["Kod pokoju (od admina)"]),
        codeInput,
      ]),
      el("button", {
        class: "primary join-btn",
        type: "button",
        onClick: function () {
          const nick = nickInput.value.trim();
          const c = codeInput.value.trim().toUpperCase();
          if (!nick) {
            alert("Wpisz pseudonim.");
            return;
          }
          if (c.length !== 4) {
            alert("Wpisz 4-znakowy kod z panelu admina.");
            return;
          }
          saveNick(nick);
          setRoom(c);
          setRole("player");
          go("#/play/" + c);
        },
      }, ["Dolacz i wylosuj plansze"]),
      el("p", { class: "hint" }, [
        "Plansza losuje sie raz — potem jej nie zmienisz. Pola zaznacza tylko prowadzacy.",
      ]),
      el("p", { class: "hint" }, [
        el("a", { href: "index.html" }, ["Bingo 2 graczy (wspolna plansza)"]),
        " · ",
        el("a", { href: "#/admin" }, ["Panel admina"]),
      ])
    );
    app.replaceChildren(el("section", { class: "screen home" }, kids));
  }

  function renderAdmin() {
    let busy = false;
    const goalsArea = el("textarea", {
      class: "goals-editor",
      rows: "12",
      placeholder: "Jedno pytanie / cel w linii (min. 25)…",
    });
    goalsArea.value = goalsToText((game && game.pool) || getGoalsPool());
    const goalsMeta = el("p", { class: "hint goals-meta" });
    const goalsBlock = el("div", { class: "goals-block" });
    const error = el("p", { class: "error hidden" });
    const status = el("div");
    const codeBox = el("div", { class: "room-code" });
    const bingoBanner = el("div");
    const playersWrap = el("div", { class: "admin-summary" });
    const poolWrap = el("div", { class: "call-pool" });
    const boardsWrap = el("div", { class: "admin-mini-boards" });

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
        n + " pytan w puli (min. " + CELL_COUNT + "). Nowa gra = nowy pokoj i nowe plansze graczy.";
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
          "Gracze: klasyczne.html → pseudonim + ten kod. Admin musi zostac online.",
        ])
      );
      refreshGoalsMeta();
      bingoBanner.replaceChildren();
      playersWrap.replaceChildren();
      poolWrap.replaceChildren();
      boardsWrap.replaceChildren();
      if (!game) {
        playersWrap.appendChild(
          el("p", { class: "status-muted" }, ["Brak aktywnej gry — ustaw pytania i kliknij Nowa gra."])
        );
        return;
      }
      const list = playerList();
      const winners = list.filter(function (p) { return p.bingo; });
      if (winners.length) {
        bingoBanner.appendChild(
          el("div", { class: "winner" }, [
            "BINGO: " + winners.map(function (p) { return p.nick; }).join(", "),
          ])
        );
      } else if (!list.length) {
        bingoBanner.appendChild(
          el("p", { class: "status-muted" }, ["Nikt jeszcze nie dolaczyl."])
        );
      } else {
        bingoBanner.appendChild(
          el("p", { class: "status-muted" }, ["Brak bingo."])
        );
      }
      list.forEach(function (p) {
        playersWrap.appendChild(
          el("div", { class: "sum-card" + (p.bingo ? " bingo" : "") }, [
            el("strong", null, [p.nick]),
            el("span", { class: p.bingo ? "score-lines" : "" }, [p.bingo ? "BINGO" : "brak bingo"]),
            el("span", { class: "muted" }, [p.lines + " lin. · " + p.marks + "/" + CELL_COUNT]),
          ])
        );
      });
      const called = game.called || {};
      (game.pool || []).forEach(function (text) {
        const on = !!called[text];
        poolWrap.appendChild(
          el("button", {
            type: "button",
            class: "call-item" + (on ? " on" : ""),
            onClick: function () {
              sendCall(text, !on);
              paint();
            },
          }, [text])
        );
      });
      list.forEach(function (p) {
        boardsWrap.appendChild(
          el("div", { class: "mini-board-card" }, [
            el("h3", null, [p.nick + (p.bingo ? " · BINGO" : "")]),
            renderBoard(p.board),
          ])
        );
      });
    }

    function startNew() {
      if (busy) return;
      showErr("");
      busy = true;
      const code = randomCode();
      try {
        const pool = applyGoalsFromEditor();
        game = newGame(code, pool);
      } catch (err) {
        busy = false;
        showErr(err.message || String(err));
        return;
      }
      destroyPeer();
      setRoom(code);
      setRole("admin");
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

    function resetMarks() {
      if (!game) {
        showErr("Brak gry — najpierw Nowa gra.");
        return;
      }
      if (!confirm("Wyczyscic zaznaczenia? Plansze graczy zostaja.")) return;
      clearCalled();
      paint();
      if (isHosting()) broadcastState();
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
          el("strong", null, ["ADMIN · klasyczne"]),
        ]),
        el("h1", { class: "admin-title" }, ["BINGO"]),
        el("p", { class: "lead" }, [
          "Startuj gre, rozdaj kod. Klikaj cele — zaznaczenia ida na plansze wszystkich graczy.",
        ]),
        status,
        codeBox,
        goalsBlock,
        el("div", { class: "admin-actions" }, [
          el("button", { class: "primary", type: "button", onClick: startNew }, ["Nowa gra"]),
          el("button", { class: "danger", type: "button", onClick: resetMarks }, ["Wyczysc zaznaczenia"]),
        ]),
        error,
        bingoBanner,
        playersWrap,
        el("h2", { class: "section-title" }, ["Pula — kliknij, zeby odznaczyc"]),
        poolWrap,
        boardsWrap,
      ])
    );
    paint();

    if (roomCode && !roomConnected()) {
      ensureRoomConnection();
    }

    return paint;
  }

  function renderPlayer() {
    const title = el("strong", null, [nickDraft || "Gracz"]);
    const status = el("div");
    const bingoEl = el("div");
    const empty = el("p", { class: "status-muted" }, [
      "Czekam na plansze… Admin musi miec otwarty panel (Nowa gra) i ten sam kod.",
    ]);
    const boardHost = el("div");
    const lockedNote = el("p", { class: "hint" }, [
      "To Twoja plansza — nie da sie jej wylosowac ponownie. Pola zaznacza prowadzacy.",
    ]);

    function paint() {
      status.replaceChildren(syncBadge());
      bingoEl.replaceChildren();
      boardHost.replaceChildren();
      const me = game && game.players && game.players[playerId];
      if (!me || !me.board) {
        empty.classList.remove("hidden");
        lockedNote.classList.add("hidden");
        title.textContent = nickDraft || "Gracz";
        if (roomConnected()) sendJoinIfPlayer();
        return;
      }
      empty.classList.add("hidden");
      lockedNote.classList.remove("hidden");
      title.textContent = me.nick || nickDraft || "Gracz";
      const st = playerStats(me);
      if (st.bingo) {
        bingoEl.appendChild(el("div", { class: "winner" }, ["BINGO!"]));
      } else {
        bingoEl.appendChild(
          el("p", { class: "status-muted" }, [st.marks + "/" + CELL_COUNT + " · " + st.lines + " lin."])
        );
      }
      boardHost.appendChild(renderBoard(me.board));
    }

    app.replaceChildren(
      el("section", { class: "screen player" }, [
        el("div", { class: "topbar" }, [
          el("button", {
            class: "ghost small",
            type: "button",
            onClick: function () { go("#/"); },
          }, ["← Menu"]),
          el("div", null, [title]),
        ]),
        status,
        bingoEl,
        empty,
        boardHost,
        lockedNote,
      ])
    );
    paint();

    if (roomCode && !roomConnected()) {
      ensureRoomConnection();
    } else {
      sendJoinIfPlayer();
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
    else if (r.view === "player") repaint = renderPlayer();
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
