# NEON RIVALS 🏎️

**Two-Player Battle Racing** — a two-player local multiplayer arcade racing game. Two drivers share one keyboard, race a glowing neon circuit, grab power-ups, and sabotage each other on the way to the finish line.

### ▶️ [Play Online](https://inbarsharabi-dev.github.io/neon-rivals/)

No install, no sign-up — it runs entirely in your browser.

---

## Features

- **Same-keyboard multiplayer** — both players race at once on a single screen, with the whole circuit always in view.
- **Arcade drift physics** — acceleration, braking, reversing, friction, and sideways slip that lets cars drift through corners.
- **Collisions** — cars bounce off each other, the track walls, and the pylons placed around the circuit.
- **Five power-ups** — Turbo, Oil Slick, Rocket, Shield, and Reverse Controls, picked up from the glowing **?** boxes.
- **Fair lap counting** — six checkpoints per lap must be passed in order, so cutting back over the finish line earns nothing. A "WRONG WAY!" warning appears if you drive backwards.
- **Live HUD** — lap counter, race position (1st / 2nd), held power-up, status effects, and a race timer.
- **Full race flow** — animated 3-2-1-GO countdown, a "FINAL LAP" banner, and a victory screen with fireworks, confetti, race time, and each player's best lap.
- **Rematch without reloading** — Rematch, Restart, Pause, and Main Menu are all available in-game.
- **Neon visuals** — glowing track edges, car light trails, headlight beams, drift smoke, skid marks, sparks, explosions, and screen shake.
- **Synthesised sound** — engine notes and every sound effect are generated with the Web Audio API, with a mute toggle that is remembered between sessions.
- **Attract mode** — autopilot cars race behind the main menu.
- **Responsive** — the game scales to fit the browser window.
- **Fully offline** — no server, no external assets, no dependencies.

## How to Play

Be the first to complete **3 laps**. Drive through a **?** box to collect a power-up (you can hold one at a time), then fire it at the right moment.

| Action | Player 1 (pink) | Player 2 (blue) |
| --- | --- | --- |
| Accelerate | `W` | `↑` |
| Brake / reverse | `S` | `↓` |
| Steer | `A` / `D` | `←` / `→` |
| Use power-up | `Left Shift` or `Q` | `Enter` |

| Shared keys | |
| --- | --- |
| Pause / resume | `P` or `Esc` |
| Mute / unmute | `M` |

Pause, Restart, and Mute buttons are also available at the top of the screen during a race. The game pauses automatically if the window loses focus.

> **Tip for Player 1 on Windows:** tapping `Shift` five times in a row opens the Sticky Keys prompt. Use `Q` instead if that gets in the way.

## Power-Ups

| | Power-up | Effect |
| --- | --- | --- |
| ⚡ | **Turbo** | An instant kick forward plus stronger acceleration for about 2 seconds. |
| 🛢️ | **Oil Slick** | Drops a slick behind your car. Whoever drives over it loses grip and steering control for about 1.5 seconds — including you, once it has armed. Up to 8 slicks can be on the track at once. |
| 🚀 | **Rocket** | Fires a homing missile at your rival. A hit spins them out for a second, kills most of their speed, and cancels their turbo. |
| 🛡️ | **Shield** | Blocks the next attack (rocket, oil slick, or reverse controls). Lasts up to 12 seconds and blinks before it expires. |
| 🔄 | **Reverse Controls** | Flips your rival's left and right steering for 4.5 seconds. |

Power-up boxes respawn 4 seconds after being collected, and the power-up you get is random.

## Tech Stack

- **HTML5** — page structure and the `<canvas>` element
- **CSS3** — menus, HUD, and animations
- **Vanilla JavaScript** — game logic, physics, and rendering, driven by `requestAnimationFrame` with a fixed-step simulation
- **Canvas 2D API** — all in-game graphics
- **Web Audio API** — all sound, synthesised at runtime
- **GitHub Pages** — hosting

No frameworks, libraries, build tools, or asset files.

## Run Locally

```bash
git clone https://github.com/inbarsharabi-dev/neon-rivals.git
cd neon-rivals
```

Then open `index.html` in any modern browser. No server or build step is needed.

## Project Structure

```
├── index.html   # Page layout, HUD, menus, and overlays
├── style.css    # Neon styling and UI animations
└── game.js      # Track, physics, power-ups, rendering, audio, and input
```

## About

NEON RIVALS was developed as part of an **Agentic Programming** university lab, built with [Claude Code](https://claude.com/claude-code). The workflow:

1. **Defining requirements** — we wrote a specification covering gameplay, controls, power-ups, visual style, architecture, and acceptance criteria.
2. **Generating the game** — Claude Code built the full project (`index.html`, `style.css`, `game.js`) from that specification.
3. **Reviewing agent actions** — we followed the agent's steps and reviewed its output and reported deviations from the specification.
4. **Automated testing** — the agent ran the game in headless Chrome with scripted drivers and simulated key presses, checking lap counting, checkpoint order, wall collisions, win detection, and all five power-ups.
5. **Initial manual testing** — we launched the game in a browser, explored the gameplay, and identified issues for future improvement. Further testing and fixes are planned.
