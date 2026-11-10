# Changelog

All notable changes to CliFleet are documented here. CliFleet was called **OpenCodex** before v0.6.0.

## [Unreleased]

## [0.7.0] — 2026-11-10

The "actually pleasant to use every day" release: CliFleet now tells you which tab is
waiting for you, remembers your layout, and has real keyboard shortcuts.

### Added

- **Unread and bell indicators per tab.** Output in a background tab lights a small dot;
  a terminal bell lights a red dot and, when the window is not focused, asks the OS for
  attention (dock bounce / taskbar flash). Switching to the tab clears it.
- **Tab layout persistence.** Each project remembers how many tabs you had open and which
  one was active (up to 8), and restores it on next launch. Closing every tab on purpose
  is treated as "start clean next time" and clears the record.
- **Application shortcuts.** macOS: `⌘T` / `⌘W` / `⌘⇧[` `⌘⇧]` / `⌘1…9`.
  Windows and Linux: `Ctrl+Shift+T` / `Ctrl+Shift+W` / `Ctrl+Tab` / `Ctrl+Shift+Tab` / `Ctrl+1…9`.
  Keys that belong to the shell (`Ctrl+T`, `Ctrl+W`, `⌘C`, `Ctrl+Shift+C`, …) are untouched,
  and shortcuts step aside while you type in an inline input.

### Changed

- Home page and `/compare` are now indexable: JSON-LD (`SoftwareApplication`, `FAQPage`),
  canonical, `hreflang` (en / zh-CN), Open Graph and Twitter cards, `robots.txt` (AI crawlers
  explicitly allowed) and `sitemap.xml`.
- New bilingual `/compare` page: CliFleet vs cmux, Conductor, Claude Squad, Emdash — including
  including the places where CliFleet is deliberately the weaker choice.

### Fixed

- CI now runs on pushes to `main` and every `feat/**` branch. It previously only listened on
  `feat/minimal-terminal`, so the trunk had no gate at all.
- Chinese/English mixed text no longer overlaps in the terminal: the font stack now names
  explicit half-width fallbacks and a CJK fallback instead of relying on `ui-monospace`.
- Clipboard image pastes no longer accumulate PNGs in the temp directory forever (>24h swept).
- Importing project folders from U-King and DSH is now one command (`import_workspaces`) and
  tolerates unknown DSH schemas instead of failing.

## [0.6.1] — 2026-10-27

### Fixed

- Windows: the kill-test self-check no longer runs on Unix runners (it tore down the CI agent
  when it killed a session).

## [0.6.0] — 2026-10-25

### Added

- One-click desktop shortcut (works for the portable build too); the installer now creates
  desktop and start-menu entries.

### Fixed

- Cross-platform P0s: process-tree kill on Unix, per-platform key handling, macOS ad-hoc
  signing and UTF-8 locale, `SHELL` fallback, headless self-test in CI.

### Changed

- Renamed from OpenCodex to CliFleet. `~/.opencodex` is migrated to `~/.clifleet` on first launch.

## [0.5.1] — 2026-10-20

### Fixed

- Terminal crash residue (stray mouse reporting, alternate screen, hidden cursor) can be reset
  without killing the shell.
