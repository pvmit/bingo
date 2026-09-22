# Bingo (lockout-lite)

Proste bingo jak [lockout.live](https://lockout.live/), ale na **jedną grę naraz**: wspólna plansza, sync między graczami, cele z jednego pliku.

## Jak grać

1. Uzupełnij Firebase (poniżej) i otwórz stronę.
2. Host: wpisz nick → wybierz rozmiar → **Nowa gra** → podaj kod innym.
3. Reszta: nick + kod → **Dołącz**.
4. Klikaj cele, które wykonałeś. Pierwsza ukończona linia (wiersz / kolumna / przekątna) wygrywa.

Wielu graczy może mieć ten sam cel (bez trybu Lockout).

## Edycja puli celów

Jedyny plik z treścią: **[`goals.js`](goals.js)**.

```js
window.GOALS = [
  "Zrób 20 przysiadów",
  "Wymień 5 punktów Prawa Harcerskiego",
  // ...
];
```

Na planszę `N×N` potrzeba co najmniej `N²` unikalnych pozycji w puli (dla 5×5 → min. 25).

## Firebase (wymagane do sync)

1. [Firebase Console](https://console.firebase.google.com/) → nowy projekt.
2. **Build → Realtime Database** → Create (np. `europe-west1`).
3. **Project settings → Your apps → Web** → skopiuj config do [`firebase-config.js`](firebase-config.js).
4. Reguły RTDB (na start, gra drużynowa):

```json
{
  "rules": {
    "game": {
      ".read": true,
      ".write": true
    }
  }
}
```

Bez uzupełnionego configu strona pokaże ostrzeżenie — sync nie ruszy.

## Lokalnie

Otwórz `index.html` przez lokalny serwer HTTP (Firebase / pliki ES nie wymagają, ale `file://` bywa kapryśny):

```bash
npx --yes serve .
```

## GitHub Pages

1. Repo na GitHubie (np. `pvmit/bingo`).
2. **Settings → Pages → Deploy from a branch** → `main` / `/ (root)`.
3. Adres: `https://<user>.github.io/bingo/`

## Pliki

| Plik | Rola |
|------|------|
| `goals.js` | Pula celów |
| `firebase-config.js` | Publiczny config Firebase |
| `index.html` | UI |
| `style.css` | Styl |
| `app.js` | Losowanie, sync, linie, zwycięzca |
