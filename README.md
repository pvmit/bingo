# Bingo

Proste bingo 5×5 — jak Conquest: **jedno menu ról**, osobne panele.

## Role

| Link | Rola |
|------|------|
| `#/` | Menu |
| `#/admin` | Administrator — nowa gra, reset, podgląd obu |
| `#/p1` | Gracz 1 |
| `#/p2` | Gracz 2 |

Plansza zawsze **5×5**. Cele z [`goals.js`](goals.js).

## Jak grać

1. Na laptopie otwórz **Administrator** → wpisz nicki → **Nowa gra**.
2. Na dwóch telefonach (lub kartach) wejdź w **Gracz 1** / **Gracz 2**.
3. Każdy odhacza swoje cele. Pierwsza linia wygrywa.

Stan trzyma się w `localStorage` (sync między kartami tej samej przeglądarki). Bez Firebase — jak tryb demo w Conquest.

## Edycja puli

```js
// goals.js
window.GOALS = [ "…", "…" ]; // min. 25 pozycji
```

## Adres

https://pvmit.github.io/bingo/
