# Playtest guide / İlk oynanabilir test

What you need to play the game on a real TV and real phones, and what is honestly not covered yet.

## Hızlı başlangıç (Türkçe)

Aynı Wi-Fi'ye bağlı bir bilgisayar + bir TV (veya büyük ekran) + 2–8 telefon yeterli.

1. Bilgisayarda: `pnpm install` → `pnpm playtest`
   (PostgreSQL'i açar, migrasyonları uygular, 340 Türkçe soruyu yükler, web uygulamasını derler, sunucuyu başlatır.)
2. TV'nin tarayıcısında yazılan adresi açın: `http://<bilgisayarın-IP'si>:8080/tv` (tam ekran).
3. Telefonlarla TV'deki QR kodu okutun, takma ad seçin. Lider telefondan (veya TV'den) **Başlat**.
4. Telefonlar farklı ağdaysa: bir tünel açın (`cloudflared tunnel --url http://localhost:8080` gibi) ve
   `PUBLIC_WEB_URL=https://… pnpm playtest` ile başlatın; QR kod o adrese işaret eder.

Docker varsa: `docker compose -f infra/deployment/docker-compose.yml up --build`
(`PUBLIC_WEB_URL=http://<IP>:8080` verin). **Docker yolu bu ortamda doğrulanamadı** (Docker yok); ilk çalıştırmada
sorun çıkarsa `docker compose logs app` çıktısını paylaşın.

## English quick start

```
pnpm install
pnpm playtest          # db + migrations + 340-question development bank + 275-question cult demo bank (seed/demo) + web build + server on :8080
```

- TV: open `http://<this machine's LAN address>:8080/tv` in a browser, full screen.
- Phones: scan the QR code on the TV (same Wi-Fi), or open `/join`.
- `PORT`, `DATABASE_URL`, `PUBLIC_WEB_URL` (what the QR code points to; use a tunnel's https URL to play
  across networks) and `--rebuild` (rebuild the web app) are the only knobs.

`pnpm playtest` runs in **development mode with the development bank on**. Production refuses both
(`QP_ALLOW_DEV_SEED` must be 0), so nothing here can reach real players by accident.

## What a playtest exercises

- Lobby with QR, nicknames, avatars, leader hand-over, settings (rounds, difficulty, categories).
- The full game: prep (stakes, Double Down, sabotage), questions, 50/50, reveal with crowd shares, score
  updates, the final stage at double points, results and rematch.
- Reconnects: reload a phone or the TV mid-question; switch Wi-Fi off and on.
- Turkish and English UI (phone language follows the browser; TV settings dialog).

## Known limits of this first playtest

| Limit | Why | When |
|---|---|---|
| Free tier / purchases are not wired (every room is FULL in development) | accounts and receipts are M4 | M4 |
| Questions are the 340 hand-written development questions, not the 50 K audited bank | the audit pipeline needs a model API key and reviewers (`pnpm question …`) | continuous |
| Only the browser phone controller; the native app is not built | needs `eas build` with your accounts | M6 |
| Docker image untested here | no Docker daemon in the build sandbox | first run on your side |
| TV models/browsers not matrix-tested (Samsung/LG/Android TV) | needs the real devices | M7 |
| Sound is synthesized; no music tracks yet | licensing | M7 |

## Reporting what you find

Write down: the phase (lobby / prep / question / reveal / results), what you pressed, what you expected, and the
room code. The server keeps an append-only event log per room, so a bug can be replayed exactly.
