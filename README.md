# ECHO

**Survive the board as it fills with replays of your own past moves.**

ECHO is a minimalist, single-mechanic arcade game. You are one glowing cyan
tile on an 8×8 grid. Every move you make is recorded — and after a short delay,
translucent *echoes* of your past self begin retracing the exact path you
walked. More echoes spawn over time and the board tightens. Step onto any echo
and it's game over. The only goal: outlast yourself, one move at a time.

🎮 **Live:** https://perdido101.github.io/echo/

- **Desktop:** Arrow keys or WASD to move · `Space`/`Enter` to restart · `M` to mute
- **Mobile:** Swipe to move · tap to restart · installable as a PWA (works offline)

Colourblind-safe by design: the player and its echoes are distinguished by
**brightness and bloom**, not hue. The newest echo glows brightest; older ones
fade into a desaturated afterimage trail.

---

## How it plays

- Each input moves you **exactly one cell**. Moves into the outer wall are
  ignored (no wrap-around, no sliding).
- The **first echo** spawns after `ECHO_DELAY` moves at your original start cell
  and trails you forever, walking your recorded path.
- A **new echo** spawns every `ECHO_SPAWN_INTERVAL` moves; each gets a larger
  delay so multiple independent ghost-trails crawl the board at once.
- Every spawn shrinks the interval by 1 (down to `ECHO_SPAWN_FLOOR`), so the
  board steadily tightens. A rising two-note cue warns you on each spawn.
- **Scoring:** +1 per move survived. Your best score is saved locally; beat it
  and you'll see a **NEW BEST** flash.

### Collision order (why deaths feel fair)

Each "tick" resolves in a fixed, documented order:

1. Resolve the **player** move first (wall moves are ignored).
2. **Advance** every echo by replaying your historical move.
3. **Spawn** a new echo if one is due.
4. **Check overlap** — if you now share a cell with any echo, you die.
5. If you survived, award +1 point.

---

## Run locally

```bash
npm install
npm run dev      # local dev server with hot reload
npm run build    # production build into dist/
npm run preview  # preview the production build
```

Requires Node 18+. Built with **vanilla TypeScript + Vite + Canvas2D** — no game
frameworks, no external art or audio. Every visual is drawn on the canvas and
every sound is synthesized at runtime with the Web Audio API.

---

## Tuning

All gameplay constants live in one exported `CONFIG` object at the top of
[`src/main.ts`](src/main.ts), so you can tune the feel without hunting:

| Constant               | Default | What it does                                                            |
| ---------------------- | ------- | ----------------------------------------------------------------------- |
| `GRID_SIZE`            | `8`     | Board is `GRID_SIZE × GRID_SIZE` cells.                                  |
| `ECHO_DELAY`           | `5`     | Moves before the first echo spawns; it then trails you by this many moves. |
| `ECHO_SPAWN_INTERVAL`  | `12`    | Starting gap (in moves) between additional echo spawns.                  |
| `ECHO_SPAWN_FLOOR`     | `5`     | The spawn interval never shrinks below this.                            |
| `ECHO_INTERVAL_STEP`   | `1`     | How much the interval shrinks per spawn (difficulty ramp).              |
| `TWEEN_MS`             | `120`   | Tile move animation duration (ms), eased-out — never instant snapping.   |
| `ECHO_MAX_OPACITY`     | `0.6`   | Opacity of the newest (brightest) echo.                                 |
| `ECHO_FADE`            | `0.74`  | Each older echo multiplies opacity by this (the fading trail).          |
| `ECHO_MIN_OPACITY`     | `0.12`  | Floor so the oldest echoes stay faintly visible.                        |
| `TRAIL`                | `true`  | Faint motion-blur streak behind moving tiles.                          |

---

## Tech / deployment

- **PWA:** `manifest.json`, a service worker (`public/sw.js`) caching built
  assets for offline play, and an installable glowing-tile icon.
- **Deploy:** pushing to the deploy branch triggers
  [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds
  with Vite and publishes `dist/` to GitHub Pages via the official
  `actions/deploy-pages` flow. `vite.config.ts` sets `base: '/echo/'` so assets
  resolve correctly under the Pages sub-path.

## License

MIT
