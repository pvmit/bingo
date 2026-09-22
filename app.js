(() => {
  const SIZE = 5;
  const NEED = SIZE * SIZE;
  const STORE_KEY = "bingo.v1";
  const COLORS = { 1: "#e23d4a", 2: "#5b8cff" };
  const LABELS = { 1: "Gracz 1", 2: "Gracz 2" };

  const app = document.getElementById("app");

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
    if (pool.length < NEED) {
      throw new Error(`Za mało celów w goals.js (potrzeba ${NEED}).`);
    }
    const rand = mulberry32(hashSeed(seedStr));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, NEED);
  }

  function countLines(done) {
    const at = (r, c) => !!done[r * SIZE + c];
    let lines = 0;
    for (let r = 0; r < SIZE; r++) {
      let ok = true;
      for (let c = 0; c < SIZE; c++) if (!at(r, c)) { ok = false; break; }
      if (ok) lines++;
    }
    for (let c = 0; c < SIZE; c++) {
      let ok = true;
      for (let r = 0; r < SIZE; r++) if (!at(r, c)) { ok = false; break; }
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
    const marked = new Set();
    const at = (r, c) => !!done[r * SIZE + c];
    for (let r = 0; r < SIZE; r++) {
      let ok = true;
      for (let c = 0; c < SIZE; c++) if (!at(r, c)) { ok = false; break; }
      if (ok) for (let c = 0; c < SIZE; c++) marked.add(r * SIZE + c);
    }
    for (let c = 0; c < SIZE; c++) {
      let ok = true;
      for (let r = 0; r < SIZE; r++) if (!at(r, c)) { ok = false; break; }
      if (ok) for (let r = 0; r < SIZE; r++) marked.add(r * SIZE + c);
    }
    let d1 = true;
    let d2 = true;
    for (let i = 0; i < SIZE; i++) {
      if (!at(i, i)) d1 = false;
      if (!at(i, SIZE - 1 - i)) d2 = false;
    }
    if (d1) for (let i = 0; i < SIZE; i++) marked.add(i * SIZE + i);
    if (d2) for (let i = 0; i < SIZE; i++) marked.add(i * SIZE + (SIZE - 1 - i));
    return marked;
  }

  function emptyDone() {
    return {};
  }

  function newGame(nicks) {
    const seed = `bingo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      seed,
      board: pickBoard(seed),
      players: {
        1: { nick: nicks[1] || LABELS[1], done: emptyDone() },
        2: { nick: nicks[2] || LABELS[2], done: emptyDone() },
      },
      winnerId: null,
      updatedAt: Date.now(),
    };
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const g = JSON.parse(raw);
      if (!g || !Array.isArray(g.board) || g.board.length !== NEED) return null;
      if (!g.players || !g.players[1] || !g.players[2]) return null;
      return g;
    } catch (_) {
      return null;
    }
  }

  function saveGame(g) {
    g.updatedAt = Date.now();
    localStorage.setItem(STORE_KEY, JSON.stringify(g));
    try {
      channel.postMessage({ type: "sync", at: g.updatedAt });
    } catch (_) { /* ignore */ }
  }

  const channel = ("BroadcastChannel" in window)
    ? new BroadcastChannel("bingo.v1")
    : { postMessage() {}, close() {} };

  function route() {
    const h = (location.hash || "#/").replace(/^#/, "") || "/";
    if (h === "/admin") return { view: "admin" };
    if (h === "/p1" || h === "/player/1") return { view: "player", id: 1 };
    if (h === "/p2" || h === "/player/2") return { view: "player", id: 2 };
    return { view: "home" };
  }

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
      });
    }
    (kids || []).forEach((c) => {
      if (c == null || c === false) return;
      node.append(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function go(hash) {
    location.hash = hash;
  }

  function renderHome() {
    const g = loadGame();
    app.replaceChildren(
      el("section", { class: "screen home" }, [
        el("h1", {}, ["BINGO"]),
        el("p", { class: "lead" }, ["Wybierz rolę tego urządzenia"]),
        g
          ? el("p", { class: "status-ok" }, ["Gra aktywna · 5×5"])
          : el("p", { class: "status-muted" }, ["Brak gry — admin uruchamia nową"]),
        el("div", { class: "role-grid" }, [
          el("button", { class: "role p1", onClick: () => go("#/p1") }, ["GRACZ 1"]),
          el("button", { class: "role p2", onClick: () => go("#/p2") }, ["GRACZ 2"]),
          el("button", { class: "role admin", onClick: () => go("#/admin") }, ["ADMINISTRATOR"]),
        ]),
      ])
    );
  }

  function renderAdmin() {
    let g = loadGame();
    const nick1 = el("input", {
      type: "text",
      maxlength: "16",
      value: g?.players[1]?.nick || LABELS[1],
      placeholder: "Gracz 1",
    });
    const nick2 = el("input", {
      type: "text",
      maxlength: "16",
      value: g?.players[2]?.nick || LABELS[2],
      placeholder: "Gracz 2",
    });
    const error = el("p", { class: "error hidden" });
    const boardWrap = el("div", { class: "admin-boards" });
    const summary = el("div", { class: "admin-summary" });

    function paint() {
      g = loadGame();
      summary.replaceChildren();
      boardWrap.replaceChildren();
      if (!g) {
        summary.append(el("p", { class: "status-muted" }, ["Brak aktywnej gry."]));
        return;
      }
      [1, 2].forEach((id) => {
        const p = g.players[id];
        const lines = countLines(p.done);
        summary.append(
          el("div", { class: `sum-card p${id}` }, [
            el("strong", {}, [p.nick]),
            el("span", {}, [`${lines} lin.`]),
            el("span", { class: "muted" }, [
              `${Object.keys(p.done).filter((k) => p.done[k]).length}/${NEED}`,
            ]),
          ])
        );
      });
      if (g.winnerId) {
        const w = g.players[g.winnerId];
        summary.append(
          el("p", { class: "winner" }, [`Bingo! Wygrywa ${w?.nick || "gracz"}.`])
        );
      }

      // One shared board with both colors
      const board = el("div", { class: "board admin-board" });
      board.style.gridTemplateColumns = `repeat(${SIZE}, minmax(0, 1fr))`;
      const win1 = g.winnerId === 1 ? lineCells(g.players[1].done) : new Set();
      const win2 = g.winnerId === 2 ? lineCells(g.players[2].done) : new Set();
      g.board.forEach((text, idx) => {
        const d1 = !!g.players[1].done[idx];
        const d2 = !!g.players[2].done[idx];
        const cell = el("div", { class: "cell readonly" }, [text]);
        if (d1) cell.classList.add("done-p1");
        if (d2) cell.classList.add("done-p2");
        if (win1.has(idx) || win2.has(idx)) cell.classList.add("line-win");
        const marks = el("span", { class: "cell-marks" });
        if (d1) marks.append(el("i", { style: `background:${COLORS[1]}` }));
        if (d2) marks.append(el("i", { style: `background:${COLORS[2]}` }));
        if (marks.childNodes.length) cell.append(marks);
        board.append(cell);
      });
      boardWrap.append(board);
    }

    function startNew() {
      error.classList.add("hidden");
      try {
        g = newGame({ 1: nick1.value.trim() || LABELS[1], 2: nick2.value.trim() || LABELS[2] });
        saveGame(g);
        paint();
      } catch (err) {
        error.textContent = err.message || String(err);
        error.classList.remove("hidden");
      }
    }

    function resetGame() {
      if (!g && !loadGame()) return;
      if (!confirm("Zresetować grę? Plansza i postępy znikną.")) return;
      localStorage.removeItem(STORE_KEY);
      g = null;
      paint();
    }

    app.replaceChildren(
      el("section", { class: "screen admin" }, [
        el("div", { class: "topbar" }, [
          el("button", { class: "ghost small", onClick: () => go("#/") }, ["← Menu"]),
          el("strong", {}, ["ADMIN"]),
        ]),
        el("h1", { class: "admin-title" }, ["BINGO"]),
        el("p", { class: "lead" }, ["Plansza zawsze 5×5 · podgląd obu graczy"]),
        el("div", { class: "admin-nicks" }, [
          el("label", { class: "field" }, [
            el("span", {}, ["Gracz 1"]),
            nick1,
          ]),
          el("label", { class: "field" }, [
            el("span", {}, ["Gracz 2"]),
            nick2,
          ]),
        ]),
        el("div", { class: "admin-actions" }, [
          el("button", { class: "primary", onClick: startNew }, ["Nowa gra"]),
          el("button", { class: "danger", onClick: resetGame }, ["Reset gry"]),
        ]),
        error,
        summary,
        boardWrap,
      ])
    );
    paint();
    return paint;
  }

  function renderPlayer(id) {
    const other = id === 1 ? 2 : 1;
    let g = loadGame();

    const title = el("strong", {}, [LABELS[id]]);
    const linesEl = el("span", { class: "muted" }, [""]);
    const winner = el("p", { class: "winner hidden" });
    const boardEl = el("div", { class: "board" });
    boardEl.style.gridTemplateColumns = `repeat(${SIZE}, minmax(0, 1fr))`;
    const empty = el("p", { class: "status-muted" }, [
      "Brak gry. Poczekaj, aż admin kliknie „Nowa gra”.",
    ]);

    function toggle(idx) {
      g = loadGame();
      if (!g || g.winnerId) return;
      const p = g.players[id];
      if (p.done[idx]) delete p.done[idx];
      else p.done[idx] = true;
      if (countLines(p.done) >= 1) g.winnerId = id;
      saveGame(g);
      paint();
    }

    function paint() {
      g = loadGame();
      boardEl.replaceChildren();
      if (!g) {
        empty.classList.remove("hidden");
        boardEl.classList.add("hidden");
        winner.classList.add("hidden");
        linesEl.textContent = "";
        title.textContent = LABELS[id];
        return;
      }
      empty.classList.add("hidden");
      boardEl.classList.remove("hidden");
      const p = g.players[id];
      const o = g.players[other];
      title.textContent = p.nick || LABELS[id];
      const lines = countLines(p.done);
      linesEl.textContent = `· ${lines} lin.`;
      const winSet = g.winnerId === id ? lineCells(p.done) : new Set();

      if (g.winnerId) {
        const w = g.players[g.winnerId];
        winner.classList.remove("hidden");
        winner.textContent =
          g.winnerId === id
            ? `Bingo! Wygrywasz, ${w.nick}.`
            : `Bingo! Wygrywa ${w.nick}.`;
      } else {
        winner.classList.add("hidden");
      }

      g.board.forEach((text, idx) => {
        const mine = !!p.done[idx];
        const theirs = !!o.done[idx];
        const btn = el("button", {
          type: "button",
          class: `cell${mine ? " done" : ""}${winSet.has(idx) ? " line-win" : ""}`,
          disabled: !!g.winnerId,
          onClick: () => toggle(idx),
        }, [text]);
        if (theirs) {
          const marks = el("span", { class: "cell-marks" }, [
            el("i", { style: `background:${COLORS[other]}` }),
          ]);
          btn.append(marks);
        }
        boardEl.append(btn);
      });
    }

    app.replaceChildren(
      el("section", { class: "screen player" }, [
        el("div", { class: "topbar" }, [
          el("button", { class: "ghost small", onClick: () => go("#/") }, ["← Menu"]),
          el("div", {}, [
            title,
            linesEl,
          ]),
          el("span", {
            class: "badge",
            style: `background:${COLORS[id]}`,
          }, [`P${id}`]),
        ]),
        winner,
        empty,
        boardEl,
      ])
    );
    paint();
    return paint;
  }

  let repaint = null;

  function mount() {
    const r = route();
    if (r.view === "admin") repaint = renderAdmin();
    else if (r.view === "player") repaint = renderPlayer(r.id);
    else {
      repaint = null;
      renderHome();
    }
  }

  window.addEventListener("hashchange", mount);
  window.addEventListener("storage", (e) => {
    if (e.key === STORE_KEY && typeof repaint === "function") repaint();
  });
  channel.onmessage = () => {
    if (typeof repaint === "function") repaint();
  };

  mount();
})();
