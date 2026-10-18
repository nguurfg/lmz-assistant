#!/usr/bin/env node
/**
 * static-solve.js — 字符串混淆「静态求值器」
 *
 * 不执行任何业务代码，只做三件事：
 *   1. 抽出字符串表函数（如 _0x453d）与解密函数（如 _0x1464 / _0x43ec）
 *   2. 抽出所有二级包装函数 function _0xXXXX(e,t,i,s,r){return _0xNNNN(算式,key)}
 *   3. 解析每个包装的参数映射，扫描全文调用点求值并还原为字符串字面量
 *
 * 用法:
 *   node static-solve.js <input.js> [-o out.js] [--json strings.json]
 *
 * 仅在你有权分析的文件上使用。
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------------- 源码切分 ---------------- */

function extractFunction(src, name) {
  const key = 'function ' + name;
  const start = src.indexOf(key);
  if (start < 0) return null;
  let d = 0, on = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { d++; on = true; }
    else if (src[i] === '}') { d--; if (on && d === 0) return src.slice(start, i + 1); }
  }
  return null;
}

/** 找出形如 `function _0xNNNN(a,b,...){return _0xNNNN(expr)}` 的包装 */
function extractWrappers(src) {
  // 名字允许 0-9a-f 全集（真实样本里存在 _0x43ec 这类含数字 3 的标识符）
  const re = /function (_0x[0-9a-f]{4,8})\(([^)]*)\)\{return (_0x[0-9a-f]{4,8})\(([^)]*)\)\}/g;
  const m = new Map();
  let x;
  while ((x = re.exec(src)) !== null) {
    m.set(x[1], {
      params: x[2].split(',').map(s => s.trim()).filter(Boolean),
      callee: x[3],
      argsExpr: x[4]
    });
  }
  return m;
}

/** 解析 `r- -874,e` → {pIdx, pKey, offset} */
function parseArgs(argsExpr) {
  const parts = argsExpr.split(',').map(s => s.trim());
  if (parts.length < 2) return null;
  const m = /^(\w+)\s*-\s*(-)?\s*([0-9]+)$/.exec(parts[0]);
  if (!m) return null;
  const off = m[2] === '-' ? parseInt(m[3], 10) : -parseInt(m[3], 10);
  return { varName: m[1], keyExpr: parts[1], offset: off };
}

