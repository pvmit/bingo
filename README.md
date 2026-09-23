# Bingo

Bingo 5×5 na telefonach i laptopie. Sync przez **Supabase** (jak Conquest) — bez Firebase, bez PeerJS, bez lokalnego serwera.

## Jak grac

Wszyscy otwierają ten sam adres na GitHub Pages:

- **2 graczy (wspólna plansza):** [pvmit.github.io/bingo](https://pvmit.github.io/bingo/)
- **Klasyczne (własna plansza, admin odznacza):** [pvmit.github.io/bingo/klasyczne.html](https://pvmit.github.io/bingo/klasyczne.html)

1. Na laptopie wejdź w **ADMINISTRATOR** → **Nowa gra**. Pojawi się kod.
2. Telefony: ten sam link → wpisz kod → **Gracz 1 / Gracz 2** (albo pseudonim w klasycznym).
3. Laptop możesz zamknąć — stan gry jest w chmurze.

## Role (2 graczy)

| Link | Rola |
|------|------|
| `#/` | Menu |
| `#/admin` | Start / podgląd |
| `#/p1/KOD` | Gracz 1 |
| `#/p2/KOD` | Gracz 2 |

Plansza zawsze **5×5**. Cele: edycja w panelu admina przed startem (albo [`goals.js`](goals.js)).

Bingo **nie kończy gry** — linie są liczone i podświetlane, ale można grać dalej.

## Baza (raz, jak w Conquest)

W SQL Editorze projektu Supabase uruchom [`supabase/schema.sql`](supabase/schema.sql). Adres i klucz są w [`config.json`](config.json) — ten sam projekt co Conquest jest OK.

## Edycja puli

```js
window.GOALS = [ "…", "…" ]; // min. 25
```
