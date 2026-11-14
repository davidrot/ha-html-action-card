import { HtmlActionCard } from './card';
import { HtmlActionCardEditor } from './editor/editor';

if (!customElements.get('html-action-card')) {
  customElements.define('html-action-card', HtmlActionCard);
}
if (!customElements.get('html-action-card-editor')) {
  customElements.define('html-action-card-editor', HtmlActionCardEditor);
}

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'html-action-card',
  name: 'HTML Action Card',
  description: 'Plain HTML/CSS with declarative actions, states and optional scripts.',
  documentationURL: 'https://github.com/davidrot/ha-html-action-card',
});

const version = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
console.info(
  `%c HTML-ACTION-CARD %c v${version} `,
  'color:white;background:#03a9f4;font-weight:700',
  'color:#03a9f4;background:white;font-weight:700',
);
