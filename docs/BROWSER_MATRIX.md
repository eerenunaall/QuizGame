# Browser and device matrix

What the build targets, what has actually been run, and what is still to do by hand. **Only one engine
(Chromium, via Playwright 1.56 in the build sandbox) has ever run this app.** Nothing else is a claim; every
other row is a target waiting for a device pass.

## 1. Build targets (from `apps/web/vite.config.ts`, ADR-0004)

One ES-module bundle (`build.target: es2019`), polyfilled by core-js for the declared engines:
Chrome 63+, Safari 12+, iOS 12+, Edge 79+, Firefox 67+. Browsers without ES-module support get a plain "unsupported
browser" notice from `public/unsupported.js` (a `nomodule` script) instead of a blank page. There is no legacy
SystemJS bundle (it cannot satisfy the strict CSP). Fonts, art and sound are self-hosted or synthesised; no third-party requests.

Size budget (ADR-0004 measurement, gzip): TV path about 155 kB of JavaScript against a 180 kB budget; polyfills 44 kB (a
narrower target would shrink this: decide after the TV pass).

## 2. What has been run

| Surface | Engine | Evidence | Result |
|---|---|---|---|
| TV page `/tv`, 1920x1080 | Chromium (sandbox build, Playwright 1.56.x) | `tests/e2e/*.spec.ts` (17 tests, TV + 3 phones, reloads, drops, QR decode, remote-key navigation, every power, report-to-console loop, TV unlock) | passes in CI and locally |
| Phone controller, 390x844 | same Chromium with the phone context | same suite | passes |
| Admin console | same Chromium | `admin.spec.ts` | passes |
| Headers/CSP/caching of the served app | Node HTTP client | ws `static.test.ts`, `static-admin.test.ts` | passes |
| Native app | none in the sandbox (no Xcode/Android SDK) | Jest only; `docs/MOBILE.md` | device pass is the owner's |

## 3. Not run (owner device pass)

For each row: open the TV page and the phone page, play one full game (join by QR, answer, 50/50, Double Down, sabotage, reveal, results,
rematch), reload mid-question on both, then fill the table.

| Device / browser | Role | Needs | Tested by / date | Result |
|---|---|---|---|---|
| iPhone, Safari (current iOS) | phone | iPhone | | |
| iPhone, Safari iOS 15 or older | phone | old iPhone | | |
| Android phone, Chrome | phone | Android phone | | |
| Android phone, Samsung Internet | phone | Samsung phone | | |
| Android phone, Firefox | phone | | | |
| Desktop Safari | TV/phone | Mac | | |
| Desktop Firefox | TV/phone | | | |
| Desktop Edge | TV/phone | Windows | | |
| Samsung Tizen TV browser (note the model year) | TV | the TV | | |
| LG webOS TV browser | TV | the TV | | |
| Android TV / Google TV Chrome | TV | | | |
| Amazon Fire TV (Silk) | TV | | | |
| Apple TV (no browser): AirPlay/mirror from a phone or Mac | TV | | | |
| Game console browsers (PlayStation, Xbox) | TV | the console | | |
| Chromecast with Google TV, cast tab from Chrome | TV | | | |

Things that go wrong on TVs and are worth looking for: the QR not being large enough to scan from the sofa, text clipped by overscan, sound
not starting until a remote key is pressed (audio is unlocked by a first-run "press OK" gate), slow animation (the app picks a low-motion
mode from user-agent hints and honours `?perf=low`), remote keys not reaching the focused button, fullscreen refused.

## 4. Viewports (sandbox, Chromium)

1920x1080 is the TV stage (screens are authored on a fixed 1920x1080 stage scaled with one CSS transform). 1280x720 and 3840x2160 screenshots are
planned in ADR-0004 but are not part of the e2e suite today; scaling is by transform, so they are expected to work, **unverified**.

## 5. Support statement you may publish only after the pass

Put the browsers/TVs from section 3 whose Result is "ok" on the support page; anything not tested stays "not guaranteed". The server does not
block any browser by user agent.
