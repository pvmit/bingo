# Bingo (lockout-lite)

Proste bingo jak [lockout.live](https://lockout.live/), ale na **jedną grę naraz** — czysto lokalnie, jak `conk` (bez Firebase / konta).

## Jak grać

1. Otwórz stronę (Pages lub lokalnie).
2. Wpisz graczy po przecinku, wybierz rozmiar → **Nowa gra**.
3. Kliknij gracza na liście, żeby ustawić kto klika, potem odhaczaj cele.
4. Pierwsza ukończona linia (wiersz / kolumna / przekątna) wygrywa.
5. **Kopiuj link** — ten sam stan planszy można otworzyć na drugim urządzeniu (zapis w adresie URL).

## Edycja puli celów

Jedyny plik z treścią: **[`goals.js`](goals.js)**.

```js
window.GOALS = [
  "Zrób 20 przysiadów",
  "Wymień 5 punktów Prawa Harcerskiego",
  // ...
];
```

Na planszę `N×N` potrzeba co najmniej `N²` pozycji (dla 5×5 → min. 25).

## Lokalnie / Pages

Wystarczy otworzyć `index.html` albo:
https://pvmit.github.io/bingo/

## Pliki

| Plik | Rola |
|------|------|
| `goals.js` | Pula celów |
| `index.html` | UI |
| `style.css` | Styl |
| `app.js` | Losowanie, linie, zwycięzca, stan w URL |
