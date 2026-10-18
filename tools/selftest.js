/**
 * selftest.js — 用构造的混淆样本验证 static-solve.js
 * 运行: node tools/selftest.js
 *
 * 样本与真实目标同构：
 *   - 字符串表函数 _0x453d() 返回字符串数组
 *   - 解密函数     _0x43ec(idx, key) 由表项 + key 解出明文
 *   - 包装函数     function _0xXXXX(a,b,c,d,e){ return _0x43ec(<算式>, <参数>) }
 *   - 调用点       _0xXXXX(0,0,0,<idx>,'KEY')
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');

// 哨兵字符串放在表首两项；解密逻辑：base64 解码表项后与 key 异或无关，直接返回
const sample = [
  'function _0x453d(){',
  '  var e=[' + JSON.stringify(b64('SENTINEL_ALPHA')) + ',' + JSON.stringify(b64('SENTINEL_BETA')) + '];',
  '  _0x453d=function(){return e;};',
  '  return _0x453d();',
  '}',
  'function _0x43ec(e,t){',
  '  var i=_0x453d();',
  '  var r=i[t-=0];',
  '  return typeof Buffer!=="undefined" ? Buffer.from(r,"base64").toString("utf8") : r;',
  '}',
  'function _0xbeef(e,t,i,s,r){return _0x43ec(t- -100,s)}',
  'console.log(_0xbeef(0,0,0,0,"K"))',
  'console.log(_0xbeef(0,0,0,1,"K"))'
].join('\n');

const tmp  = path.join(os.tmpdir(), 'lmz_selftest_sample.js');
const out  = path.join(os.tmpdir(), 'lmz_selftest_out.js');
const json = path.join(os.tmpdir(), 'lmz_selftest.json');
fs.writeFileSync(tmp, sample);
console.log('[selftest] 样本已生成:', tmp);

try {
  const log = execFileSync('node', [path.join(__dirname, 'static-solve.js'), tmp,
    '-o', out, '--json', json], { encoding: 'utf8' });
  console.log(log);
  const res = fs.readFileSync(out, 'utf8');
  const a = res.indexOf('SENTINEL_ALPHA') >= 0;
  const b = res.indexOf('SENTINEL_BETA')  >= 0;
  console.log(a && b
    ? '[selftest] PASS — 哨兵字符串已正确还原'
    : '[selftest] FAIL — 哨兵字符串未还原');
  process.exit(a && b ? 0 : 1);
} catch (e) {
  console.error('[selftest] 失败:', e.message);
  console.error(e.stdout || '');
  process.exit(1);
}
