// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { formatValue, hasExpressions, parseTemplate, protectExpressions, renderParts } from './template';

describe('parseTemplate', () => {
  it('splits literals and expressions', () => {
    expect(parseTemplate('a {{ x }} b {{y}}')).toEqual(['a ', { expr: 'x' }, ' b ', { expr: 'y' }]);
  });
  it('plain text has no expressions', () => {
    expect(hasExpressions(parseTemplate('hello'))).toBe(false);
    expect(hasExpressions(parseTemplate('{{ a }}'))).toBe(true);
  });
  it('}} inside a string does not close', () => {
    expect(parseTemplate("{{ a == '}}' }}")).toEqual([{ expr: "a == '}}'" }]);
  });
  it('unclosed braces stay literal', () => {
    expect(parseTemplate('a {{ b')).toEqual(['a {{ b']);
  });
});

describe('protectExpressions', () => {
  it('escapes < inside {{ }} only', () => {
    expect(protectExpressions('<p>{{ a<b }}</p>')).toBe('<p>{{ a&lt;b }}</p>');
    expect(protectExpressions('<b>x</b> {{ t <= 5 ? "<" : ">" }}')).toBe('<b>x</b> {{ t &lt;= 5 ? "&lt;" : ">" }}');
  });
  it('leaves script, style and comments alone', () => {
    const html = '<script>const t = `{{ a<b }}`;</script><style>/* {{ a<b }} */</style><!-- {{ a<b }} -->';
    expect(protectExpressions(html)).toBe(html);
  });
  it('leaves markup without expressions and unclosed braces alone', () => {
    expect(protectExpressions('<p>a < b</p> {{ <i>x</i>')).toBe('<p>a < b</p> {{ <i>x</i>');
  });
  it('the escaped form parses back to the original expression', () => {
    const div = document.createElement('div');
    div.innerHTML = protectExpressions('<p>{{ sensor.a.state<sensor.b.state }}</p><i title="{{ a<b }}"></i>');
    expect(div.querySelector('p')!.textContent).toBe('{{ sensor.a.state<sensor.b.state }}');
    expect(div.querySelector('i')!.getAttribute('title')).toBe('{{ a<b }}');
  });
});

describe('formatValue / renderParts', () => {
  it('formats', () => {
    expect(formatValue(undefined)).toBe('');
    expect(formatValue(null)).toBe('');
    expect(formatValue(true)).toBe('true');
    expect(formatValue(3)).toBe('3');
    expect(formatValue([1, 2])).toBe('[1,2]');
  });
  it('renders', () => {
    expect(renderParts(parseTemplate('T: {{ t }}°'), () => 21)).toBe('T: 21°');
  });
});
