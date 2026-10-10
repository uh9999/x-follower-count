const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../format.js');
const { formatCount } = globalThis.XFollowerFormat;
test('截图数字与万亿边界', () => {
  for (const [count, expected] of [[0,'0'],[7,'7'],[178,'178'],[7806,'7,806'],[35000,'3.5万'],[9999,'9,999'],[10000,'1万'],[99999,'9.9万'],[100000000,'1亿']]) assert.equal(formatCount(count),expected);
});
test('完整显示与非法数量', () => {
  assert.equal(formatCount(35000,'exact'),'35,000');
  for (const value of [-1,NaN,Infinity,1.5,'35',null,Number.MAX_SAFE_INTEGER+1]) assert.equal(formatCount(value),null);
});
