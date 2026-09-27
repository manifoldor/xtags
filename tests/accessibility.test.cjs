const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../extension');
const luminance = hex => {
  const values = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
test('all 16 light/dark label palettes exceed 4.5:1 for small text', () => {
  const code = fs.readFileSync(path.join(root,'content.js'),'utf8');
  const levels = vm.runInNewContext('(' + code.match(/const LEVELS = (\{[\s\S]*?\n  \});/)[1] + ')');
  assert.equal(Object.keys(levels).length, 8);
  for (const [name, color] of Object.entries(levels)) for (const [fg, bg] of [[color.fg,color.bg],[color.darkFg,color.darkBg]]) {
    assert.ok(contrast(fg,bg) >= 4.5, `${name}: ${contrast(fg,bg)}`);
  }
});
test('popup and settings help text meet 4.5:1 on their backgrounds', () => {
  for (const name of ['popup.html','settings.html']) {
    const css = fs.readFileSync(path.join(root,name),'utf8');
    const color = css.match(/--ink-3:\s*(#[a-f0-9]{6})/)[1];
    for (const bg of ['#ffffff','#f4f6f8','#f8f9fa']) assert.ok(contrast(color,bg) >= 4.5, `${name}: ${contrast(color,bg)}`);
  }
});
