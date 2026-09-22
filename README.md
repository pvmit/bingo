# Bingo

Proste bingo 5x5 — jak Conquest: **menu rol**, osobne panele.

## Role

| Link | Rola |
|------|------|
| `#/` | Menu |
| `#/admin` | Administrator — nowa gra, reset, podglad obu |
| `#/p1` | Gracz 1 |
| `#/p2` | Gracz 2 |

Plansza zawsze **5x5**. Cele z [`goals.js`](goals.js).

## Jak grac

1. Laptop: **Administrator** → nicki → **Nowa gra**.
2. Dwie karty / urzadzenia: **Gracz 1** i **Gracz 2**.
3. Kazdy odhacza cele swoim kolorem. Pierwsza linia wygrywa.

Stan w `localStorage` + BroadcastChannel (sync miedzy kartami **tej samej** przegladarki / profilu). Bez Firebase.

Jesli widzisz stara strone z „Rozmiar planszy” — **Ctrl+F5**.

## Edycja puli

```js
// goals.js
window.GOALS = [ "…", "…" ]; // min. 25 pozycji
```

## Adres

https://pvmit.github.io/bingo/
