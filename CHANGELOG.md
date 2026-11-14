# Changelog

## 0.1.0

First public alpha.

- The whole card is one `content` field: HTML with `<style>` and `<script>` blocks, rendered in a Shadow DOM.
- `{{ }}` and `data-show-if` share one expression language. Entities are written like Home Assistant state objects (`light.x.state`, `light.x.attributes.brightness`).
- Live updates through dependency tracking, including `now()` and `relative()`.
- `data-event` (`tap`, `dbltap`, `hold`, `press` with repeat, `release`) and `data-action` (services, `toggle`, `more-info`, `navigate`, `url`), with `data-confirm`.
- Scripts (classic, module, `src`) with the `card` API. Timers, listeners and observers are released with the card.
- Card editor with a live security rating. Nothing is blocked.
