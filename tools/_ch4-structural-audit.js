/* 第21~30关结构审计：检查订单下方是否有真实落脚面，避免28关式孤岛。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const noop = () => {};
const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
  String, Number, Boolean, isNaN, parseInt, parseFloat, Set, Map,
  window: { addEventListener: noop, requestAnimationFrame: () => 0 },
  document: { getElementById: () => ({ getContext: () => ({}), style: {} }), addEventListener: noop },
  performance: { now: () => Date.now() }, requestAnimationFrame: () => 0,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['cloud-config.js', 'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'levels-ch4.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8'), sandbox, { filename: f });
}
const stand = '#=S><IBm';
let errors = 0;
for (let id = 21; id <= 30; id++) {
  const raw = sandbox.__CH4_LEVEL_BUILDERS[id]();
  const rows = raw.map;
  const issues = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== 'o') continue;
      const below = rows[r + 1] && rows[r + 1][c];
      const left = rows[r + 1] && rows[r + 1][c - 1];
      const right = rows[r + 1] && rows[r + 1][c + 1];
      const hasFace = stand.includes(below) || stand.includes(left) || stand.includes(right);
      if (!hasFace) issues.push(`(${c},${r})下方无落脚面`);
      if (below === '^' || left === '^' || right === '^') issues.push(`(${c},${r})下方紧邻尖刺`);
    }
  }
  if (issues.length) errors++;
  console.log(`第${id}关 ${issues.length ? '❌' : '✅'} ${issues.length ? issues.join('；') : '订单落脚面检查通过'}`);
}
process.exitCode = errors ? 1 : 0;
