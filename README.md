# Bingo — jedna gra, sync, pula w jednym pliku

Proste bingo w stylu [lockout.live](https://lockout.live/) na **jedną aktywną grę**. Wspólna plansza, sync przez Firebase Realtime Database, cele losowane z pliku `goals.js`.

Live (po włączeniu Pages): `https://pvmit.github.io/bingo/`

## Jak grać

1. Jeden host: nick → wybierz rozmiar → **Nowa gra** → podaj kod reszcie.
2. Reszta: nick + kod → **Dołącz**.
3. Klikaj cele, które zaliczyłeś. Pierwsza pełna linia (wiersz / kolumna / przekątna) wygrywa.
4. Wielu graczy może mieć ten sam cel. Nowa gra nadpisuje poprzednią.

## Edycja puli celów

Jedyny plik treści: **`goals.js`**.

```js
window.GOALS = [
  "Zrób 20 przysiadów",
  "Wymień 5 punktów Prawa Harcerskiego",
];
```

Potrzebujesz co najmniej `rozmiar × rozmiar` unikalnych pozycji (dla 5×5 → min. 25).

## Setup Firebase (jednorazowo)

1. Wejdź na [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. **Build → Realtime Database → Create Database** (np. `europe-west1`). Na start: tryb testowy albo wklej reguły z `database.rules.json`.
3. **Project settings → Your apps → Web** → skopiuj config.
4. Wklej wartości do `firebase-config.js` (zastąp wszystkie `REPLACE_ME`).
5. W RTDB → **Rules** wklej zawartość `database.rules.json` i Publish.

Bez uzupełnionego configu lobby pokaże komunikat i zablokuje przyciski.

## Lokalnie

Otwórz `index.html` przez prosty serwer HTTP (Firebase i przeglądarka lubią `http://`, nie zawsze `file://`):

```bash
npx --yes serve .
```

## GitHub Pages

1. Repo: `pvmit/bingo` (lub własne).
2. **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**.
3. Strona: `https://<user>.github.io/bingo/`.

## Pliki

| Plik | Rola |
|------|------|
| `goals.js` | Pula celów |
| `firebase-config.js` | Publiczny config Firebase |
| `database.rules.json` | Reguły RTDB (`/game` read/write) |
| `index.html` / `style.css` / `app.js` | UI i logika |
