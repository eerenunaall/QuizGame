# ADR-0016: Localization and content language

Status: Accepted · Date: 2026-10-06

## Context
Launch language is Turkish (GDD header) but the brief's example error strings are English. Questions
are language-specific content; UI copy is a separate concern.

## Decision
- `packages/i18n`: typed catalogs `tr` (default, source of truth for copy) and `en`; a compile-time
  check requires identical key sets and placeholder names; `t(key, params)` with ICU-lite plural
  support (`{n, plural, one {…} other {…}}`) – Turkish has no grammatical plural after numerals, English does.
- Locale resolution: stored preference → `navigator.language` → `tr`. The room has `contentLanguage`
  (`tr` at launch); UI language is per device, so mixed-language rooms work.
- The protocol carries **codes and parameters, never prose**; the server never sends user-visible
  sentences except user-generated text (nicknames, statements, blind questions).
- Required copy from the brief is present in both languages: TV "Connection interrupted.
  Reconnecting…" / "BAĞLANTI KESİLDİ · YENİDEN BAĞLANILIYOR…", phone "Reconnecting…" / "Yeniden bağlanıyor…".
- Turkish typography rules: locale-aware upper/lower casing (`toLocaleUpperCase('tr')`) for any
  display-casing so `i → İ`; CSS `text-transform` is avoided for Turkish text; fonts include
  Latin-Extended.
- Dates/numbers via `Intl` with the active locale.

## Verification
Catalog parity test, casing tests (`istanbul → İSTANBUL`, `ISPARTA → ısparta`), E2E in both locales,
a lint rule banning hard-coded JSX text outside `i18n`.
