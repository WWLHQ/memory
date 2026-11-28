import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestNoise, scan, selfTest } from '../check-test-noise.mjs';

test('噪音判红：T3-PENDING-E2E-TEST 标记命中', () => {
  assert.equal(isTestNoise({ mem_id: 'mem_x', content_l1: 'T3-PENDING-E2E-TEST 测试残留' }), true);
  assert.equal(isTestNoise({ mem_id: 'mem_y', content: '前缀 T3-PENDING-E2E-TEST 摘要' }), true);
});

test('白名单豁免：三条具名真实记忆含字样但不判噪音', () => {
  for (const id of [
    'mem_01M843TB17ZH76NKZ4AD6WTJZP',
    'mem_01M843TB6SSNS3W14TYQDQ9392',
    'mem_01M8ENQSTY1PJZJT4EJYNR0TNB',
  ]) {
    assert.equal(isTestNoise({ mem_id: id, content_l1: 'T3-PENDING-E2E-TEST' }), false, id);
  }
});

test('变异防误伤：真实正文/空值不判噪音', () => {
  assert.equal(isTestNoise({ mem_id: 'mem_real', content_l1: '边界条件：采购件需严格检查件号' }), false);
  assert.equal(isTestNoise({ mem_id: 'mem_empty', content_l1: '', content: '' }), false);
  assert.equal(isTestNoise(null), false);
});

test('变异自测全绿（造噪音判红、白名单/真实判绿）', () => {
  const st = selfTest();
  assert.equal(st.ok, true, JSON.stringify(st.results));
  assert.equal(st.results.length, 4);
});

test('scan：不存在的账本返回空命中，不抛错', () => {
  const r = scan('D:/__nonexistent__/no-such-db.json');
  assert.equal(r.hits.length, 0);
  assert.equal(r.scanned, 0);
});
