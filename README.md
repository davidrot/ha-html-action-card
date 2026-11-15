# HTML Action Card

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![Release](https://img.shields.io/github/v/release/davidrot/ha-html-action-card?include_prereleases)](https://github.com/davidrot/ha-html-action-card/releases)
[![CI](https://github.com/davidrot/ha-html-action-card/actions/workflows/ci.yml/badge.svg)](https://github.com/davidrot/ha-html-action-card/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Status: alpha](https://img.shields.io/badge/status-alpha-red.svg)

A Home Assistant Lovelace card for **plain HTML and CSS**. Add states with `{{ }}`, conditions with `data-show-if`, and Home Assistant actions with `data-event` + `data-action`. Need more? Drop in a `<script>`.

<p align="center">
  <a href="showroom/kitchen-timer/"><img src="showroom/kitchen-timer/screenshot.png" alt="Kitchen timer card" height="240"></a>
  <a href="showroom/panda/"><img src="showroom/panda/screenshot.png" alt="Panda card that follows the cursor" height="240"></a>
  <a href="showroom/snake/"><img src="showroom/snake/screenshot.png" alt="Snake game card" height="240"></a>
  <a href="showroom/camera-control/"><img src="showroom/camera-control/screenshot.png" alt="Camera card with touch control" height="240"></a>
</p>

## Contents

- [Why](#why)
- [Installation](#installation)
- [Quick start](#quick-start)
- [The four building blocks](#the-four-building-blocks)
- [Scripts](#scripts)
- [Inputs](#inputs)
- [State](#state)
- [Security rating](#security-rating)
- [Showroom](#showroom)
  - [Kitchen timer](#kitchen-timer)
  - [Camera control](#camera-control)
  - [Panda](#panda)
  - [Snake](#snake)
- [Use with AI](#use-with-ai)
- [Roadmap](#roadmap)
- [Development](#development)
- [License](#license)

## Why

- **Design freedom.** Anything HTML and CSS can do, not only what a card author put into the options.
- **One card instead of ten.** Joystick, remote control, room tile, status bar: one card, one syntax.
- **AI writes HTML very well.** Describe the card in a sentence, paste the result ([prompt](docs/LLM-PROMPT.md)).
- **Web knowledge is enough.** If you know HTML and CSS there is nothing new to learn.
- **No JavaScript for the normal case.** States, conditions and actions are four small building blocks. Scripts are possible, not required.
- **Transparency instead of bans.** Nothing is blocked. A built-in security rating (🟢 🟡 🔴) tells you what your markup can do, so you decide.
- **Prototype without a build.** Try a design in minutes before you write a real card.

When you do not need it: when a standard card does the job. You maintain your own markup, and it only follows your theme if you use the Home Assistant color variables (`var(--primary-color)` …).

The whole card is one piece of HTML in `content`: markup, a `<style>` block, a `<script>` block if you want one. It is rendered inside a Shadow DOM, so your CSS stays inside the card.

## Installation

**HACS (custom repository):**
1. HACS → ⋮ → *Custom repositories*.
2. Repository: `https://github.com/davidrot/ha-html-action-card`, type: *Dashboard* (called *Lovelace* in older HACS versions).
3. Install **HTML Action Card**, then reload the browser.

**Manual:** download `html-action-card.js` from the [latest release](https://github.com/davidrot/ha-html-action-card/releases), copy it to `config/www/`, and add `/local/html-action-card.js` as a dashboard resource (type *JavaScript module*).

Then add a card: search for **HTML Action Card** in the card picker, or use YAML with `type: custom:html-action-card`.

## Quick start

```yaml
type: custom:html-action-card
content: |
  <style>
    .lamp { width: 24px; height: 24px; border-radius: 50%; background: gray; }
    .lamp.on { background: gold; }
  </style>
  <div class="lamp {{ light.kitchen.state }}"></div>
  <button data-event="tap" data-action="light.toggle" data-entity="light.kitchen">
    Kitchen: {{ light.kitchen.state }}
  </button>
  <p data-show-if="sensor.living_room_temp.state > 25">It's hot: {{ sensor.living_room_temp.state }}°C</p>
```

## The four building blocks

| Block | Job | Example |
|---|---|---|
| `data-event` | **When** (HTML side) | `tap` (default), `hold`, `dbltap`, `press`, `release` |
| `data-action` | **What** (Home Assistant side) | `light.turn_on`, `toggle`, `more-info`, `navigate`, `url` |
| `data-show-if` | **Visibility** by state | `data-show-if="light.kitchen.state == on"` |
| `{{ }}` | **Insert a value** | `{{ sensor.temp.state }}`, `{{ light.kitchen.attributes.brightness }}` |

Action helpers: `data-entity`, `data-data='{"brightness_pct":50}'`, `data-path` (navigate), `data-url` (+ `data-target`), `data-confirm="Sure?"`, `data-repeat="150"` (ms, with `press`), `data-delay="800"` (ms, with `hold`, default 500).

Elements with an action get `is-pending` while it runs, `is-error` if it fails (plus a Home Assistant toast), and `is-unavailable` (action blocked) while their `data-entity` is unavailable. `press` and `hold` set `touch-action: none` by default so touch scrolling does not cancel them.

Entities are written like Home Assistant's state objects, always with the property you want: `{{ light.kitchen.state }}`, `{{ light.kitchen.attributes.brightness }}`, `{{ light.kitchen.last_changed }}`. There is no default: a bare `{{ light.kitchen }}` renders nothing, and so does anything that cannot be resolved. The Jinja form `states.light.kitchen.state` is accepted too. Works in text and attribute values (`class="lamp {{ light.kitchen.state }}"`).

`{{ }}` and `data-show-if` share one expression language: comparisons, `&& || !`, arithmetic, `? :`, parentheses. Examples: `data-show-if="light.a.state == on && sensor.t.state > 20"`, `{{ sensor.t.state > 25 }}` (renders `true`/`false`), `{{ sensor.t.state * 2 }}`. Bare words like `on` are strings; numeric states compare as numbers. You can call functions: `{{ Math.round(sensor.t.state) }}`, or your own via `card.expose({ calc })` in a script: `{{ calc(1+2) > 3 }}`.

`now()` is reactive (ticks every second by default, `refresh_interval` to change), and `relative(date)` gives "5 min ago": `{{ relative(sensor.x.last_changed) }}`.

**HTML added later works too.** Elements your scripts insert with `innerHTML`/`appendChild` are picked up automatically (`{{ }}`, `data-show-if`, `data-action`).

**Updates are automatic.** The card tracks which entities each expression reads and re-evaluates only those when an entity changes; the DOM is touched only if the result changed. You never call render yourself.

Elements get `is-unavailable` and `is-error` classes when relevant. Missing entities never crash the card.

## Scripts

```html
<button id="up">Up</button>
<script>
  const b = document.getElementById('up');
  b.addEventListener('click',    () => card.call('button', 'press', { entity_id: 'button.cam_up' }));
  b.addEventListener('dblclick', () => card.navigate('/lovelace/cameras'));
  // re-runs automatically whenever an entity read inside changes
  card.effect(() => { b.textContent = card.state('light.kitchen') === 'on' ? 'Turn off' : 'Turn on'; });
</script>
```

Your HTML and JavaScript run **as written**, like on any web page. Because the card uses Shadow DOM, scripts receive a `document` shim that searches inside the card, plus `card` (`call`, `action`, `navigate`, `moreInfo`, `toggle`, `state`, `attr`, `effect`, `expose`, `onEntity`, `on`, `$`, `cleanup`, `input`, `store`) and `hass`. Scripts run once per render, before the first state is evaluated (so `card.expose` functions work in `{{ }}`). Multiple events on one element? Use a script.

Good to know:
- `hass` is live in classic scripts. `type="module"` scripts get `card` and `document` too (`hass` is a snapshot there, use `card.hass`).
- `<script src="https://…">` loads a real script tag into the page (CDN libraries like Chart.js); `type="module"` works too.
- Scripts run again whenever the card is rendered or re-attached by Home Assistant. Nothing piles up: `setTimeout`/`setInterval`/`requestAnimationFrame`, listeners on `window` and `document`, and Mutation/Resize/Intersection observers are released automatically when the card goes away. Use `card.cleanup(fn)` for anything else (WebSockets, subscriptions).
- `document.body` is the card's content, and `DOMContentLoaded` listeners run right away.
- Each script block is isolated. Share functions through `card.expose` or `window`.
- A failing script is reported in the console and the following scripts still run. Scripts added later with `innerHTML` do not run (browser rule).

## Inputs

A card can declare the entities and settings it needs in a frontmatter block at the top, like a Home Assistant blueprint. The card editor then shows a form instead of code: pick your entities, done. **Edit code** switches to the full content.

```html
---
name: Lamp switch
description: One button for one light.
author: you
inputs:
  lamp:
    name: Lamp
    selector:
      entity:
        domain: light
  label:
    name: Label
    default: Lamp
    selector:
      text: {}
---
<button data-action="toggle" data-entity="{{ input.lamp }}">
  {{ input.label }}: {{ input.lamp.state }}
</button>
```

- Selectors are the same as in blueprints (`entity`, `number`, `text`, `boolean`, …).
- `{{ input.lamp }}` is the picked value. For an entity, `{{ input.lamp.state }}` and `{{ input.lamp.attributes.brightness }}` read that entity.
- Scripts read inputs with `card.input('lamp')`.
- The picked values are stored next to the content (`inputs:` in the card config), so a newer version of a card replaces the content without losing them.

## State

Every card can keep information, also across a page reload. Where it lives is up to the card:

- **While the card is shown:** plain variables in a `<script>`.
- **Across a reload, in this browser:** `card.store`.

  ```js
  const best = card.store.get('best', 0);
  card.store.set('best', best + 1);
  ```

  Values are stored as JSON in the browser and shared by all cards with the same frontmatter `name`.
- **Across devices and users:** a Home Assistant helper (`input_number`, `input_text`, `input_boolean`, …), read with `{{ }}` or `card.state()` and written with an action such as `input_number.set_value`. Automations can use it too.

The [Snake](#snake) card uses both: its best score survives a reload with `card.store`, and is shared through a helper if you pick one.

## Security rating

Nothing is removed or blocked. The card editor reads your card while you type and shows a rating on top, with the reasons and line numbers:

| | Meaning | Examples |
|---|---|---|
| 🟢 | Plain markup | HTML, CSS, `data-*`, `{{ }}` |
| 🟡 | Worth a look | a `<script>` block, external images/fonts/CSS, a lock, alarm or `shell_command` action without `data-confirm`, `data-repeat` below 100 ms |
| 🔴 | Can run or load foreign code | `<iframe>`, `<script src="https://…">`, `onclick="…"`, `javascript:` URLs, and in scripts or expressions: `eval`, `fetch`, `WebSocket`, cookies, browser storage, the login token |

Grey hints do not change the rating: typos like `data-acton`, a bare `{{ light.kitchen }}`, invalid JSON in `data-data`, unknown entities and services.

The rating reads text; it cannot prove a card is safe. A green card contains none of the things above. Only paste markup you understand, especially from the internet or an AI.

## Showroom

Cards built with this card, ready to paste into the card editor. The full gallery is in [`showroom/`](showroom), and you can [add your own](CONTRIBUTING.md#add-a-card-to-the-showroom).

### Kitchen timer

<img src="showroom/kitchen-timer/screenshot.png" alt="Kitchen timer card" width="220">

A three-button kitchen timer backed by a Timer helper, so every dashboard shows the same countdown. [`showroom/kitchen-timer`](showroom/kitchen-timer/)

### Camera control

<img src="showroom/camera-control/screenshot.png" alt="Camera card with touch control" width="420">

The live camera picture is the joystick: press an edge to move the camera. No script. [`showroom/camera-control`](showroom/camera-control/)

### Panda

<img src="showroom/panda/screenshot.png" alt="Panda card that follows the cursor" width="220">

A panda that holds a sign and follows your cursor, without a card frame. [`showroom/panda`](showroom/panda/)

### Snake

<img src="showroom/snake/screenshot.png" alt="Snake game card" width="200">

A game in a dashboard card. [`showroom/snake`](showroom/snake/)

Run `npm run dev` and open `/playground/examples.html` to try them against a mock Home Assistant.

## Use with AI

Paste [`docs/LLM-PROMPT.md`](docs/LLM-PROMPT.md) into your assistant, describe the card, paste the result.

## Roadmap

Formatting helpers, importing cards from a link, card-picker suggestions.

## Development

```bash
npm install
npm run dev        # playground with a mock hass, no Home Assistant needed
npm test
npm run build      # dist/html-action-card.js
```

Issues and pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
