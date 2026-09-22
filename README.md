# Bingo

Bingo 5×5 na **3 urządzenia** (admin + 2 graczy). Sync przez **PeerJS** (WebRTC) — bez Firebase / bez konta.

## Jak grac

1. **Laptop:** otwórz [pvmit.github.io/bingo/#/admin](https://pvmit.github.io/bingo/#/admin) → **Nowa gra**.
2. Pojawi się **kod pokoju**. Poczekaj, aż **oba telefony** wejdą do gry (raz pobiorą planszę).
3. **Telefon 1:** [pvmit.github.io/bingo](https://pvmit.github.io/bingo/) → wpisz kod → **Gracz 1**.
4. **Telefon 2:** kod → **Gracz 2**.
5. Potem **laptop możesz zamknąć** — jeden z telefonów przejmuje hosta, gracze grają dalej.

## Role

| Link | Rola |
|------|------|
| `#/` | Menu graczy + kod |
| `#/admin` | Start / podgląd (tylko linkiem) |
| `#/p1/KOD` | Gracz 1 |
| `#/p2/KOD` | Gracz 2 |

Plansza zawsze **5×5**. Cele: [`goals.js`](goals.js).

## Edycja puli

```js
window.GOALS = [ "…", "…" ]; // min. 25
```

## Uwagi

- Hostem jest **kto aktualnie online** (admin albo telefon). Po wyjściu admina telefony same się dogadują.
- Oba telefony powinny **raz** połączyć się przy starcie (żeby mieć planszę), zanim zamkniesz laptopa.
- Wymaga internetu (sygnalizacja PeerJS).
