export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  connected?: boolean;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  [key: string]: unknown;
}

export interface CardConfig {
  type: string;
  /**
   * The whole card: HTML with `<style>` and `<script>` blocks, `{{ }}` and data-* attributes.
   * Rendered verbatim inside the card's Shadow DOM, so styles stay inside the card.
   */
  content: string;
  /** Ticker interval in ms for now()/relative(). Default 1000. */
  refresh_interval?: number;
}

/** Overall security rating. It only informs: nothing is ever blocked or removed. */
export type Severity = 'green' | 'yellow' | 'red';

export interface Finding {
  /** `red`/`yellow` drive the rating. `info` is a hint (typo, unknown entity) and never changes it. */
  level: 'red' | 'yellow' | 'info';
  message: string;
  /** 1-based line in the card content. */
  line?: number;
}

export interface Report {
  severity: Severity;
  findings: Finding[];
}
