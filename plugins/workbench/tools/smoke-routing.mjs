import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const start = source.indexOf('var WB_COMPLEXITY_THRESHOLD');
const end = source.indexOf('function WorkbenchOrchestrationLegacy', start);
assert(start >= 0 && end > start, 'routing function block missing');
const decide = Function(source.slice(start, end) + '; return wbRoutingDecision;')();

const cases = [
  { text: '你好', enabled: true, mode: 'quick', agents: 1, track: 'A' },
  { text: '1 加 1 等于多少？', enabled: true, mode: 'quick', agents: 1, track: 'A' },
  { text: '同时查法国首都？另外查日本首都？并且查德国首都？', enabled: true, mode: 'parallel', agents: 3, track: 'A' },
  { text: '同时查法国首都？另外查日本首都？并且查德国首都？', enabled: false, mode: 'quick', agents: 1, track: 'A' },
  { text: '修改右侧工具栏按钮颜色', enabled: true, mode: 'orchestrate', agents: 2, track: 'A', write: true },
  { text: '对比两种数据库并给出选择建议', enabled: true, mode: 'orchestrate', agents: 2, track: 'A' },
  { text: '分析整个系统架构并输出重构方案和风险评估报告', enabled: true, mode: 'orchestrate', agents: 2, track: 'A' },
  { text: '对大型代码库做深度代码审查和长时间编码重构', enabled: true, mode: 'orchestrate', agents: 3, track: 'B', actualTrack: 'A' }
];

for (const entry of cases) {
  const actual = decide(entry.text, entry.enabled);
  assert.equal(actual.mode, entry.mode, `${entry.text}: mode`);
  assert.equal(actual.targetAgents, entry.agents, `${entry.text}: agents`);
  assert.equal(actual.preferredTrack, entry.track, `${entry.text}: preferred track`);
  assert.equal(actual.actualTrack, entry.actualTrack || 'A', `${entry.text}: actual track`);
  if (entry.write) assert.equal(actual.writeIntent, true, `${entry.text}: write intent`);
  if (entry.track === 'B') assert.match(actual.fallbackReason, /回退轨道 A/);
}

const liveTrackB = decide('对大型代码库做深度代码审查和长时间编码重构', true, ['spawn', 'codex']);
assert.equal(liveTrackB.actualTrack, 'B', 'compatible product provider should activate track B');
assert.equal(liveTrackB.fallbackReason, '');
const stricter = decide('对比两种数据库并给出选择建议', true, ['spawn'], { complexityThreshold: 0.9, valueThreshold: 0.9, parallelQuestionMin: 3 });
assert.equal(stricter.mode, 'quick', 'applied calibration policy should affect routing thresholds');

console.log(`routing smoke passed (${cases.length} baseline cases + provider/policy calibration)`);
