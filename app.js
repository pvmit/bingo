(() => {
  const SIZE = 5;
  const CELL_COUNT = SIZE * SIZE;
  const COLORS = { 1: "#e23d4a", 2: "#5b8cff" };
  const LABELS = { 1: "Gracz 1", 2: "Gracz 2" };
  const ROOM_KEY = "bingo.room";
  const ROLE_KEY = "bingo.role";
  const GAME_KEY = "bingo.game";

  const app = document.getElementById("app");
  let game = null;
  let roomCode = localStorage.getItem(ROOM_KEY) || "";
  let playerRole = (function () {
    const raw = localStorage.getItem(ROLE_KEY);
    if (raw === "admin") return 9;
    return Number(raw) || 0;
  })();
  let peer = null;
  let hostConn = null;
  const clients = [];
  let repaint = null;
  let syncStatus = "offline";
  let syncError = "";
  let reconnectTimer = null;
  let joining = false;

  try {
    const cached = localStorage.getItem(GAME_KEY);
    if (cached) game = JSON.parse(cached);
  } catch (e) {
    game = null;
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
    const pool = Array.isArray(window.GOALS) ? window.GOALS.slice() : [];
    if (pool.length < CELL_COUNT) {
      throw new Error("Za malo celow w goals.js (potrzeba " + CELL_COUNT + ").");
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

  function newGame(nicks) {
    const seed = "bingo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    return {
      seed: seed,
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

  function ensurePlayerConnection() {
    const r = route();
    if (r.view !== "player" || !roomCode || joining) return;
    if (hostConn && hostConn.open && syncStatus === "polaczono") return;
    joining = true;
    joinHost(roomCode)
      .catch(function (err) {
        syncError = err.message || String(err);
        scheduleReconnect();
      })
      .finally(function () {
        joining = false;
        if (typeof repaint === "function") repaint();
      });
  }
  function openClients() {
    return clients.filter(function (c) {
      return c.open;
    }).length;
  }

  function broadcastState() {
    const payload = { type: "state", game: game };
    clients.forEach(function (c) {
      if (c.open) c.send(payload);
    });
  }

  function applyToggle(playerId, idx) {
    if (!game || game.winnerId) return false;
    const p = game.players[playerId];
    if (!p) return false;
    if (p.done[idx]) delete p.done[idx];
    else p.done[idx] = true;
    if (countLines(p.done) >= 1) game.winnerId = playerId;
    game.updatedAt = Date.now();
    saveGameCache();
    return true;
  }

  function ensureAdminHost() {
    const r = route();
    if (r.view !== "admin" || !roomCode || !game || joining) return;
    if (peer && !peer.destroyed && String(syncStatus).indexOf("host") === 0) return;
    joining = true;
    startHost(roomCode)
      .then(function () {
        broadcastState();
      })
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
    if (r.view === "player") ensurePlayerConnection();
    else if (r.view === "admin") ensureAdminHost();
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

  function startHost(code) {
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
      peer.on("connection", function (conn) {
        clients.push(conn);
        conn.on("open", function () {
          conn.send({ type: "state", game: game });
          syncStatus = "host (" + openClients() + " pol.)";
          if (typeof repaint === "function") repaint();
        });
        conn.on("data", function (msg) {
          if (!msg || msg.type !== "toggle") return;
          if (applyToggle(msg.playerId, msg.idx)) {
            broadcastState();
            if (typeof repaint === "function") repaint();
          }
        });
        conn.on("close", function () {
          const i = clients.indexOf(conn);
          if (i >= 0) clients.splice(i, 1);
          syncStatus = "host (" + openClients() + " pol.)";
          if (typeof repaint === "function") repaint();
        });
      });
      peer.on("error", function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        syncError = err.type || err.message || String(err);
        syncStatus = "blad";
        if (typeof repaint === "function") repaint();
        reject(err);
      });
    });
  }

  function joinHost(code) {
    return new Promise(function (resolve, reject) {
      destroyPeer();
      setRoom(code);
      if (typeof Peer === "undefined") {
        reject(new Error("PeerJS nie zaladowany — sprawdz internet / CDN."));
        return;
      }
      syncStatus = "laczenie";
      syncError = "";
      peer = new Peer({ debug: 0 });
      peer.on("open", function () {
        hostConn = peer.connect(peerIdFor(code), { reliable: true });
        hostConn.on("open", function () {
          syncStatus = "polaczono";
          syncError = "";
          if (typeof repaint === "function") repaint();
          resolve();
        });
        hostConn.on("data", function (msg) {
          if (!msg || msg.type !== "state") return;
          game = msg.game;
          saveGameCache();
          if (typeof repaint === "function") repaint();
        });
        hostConn.on("close", function () {
          syncStatus = "rozlaczono";
          if (typeof repaint === "function") repaint();
          scheduleReconnect();
        });
        hostConn.on("error", function (err) {
          syncError = err.message || String(err);
          syncStatus = "blad";
          if (typeof repaint === "function") repaint();
          scheduleReconnect();
        });
      });
      peer.on("error", function (err) {
        syncError = err.type || err.message || String(err);
        syncStatus = "blad";
        if (typeof repaint === "function") repaint();
        reject(err);
      });
    });
  }

  function sendToggle(playerId, idx) {
    if (hostConn && hostConn.open) {
      hostConn.send({ type: "toggle", playerId: playerId, idx: idx });
      return true;
    }
    // Host (admin) clicking as spectator shouldn't mark; players on host device:
    if (peer && !hostConn && applyToggle(playerId, idx)) {
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
    if (syncError) return el("p", { class: "error" }, ["Sync: " + syncError]);
    let label = "Brak pokoju";
    if (roomCode) {
      if (syncStatus.indexOf("host") === 0) label = "Host " + roomCode + " · " + syncStatus;
      else if (syncStatus === "polaczono") label = "Polaczono z " + roomCode;
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
    if (roomCode && (playerRole === 1 || playerRole === 2 || playerRole === 9)) {
      kids.push(
        el("button", {
          class: "primary",
          type: "button",
          onClick: function () {
            if (playerRole === 9) go("#/admin/" + roomCode);
            else go("#/p" + playerRole + "/" + roomCode);
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
        "Wpisz kod od prowadzacego i wybierz gracza. Admin: #/admin",
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

    function paint() {
      status.replaceChildren(syncBadge());
      codeBox.replaceChildren(
        el("div", { class: "code-big" }, [roomCode || "----"]),
        el("p", { class: "hint" }, [
          "Na telefonach: ten sam link + kod, albo ",
          "#/p1/" + (roomCode || "KOD"),
        ])
      );
      summary.replaceChildren();
      boardWrap.replaceChildren();
      if (!game) {
        summary.appendChild(el("p", { class: "status-muted" }, ["Brak aktywnej gry."]));
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
      if (game.winnerId) {
        const w = game.players[game.winnerId];
        summary.appendChild(
          el("p", { class: "winner" }, ["Bingo! Wygrywa " + ((w && w.nick) || "gracz") + "."])
        );
      }
      const board = el("div", { class: "board" });
      board.style.gridTemplateColumns = "repeat(" + SIZE + ", minmax(0, 1fr))";
      const win1 = game.winnerId === 1 ? lineCells(game.players[1].done) : {};
      const win2 = game.winnerId === 2 ? lineCells(game.players[2].done) : {};
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
        game = newGame({
          1: nick1.value.trim() || LABELS[1],
          2: nick2.value.trim() || LABELS[2],
        });
      } catch (err) {
        busy = false;
        showErr(err.message || String(err));
        return;
      }
      setRoom(code);
      setRole(9);
      saveGameCache();
      history.replaceState(null, "", "#/admin/" + code);
      paint();
      startHost(code)
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
      if (!game && !roomCode) return;
      if (!confirm("Zresetowac gre u wszystkich?")) return;
      game = null;
      broadcastState();
      destroyPeer();
      clearSession();
      history.replaceState(null, "", "#/admin");
      paint();
    }

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
        el("p", { class: "lead" }, ["Laptop = host. Telefony lacza sie kodem."]),
        status,
        codeBox,
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

    if (roomCode && syncStatus === "offline") {
      ensureAdminHost();
    }

    return paint;
  }

  function renderPlayer(id) {
    const title = el("strong", null, [LABELS[id]]);
    const linesEl = el("span", { class: "muted" }, [""]);
    const status = el("div");
    const winner = el("p", { class: "winner hidden" });
    const empty = el("p", { class: "status-muted" }, [
      "Brak gry albo brak polaczenia. Sprawdz kod i czy admin ma otwarty panel.",
    ]);
    const boardEl = el("div", { class: "board" });
    boardEl.style.gridTemplateColumns = "repeat(" + SIZE + ", minmax(0, 1fr))";

    function toggle(idx) {
      if (!game || game.winnerId) return;
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
        winner.classList.add("hidden");
        linesEl.textContent = "";
        title.textContent = LABELS[id];
        return;
      }
      empty.classList.add("hidden");
      boardEl.classList.remove("hidden");
      const p = game.players[id];
      title.textContent = p.nick || LABELS[id];
      linesEl.textContent = " - " + countLines(p.done) + " lin.";
      const winSet = game.winnerId === id ? lineCells(p.done) : {};
      if (game.winnerId) {
        const w = game.players[game.winnerId];
        winner.classList.remove("hidden");
        winner.textContent =
          game.winnerId === id
            ? "Bingo! Wygrywasz, " + w.nick + "."
            : "Bingo! Wygrywa " + w.nick + ".";
      } else {
        winner.classList.add("hidden");
      }
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
              disabled: !!game.winnerId,
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
        winner,
        empty,
        boardEl,
      ])
    );
    paint();

    if (roomCode && (syncStatus === "offline" || syncStatus === "rozlaczono" || syncStatus === "blad")) {
      ensurePlayerConnection();
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