function main() {
  const a = process.argv.slice(2);
  const input = a[0];
  if (!input || !fs.existsSync(input)) {
    console.error('用法: node static-solve.js <input.js> [-o out.js] [--json strings.json]');
    process.exit(1);
  }
  const fl = (n, d) => {
    const i = a.indexOf(n);
    return (i >= 0 && a[i + 1] && a[i + 1][0] !== '-') ? a[i + 1] : d;
  };
  const outPath  = fl('-o',    path.join(path.dirname(input), path.basename(input, '.js') + '.deob.js'));
  const jsonPath = fl('--json', path.join(path.dirname(input), 'decoded_strings.json'));

  const src = fs.readFileSync(input, 'utf8');
  console.log('[+] 输入', input, '(' + (src.length / 1024).toFixed(0) + ' KB)');

  // --- 1) 抽出字符串表 + 解密器 ---
  // 解密器内部会调用字符串表函数，必须一起加载，否则求值全失败
  const tableFn = extractFunction(src, '_0x453d');
  let table = [];
  if (tableFn) {
    try { table = new Function(tableFn + '; return _0x453d();')(); }
    catch (e) { console.log('[-] 字符串表求值失败:', e.message); }
  }
  console.log('[+] 字符串表长度:', table.length);

  const prelude = tableFn ? tableFn + '\n' : '';
  const decoders = {};
  for (const nm of ['_0x1464', '_0x43ec']) {
    const code = extractFunction(src, nm);
    if (!code) { console.log('[-] 缺少', nm); continue; }
    try { decoders[nm] = new Function(prelude + code + '; return ' + nm + ';')(); }
    catch (e) { console.log('[-] ' + nm + ' 初始化失败:', e.message); }
  }
  const dnames = Object.keys(decoders);
  console.log('[+] 解密器:', dnames.join(', ') || '(无)');
  if (!dnames.length) { console.log('[!] 无解密器'); process.exit(0); }

  // --- 2) 抽出包装函数 ---
  const wrappers = extractWrappers(src);
  const parsed = new Map();
  wrappers.forEach((info, name) => {
    const p = parseArgs(info.argsExpr);
    if (!p) return;
    if (info.params.indexOf(p.varName) < 0) return;
    parsed.set(name, {
      params: info.params,
      callee: info.callee,
      pIdx: info.params.indexOf(p.varName),
      pKey: info.params.indexOf(p.keyExpr),
      offset: p.offset
    });
  });
  console.log('[+] 包装函数:', wrappers.size, '可解析:', parsed.size);
  if (!parsed.size) { console.log('[!] 无可解析包装'); process.exit(0); }

  // --- 3) 扫描调用点 ---
  // 形如 NAME(<num|str>, ...) —— 最多 5 个参数
  const names = Array.from(parsed.keys()).sort((x, y) => y.length - x.length).join('|');
  const ARG = '(?:(-?[0-9]+)|"([^"]*)"|\'([^\']*)\')';
  const SP  = '[ \\t\\r\\n]*';
  const re  = new RegExp(
    '(?<![A-Za-z0-9_$])(' + names + ')\\(' + SP + ARG +
    '(?:' + SP + ',' + SP + ARG + ')?(?:' + SP + ',' + SP + ARG + ')?' +
    '(?:' + SP + ',' + SP + ARG + ')?(?:' + SP + ',' + SP + ARG + ')?' + SP + '\\)', 'g');

  const resolved = new Map();
  let tried = 0, ok = 0, m;
  while ((m = re.exec(src)) !== null) {
    const raw = m[0];
    const name = m[1];
    const meta = parsed.get(name);
    if (!meta || resolved.has(raw)) continue;
    const argv = [];
    for (let i = 0; i < 5; i++) {
      const g = 2 + i * 3;
      const num = m[g], dq = m[g + 1], sq = m[g + 2];
      if (num !== undefined) argv.push(parseInt(num, 10));
      else if (dq !== undefined) argv.push(dq);
      else if (sq !== undefined) argv.push(sq);
      else argv.push(null);
    }
    const iv = argv[meta.pIdx], kv = argv[meta.pKey];
    if (iv === null || iv === undefined || kv === null || kv === undefined) continue;
    const fn = decoders[meta.callee];
    if (!fn) continue;
    tried++;
    try {
      const v = fn(iv + meta.offset, String(kv));
      if (typeof v === 'string' && v.length) { resolved.set(raw, v); ok++; }
    } catch (e) { /* 跳过 */ }
    re.lastIndex = m.index + raw.length;
  }
  console.log('[+] 调用点求值: 尝试', tried, '成功', ok);

  let out = src, n = 0;
  resolved.forEach((v, k) => { out = out.split(k).join(JSON.stringify(v)); n++; });
  console.log('[+] 已替换', n);
  fs.writeFileSync(outPath, out);
  console.log('[OK] 还原源码 →', outPath);

  // 字符串表也一并导出
  const all = new Set(resolved.values());
  table.forEach(function (x) { if (typeof x === 'string') all.add(x); });
  const arr = Array.from(all);
  fs.writeFileSync(jsonPath, JSON.stringify(arr));
  fs.writeFileSync(jsonPath.replace(/\.json$/, '.txt'), arr.join('\n'));
  console.log('[OK] 字符串表 →', jsonPath, '(' + arr.length + ' 条)');
  console.log('[i] 样例:', arr.slice(0, 15).join(' | '));
}

if (require.main === module) main();
module.exports = { extractFunction, extractWrappers, parseArgs };
