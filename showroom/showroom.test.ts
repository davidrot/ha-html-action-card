import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';

/**
 * Keeps the showroom honest: every card has its files, a screenshot of sane size,
 * no secrets, and the security rating written in its README is the real one.
 */
const root = __dirname;
const cards = readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
const gallery = readFileSync(join(root, 'README.md'), 'utf8');

describe('showroom', () => {
  it('has cards', () => {
    expect(cards.length).toBeGreaterThan(0);
  });

  describe.each(cards)('%s', (card) => {
    const dir = join(root, card);
    const read = (file: string) => readFileSync(join(dir, file), 'utf8');

    it('uses a lowercase folder name with dashes', () => {
      expect(card).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it('has card.html, screenshot.png and README.md', () => {
      for (const file of ['card.html', 'screenshot.png', 'README.md']) {
        expect(existsSync(join(dir, file)), `${card}/${file} is missing`).toBe(true);
      }
    });

    it('has a screenshot of at most 400 KB', () => {
      expect(statSync(join(dir, 'screenshot.png')).size).toBeLessThanOrEqual(400 * 1024);
    });

    it('states the real security rating', () => {
      const actual = analyze(read('card.html')).severity;
      const stated = /\*\*Rating:\*\*\s*(green|yellow|red)/.exec(read('README.md'))?.[1];
      expect(stated, `write "- **Rating:** ${actual}" into ${card}/README.md`).toBe(actual);
      if (actual === 'red') {
        expect(read('README.md'), `a red card needs a "- **Why red:**" line`).toMatch(/\*\*Why red:\*\*\s*\S/);
      }
    });

    it('names its author and what it needs', () => {
      expect(read('README.md')).toMatch(/\*\*Author:\*\*\s*\S/);
      expect(read('README.md')).toMatch(/\*\*Needs:\*\*\s*\S/);
    });

    it('contains nothing that looks like a token', () => {
      const html = read('card.html');
      expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT, e.g. a long-lived access token
      expect(html).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
    });

    it('is listed in the gallery', () => {
      expect(gallery, `add ${card} to showroom/README.md`).toContain(`](${card}/)`);
    });
  });
});
