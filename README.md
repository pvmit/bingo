# Bingo

Bingo 5×5 na **3 urządzenia** (admin + 2 graczy). Sync przez **PeerJS** (WebRTC) — bez Firebase / bez konta.

## Jak grac

1. **Laptop (admin):** otwórz [pvmit.github.io/bingo](https://pvmit.github.io/bingo/) → **ADMINISTRATOR** → **Nowa gra**.
2. Pojawi się **kod pokoju** (np. `K7MP`). Laptop musi zostać otwarty (to host).
3. **Telefon 1:** ten sam URL → wpisz kod → **GRACZ 1** (albo od razu `#/p1/K7MP`).
4. **Telefon 2:** `#/p2/K7MP`.
5. Kliknięcia synchronizują się na żywo.

## Role

| Link | Rola |
|------|------|
| `#/` | Menu + pole kodu |
| `#/admin` | Host: nowa gra, reset, podglad |
| `#/p1/KOD` | Gracz 1 |
| `#/p2/KOD` | Gracz 2 |

Plansza zawsze **5×5**. Cele: [`goals.js`](goals.js).

## Edycja puli

```js
window.GOALS = [ "…", "…" ]; // min. 25
```

## Uwagi

- Admin = host sieciowy; bez otwartego panelu admina telefony się nie połączą.
- Wymaga internetu (sygnalizacja PeerJS). Telefony i laptop w dowolnych sieciach.
