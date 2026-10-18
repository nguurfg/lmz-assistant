// ==UserScript==
// @name         猎梦者助手（免登录直玩 + 作弊菜单）
// @namespace    https://github.com/lmzydocs/lmz-assistant
// @version      6.6
// @description  233乐园小游戏助手：免登录直玩、免激励视频、游戏内作弊菜单、存档导入导出。纯本地修改，不上传任何数据。
// @author       lmzydocs
// @match        https://h5.metaapp.cn/*
// @match        https://www.233leyuan.com/*
// @match        https://*.233leyuan.com/*
// @run-at       document-end
// @all-frames   true
// @grant        none
// @license      MIT
// @homeURL      https://github.com/lmzydocs/lmz-assistant
// @supportURL   https://github.com/lmzydocs/lmz-assistant/issues
// ==/UserScript==

/* ============================================================================
 * 猎梦者助手 · 用户脚本
 *
 * 纯本地修改：不读取/不上传任何个人数据，不连接除游戏原站外的第三方服务。
 * 全部逻辑作用于浏览器 localStorage 与页面 DOM。
 *
 * 免责声明：本脚本仅供学习研究浏览器存储机制与运行时注入技术。
 * ========================================================================== */
(function () {
  'use strict';

  var KEY_MAIN = 'PlayerDataItem';
  var KEY_CLOUD = 'cloudData';
  var SAVE_PREFIX = '_save_';
  var BACKUP_KEY = '_lmz_backup';
  var GUEST_KEY = '_lmz_guest';
  var GAME_URL_KEY = '_lmz_game_url';
  var PANEL_ID = '__lmz_cheat_panel';

  /* 游戏地址兜底表
   * 233 主站在未登录时不会下发游戏地址（HTML / __NUXT__ / _payload.json / 各 API 均不含），
   * 地址仅在登录成功后由服务端下发。换游戏时可在菜单里手动填写。 */
  var GAME_FALLBACK = [
    'https://h5.metaapp.cn/online/h5/UAFvivbmbCZNJJ8wmkXR/1.0.0/index.html'
  ];

  var CFG = {
    guestMode: true,
    blockAds: true,
    bypassLogin: true,
    finishOnEnter: true,   // 进入即完成一局（关掉引导/公告板，关卡模式直接是通关后状态）
    gold: 999999, fragment: 999999, goldenKey: 999,
    win: 999, lose: 0, mvp: 999, mw: 999999,
    gameLev: 99, trollLev: 99,
    unlockAllModes: true, unlockAllSkins: true, unlockAllTrollSkins: true,
    blueprintMax: true, storyClear: true, menuInGame: true
  };

  function log() {
    try { console.log.apply(console, ['[猎梦者助手]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  function readJSON(k, d) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; }
  }
  function writeJSON(k, o) {
    try { localStorage.setItem(k, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  function is233() { return /233leyuan\.com/.test(location.hostname); }
  function isGame() { return /h5\.metaapp\.cn/.test(location.hostname); }
  function qs(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function randomId(n) {
    var s = '', chars = 'abcdef0123456789';
    for (var i = 0; i < (n || 32); i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  /* ------------------------- 游客身份 ------------------------- */
  function guestId() {
    var g = null;
    try { g = localStorage.getItem(GUEST_KEY); } catch (e) {}
    if (g) return g;
    g = 'lmz_' + randomId(24);
    try { localStorage.setItem(GUEST_KEY, g); } catch (e) {}
    return g;
  }

  // 233 给访客分配的 uid 藏在 __NUXT__ 深层，路径随版本变动，故递归查找
  function find233Uid() {
    function walk(o, d) {
      if (!o || d > 8) return null;
      if (typeof o === 'object') {
        if (o.uid && typeof o.uid === 'string' && o.uid.length > 10) return o.uid;
        for (var k in o) { try { var r = walk(o[k], d + 1); if (r) return r; } catch (e) {} }
      }
      return null;
    }
    try { return walk(window.__NUXT__, 0); } catch (e) { return null; }
  }

  function ensureGuestIdentity() {
    var id = qs('openid') || qs('openId') || qs('uid') || qs('userId') || guestId();
    try {
      if (typeof window.openId === 'undefined') window.openId = id;
      if (typeof window.openid === 'undefined') window.openid = id;
      if (typeof window.userId === 'undefined') window.userId = id;
      if (typeof window.uid === 'undefined') window.uid = id;
    } catch (e) {}
    return id;
  }

  /* ------------------------- 游戏地址解析 ------------------------- */
  function findGameUrl() {
    try {
      var u = localStorage.getItem(GAME_URL_KEY);
      if (u && u.indexOf('metaapp.cn') > 0) return u;
    } catch (e) {}
    if (window.__LMZ_GAME_URL__ && String(window.__LMZ_GAME_URL__).indexOf('metaapp.cn') > 0) {
      return String(window.__LMZ_GAME_URL__);
    }
    try {
      var fs = document.querySelectorAll('iframe');
      for (var i = 0; i < fs.length; i++) {
        var s = fs[i].getAttribute('src') || '';
        if (s.indexOf('h5.metaapp.cn') >= 0) {
          var real = s.split('?')[0];
          try { localStorage.setItem(GAME_URL_KEY, real); } catch (e) {}
          return real;
        }
      }
    } catch (e) {}
    return GAME_FALLBACK[0];
  }

  /* ------------------------- 免登录 -------------------------
   * 实测：未登录点「开始游戏」→ /h5/{id}
   *   → 创建 <iframe id="sdkIframe" src="https://oauth.ark.online/login?...">（满屏）
   *   → 页面显示「正在打开登录...」（.online-game-runner__gate）
   *   → 游戏 iframe 永不创建
   * 处理：移除登录框与遮罩，自行注入带游客身份的游戏 iframe。 */
  function killLogin() {
    if (!CFG.bypassLogin || !is233()) return;
    var changed = false;
    var sdk = document.getElementById('sdkIframe');
    if (sdk && sdk.parentNode) { try { sdk.parentNode.removeChild(sdk); changed = true; } catch (e) {} }
    var sels = ['.online-game-runner__gate', '.online-game-runner__loading',
                '.game-loading-screen', '.online-game-runner__mask'];
    for (var s = 0; s < sels.length; s++) {
      var els = document.querySelectorAll(sels[s]);
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.parentNode) { try { e.parentNode.removeChild(e); changed = true; } catch (x) {} }
      }
    }
    try {
      var fs = document.querySelectorAll('iframe');
      for (var j = 0; j < fs.length; j++) {
        var src = fs[j].getAttribute('src') || '';
        if (src.indexOf('oauth.') >= 0) {
          if (fs[j].parentNode) { try { fs[j].parentNode.removeChild(fs[j]); changed = true; } catch (y) {} }
        }
      }
    } catch (e) {}
    if (changed) log('已移除登录弹窗');
  }

  function injectGame() {
    if (!CFG.bypassLogin || !is233()) return;
    if (!/\/h5\/\d+/.test(location.pathname)) return;
    if (document.getElementById('__lmz_game')) return;
    var url = findGameUrl();
    if (!url) return;
    var uid = find233Uid() || guestId();
    var f = document.createElement('iframe');
    f.id = '__lmz_game';
    f.title = 'game';
    f.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:9998;border:0;background:#000;';
    f.src = url + (url.indexOf('?') >= 0 ? '&' : '?') +
            'openid=' + encodeURIComponent(uid) + '&userId=' + encodeURIComponent(uid);
    document.body.appendChild(f);
    log('已注入游戏 iframe（游客身份）');
  }

  /* ------------------------- 免激励视频 -------------------------
   * 广告链路：
   * 方案：只 patch MetaH5Ad.showAd，返回 {code:0,data:{status:4}}。
   * ★ 千万不要碰 Platform.playVideo —— 它把 status 读出来的形状错了就崩 */
  var adStats = { blocked: 0 };
  var _origShowAd = null;

  /* ---- 去广告：只 patch MetaH5Ad.showAd，不碰 Platform ----
   * 真实调用链（twothreethree.js 源码）：
   *   Platform.playVideo(s) → MetaH5Ad.showAd(1, cb)
   *     → cb(a) → switch(a.data.status) → case 4: s.success()
   * ★ 必须返回 { code:0, data:{ status:4 } }，且 data 不能为 undefined
   *   （旧版在 Platform 层补丁，返回值形状/none 时机不对 → 报
   *    "Cannot read properties of undefined (reading 'status')"）
   * ★ 不 patch Platform：它是 IIFE 里创建的局部对象，
   *   window.Platform = s 之后再改 s.playVideo 会被 bundle 侧的引用挡住，
   *   且改它等于改平台层行为，容易崩。 */
  function patchAds() {
    if (!CFG.blockAds) return;
    var M = window.MetaH5Ad;
    if (!M || typeof M.showAd !== 'function') return;   // SDK 还没加载，下轮再来
    if (M.showAd.__lmz) return;
    if (!_origShowAd) _origShowAd = M.showAd;           // 存原版，供 restoreAds
    var sa = function (type, cb) {
      adStats.blocked++;
      try {
        if (typeof cb === 'function') {
          cb({ code: 0, data: { status: 4 } });   // 4 = 激励视频奖励
        }
      } catch (e) { log('showAd cb err: ' + e); }
      return true;
    };
    sa.__lmz = true;
    M.showAd = sa;
    log('已patch MetaH5Ad.showAd');
  }
  function restoreAds() {
    try {
      if (window.MetaH5Ad && _origShowAd) window.MetaH5Ad.showAd = _origShowAd;
    } catch (e) {}
  }

  /* ------------------------- 存档操作 ------------------------- */
  function backupOnce() {
    if (localStorage.getItem(BACKUP_KEY)) return;
    var snap = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      snap[k] = localStorage.getItem(k);
    }
    localStorage.setItem(BACKUP_KEY, JSON.stringify(snap));
  }

  function restoreBackup() {
    var snap = readJSON(BACKUP_KEY, null);
    if (!snap) { alert('没有备份快照'); return; }
    if (!confirm('确定恢复备份？当前存档将被覆盖。')) return;
    Object.keys(snap).forEach(function (k) { localStorage.setItem(k, snap[k]); });
    alert('已恢复，刷新页面生效。');
  }

  function grantModes(pd) {
    ['_isUnlockGhostMode', '_isUnlockPuppetMode', '_isUnlockPlotMode',
     '_isUnlockCoupleMode', '_isUnlockNightmare', '_isUnlockCanNoDie'
    ].forEach(function (f) { pd[f] = 1; });
  }
  function grantBlueprints(pd) {
    if (!pd._blueprint) return;
    Object.keys(pd._blueprint).forEach(function (k) { pd._blueprint[k] = 99; });
  }
  // 地图数组真实结构（实测）：
  //   _plotInfo  6 元素：[mapId, 名称, 0, 0, 0, 1]      ← 最后一个是通关标记
  //   _normalInfo 5 元素：["map0","经典地图",1,1,1]      ← 后三个 1 = 已通关
  function clearStory(pd) {
    ['_plotInfo', '_normalInfo', '_trollInfo', '_puppetInfo', '_coupleInfo'].forEach(function (key) {
      var arr = pd[key];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (row) {
        if (!Array.isArray(row)) return;
        if (row.length === 6) { row[2] = 1; row[3] = 1; row[4] = 1; row[5] = 1; }
        else if (row.length === 5) { row[2] = 1; row[3] = 1; row[4] = 1; }
        else if (row.length > 2) { row[row.length - 1] = 1; }
      });
    });
  }
  // _unlockSkinFragment 真实结构（实测 9 元素）：
  //   [名字, 当前碎片, 已解锁, 门槛1碎片数, 已达成?, 门槛2碎片数, 已达成?, 已达成?, ?]
  //   正常已解锁样例：["wangxiaoming", 0, 1, 40, 1, 45, 1, 0, 1]
  //   ★ 旧版把 r[3]/r[5]/r[7] 清零 → 门槛变成 0 → 皮肤显示异常
  function grantSkins(pd) {
    if (Array.isArray(pd._skinFragment)) {
      pd._skinFragment.forEach(function (r) { if (Array.isArray(r)) r[1] = 9999; });
    }
    if (Array.isArray(pd._unlockSkinFragment)) {
      pd._unlockSkinFragment.forEach(function (r) {
        if (!Array.isArray(r)) return;
        if (r.length < 9) return;              // 结构不符，不动
        r[1] = 9999;   // 当前碎片
        r[2] = 1;      // 已解锁
        r[3] = 30;     // 门槛1碎片数
        r[4] = 1;      // 门槛1已达成
        r[5] = 45;     // 门槛2碎片数
        r[6] = 1;      // 门槛2已达成
        r[7] = 0;
        r[8] = 1;      // 最终态 = 1（见 wangxiaoming）
      });
    }
    if (Array.isArray(pd._skinSelectIndex)) {
      pd._skinSelectIndex.forEach(function (r) { if (Array.isArray(r)) r[1] = 1; });
    }
    if (typeof pd._skinTreasureChestIndex === 'number') pd._skinTreasureChestIndex = 99;
  }
  function grantTrollSkins(pd) {
    if (!CFG.unlockAllTrollSkins) return;
    if (pd._trollSkin && typeof pd._trollSkin === 'object') {
      Object.keys(pd._trollSkin).forEach(function (k) { pd._trollSkin[k] = 1; });
    }
  }
  function grantCloud(cd) {
    if (!cd) return;
    ['currGameLev', 'lastGameLev', 'floorGameLev', 'maxGameLevThisWeek'].forEach(function (k) { cd[k] = CFG.gameLev; });
    ['curTrollLev', 'lastTrollLev', 'floorTrollLev', 'maxTrollLevThisWeek'].forEach(function (k) { cd[k] = CFG.trollLev; });
    cd.isOpenGameLev = true; cd.iscanopenGamelev = true;
    cd.isLastGameWin = true; cd.isLastTrollWin = true;
  }
  function grantSaves() {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf(SAVE_PREFIX) !== 0) continue;
      var s = readJSON(k, null);
      if (!s) continue;
      if (typeof s.Money === 'number') s.Money = 999999;
      if (typeof s.goldMoneyNum === 'number') s.goldMoneyNum = 999999;
      if (typeof s.moneyNum === 'number') s.moneyNum = 999999;
      // ★ 体力在嵌套对象 physicalData 里（2026-10-18 实测），旧版写 s.physicalNum 是错的
      if (s.physicalData && typeof s.physicalData.physicalNum === 'number') {
        s.physicalData.physicalNum = 9999;
      }
      writeJSON(k, s);
    }
  }
  /* ---- 新手流程字段（2026-10-18 实测 + bundle.js 静态确认） ----
   * bundle.js 里的启动逻辑：
   *   0==_lastDate && _win+_lose==0 || (_isNewPlayer=1)
   *   → 只要 _lastDate!=0 或 有胜场，游戏就强制把 _isNewPlayer 设回 1
   *   → isNewPlayer!=0 时游戏强制弹公告板(onBulletinBoardClick)、
   *     显示新手箭头引导、血量×1.2，表现为「设置/皮肤不显示」
   * 所以要把整个新手状态一次性写成"已完成"，不能只改一个字段。 */
  function finishTutorial() {
    backupOnce();
    var n = 0;
    var pd = readJSON(KEY_MAIN, null) || {};

    // 1) 新手态相关（无条件写，这是本功能的核心）
    pd._isNewPlayer = 0; n++;
    pd._newplayday = 0; n++;
    // 2) 场次：让游戏认为"已经玩过了"
    if (typeof pd._win === 'number') { pd._win = Math.max(pd._win, 1); n++; }
    if (typeof pd._lose === 'number') { pd._lose = Math.max(pd._lose, 1); n++; }
    // 3) 日期字段：_lastDate 非 0 是游戏判定"非首日"的依据
    if (pd._lastDate !== undefined) { pd._lastDate = new Date().getDate(); n++; }
    if (pd._dayCount !== undefined) { pd._dayCount = Date.now(); n++; }
    if (pd._lastDay !== undefined) { pd._lastDay = Date.now(); n++; }
    if (pd._dday !== undefined) { pd._dday = 2; n++; }
    // 4) 教程/任务标记（字段名在不同版本有变化，存在才写）
    ['_taskOk', '_isTeachOver', '_teachOver', '_isGuideOver', '_guideOver',
     '_isFinishGuide', '_isTutorialOver', '_tutorial'
    ].forEach(function (k) { if (pd[k] !== undefined) { pd[k] = true; n++; } });
    // 5) 经典模式场次：模式解锁/进度的常见判据
    if (typeof pd._normalCount === 'number') { pd._normalCount = Math.max(pd._normalCount, 1); n++; }
    if (typeof pd._gameCount === 'number') { pd._gameCount = Math.max(pd._gameCount, 1); n++; }
    // 6) 关卡可开放标记
    pd._iscanopenGamelev = true; n++;

    writeJSON(KEY_MAIN, pd);

    // cloudData 里也有一份 iscanopenGamelev
    var cd = readJSON(KEY_CLOUD, null);
    if (cd) { cd.iscanopenGamelev = true; writeJSON(KEY_CLOUD, cd); }

    // 7) 副存档的新手引导标记（_save_110.isTeachOver 等）
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf(SAVE_PREFIX) !== 0) continue;
      var s = readJSON(k, null);
      if (!s) continue;
      ['isTeachOver', 'isGuideOver', 'isTutorialOver', 'isFinishGuide',
       'teachOver', 'guideOver'].forEach(function (f) {
        if (s[f] !== undefined) { s[f] = true; n++; }
      });
      if (typeof s.levelNum === 'number') { s.levelNum = Math.max(s.levelNum, 2); n++; }
      writeJSON(k, s);
    }
    return n;
  }

  function applyAll() {
    backupOnce();
    var pd = readJSON(KEY_MAIN, null);
    if (!pd) return false;
    if (typeof pd._gold === 'number') pd._gold = CFG.gold;
    if (typeof pd._fragment === 'number') pd._fragment = CFG.fragment;
    if (typeof pd._goldenKey === 'number') pd._goldenKey = CFG.goldenKey;
    if (typeof pd._win === 'number') pd._win = CFG.win;
    if (typeof pd._lose === 'number') pd._lose = CFG.lose;
    if (typeof pd._mvp === 'number') pd._mvp = CFG.mvp;
    if (typeof pd._mw === 'number') pd._mw = CFG.mw;
    pd._isNewPlayer = 0;
    if (CFG.unlockAllModes) grantModes(pd);
    if (CFG.blueprintMax) grantBlueprints(pd);
    if (CFG.storyClear) clearStory(pd);
    if (CFG.unlockAllSkins) grantSkins(pd);
    grantTrollSkins(pd);
    if (!writeJSON(KEY_MAIN, pd)) return false;
    var cd = readJSON(KEY_CLOUD, null);
    if (cd) { grantCloud(cd); writeJSON(KEY_CLOUD, cd); }
    grantSaves();
    return true;
  }

  /* ------------------------- 存档导入导出 ------------------------- */
  function exportSave() {
    var dump = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k === BACKUP_KEY || k === GUEST_KEY || k === GAME_URL_KEY) continue;
      dump[k] = localStorage.getItem(k);
    }
    var txt = JSON.stringify(dump, null, 2);
    var name = 'lmz-save-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    try {
      var blob = new Blob([txt], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.parentNode.removeChild(a); }, 1000);
    } catch (e) {
      try { window.prompt('复制以下内容保存（' + name + '）:', txt); } catch (e2) {}
    }
    return name;
  }

  function importSave() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(inp);
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) { inp.parentNode.removeChild(inp); return; }
      var r = new FileReader();
      r.onload = function () {
        try {
          var dump = JSON.parse(r.result);
          if (!confirm('导入将覆盖当前存档，确定？')) return;
          Object.keys(dump).forEach(function (k) { localStorage.setItem(k, dump[k]); });
          alert('导入成功，刷新页面生效。');
        } catch (e) { alert('文件格式错误：' + e.message); }
        inp.parentNode.removeChild(inp);
      };
      r.readAsText(f);
    };
    inp.click();
  }

  /* ------------------------- 作弊菜单 UI ------------------------- */
  function closePanel() {
    var el = document.getElementById(PANEL_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function openPanel() {
    closePanel();
    if (!document.body) return;
    var gid = guestId();

    var mask = document.createElement('div');
    mask.id = PANEL_ID;
    mask.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;' +
      'background:rgba(0,0,0,.55);font:14px/1.7 -apple-system,system-ui,"PingFang SC",sans-serif;' +
      'color:#eee;display:flex;align-items:center;justify-content:center';

    var box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,390px);max-height:84vh;overflow-y:auto;background:#141821;' +
      'border:1px solid #2a3140;border-radius:12px;padding:14px 16px;-webkit-overflow-scrolling:touch';

    function row() {
      var r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
        'padding:8px 0;border-bottom:1px solid #232936';
      box.appendChild(r);
      return r;
    }
    function label(r, text, hint) {
      var l = document.createElement('div');
      l.innerHTML = '<div>' + text + '</div>' +
        (hint ? '<div style="color:#7d8798;font-size:11px">' + hint + '</div>' : '');
      r.appendChild(l);
    }
    function grid() {
      var g = document.createElement('div');
      g.style.cssText = 'display:flex;gap:8px;padding:8px 0';
      box.appendChild(g);
      return g;
    }
    function addBtn(parent, text, act, primary) {
      var b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = 'flex:1;padding:10px 6px;border-radius:8px;border:1px solid #2f3746;' +
        'cursor:pointer;font-size:13px;background:' + (primary ? '#3482ff;color:#fff' : '#1c212b;color:#ddd');
      b.onclick = function () { act(); };
      parent.appendChild(b);
      return b;
    }
    function need() {
      if (!readJSON(KEY_MAIN, null)) { alert('未找到存档，刷新页面后再试'); return false; }
      return true;
    }

    var h = document.createElement('div');
    h.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';
    h.innerHTML = '<b style="font-size:15px">猎梦者助手</b>';
    var cl = document.createElement('button');
    cl.textContent = 'X';
    cl.style.cssText = 'background:none;border:none;color:#8a93a3;font-size:18px;cursor:pointer';
    cl.onclick = closePanel;
    h.appendChild(cl);
    box.appendChild(h);

    var st = document.createElement('div');
    st.style.cssText = 'color:#8ab4f8;font-size:12px;margin-bottom:4px';
    box.appendChild(st);
    function paint() {
      var p = readJSON(KEY_MAIN, {}) || {};
      var c = readJSON(KEY_CLOUD, {}) || {};
      st.textContent = '金币 ' + (p._gold || 0) + ' · 碎片 ' + (p._fragment || 0) + ' · ' +
        (p._win || 0) + '胜 · 关卡 ' + (c.currGameLev || 0) + ' · 广告已挡 ' + adStats.blocked;
    }
    paint();

    var gidRow = row();
    label(gidRow, '游客模式', '无需账号，数据仅存本机');
    var gidSw = document.createElement('button');
    function paintGid() {
      gidSw.textContent = CFG.guestMode ? '已开启' : '已关闭';
      gidSw.style.cssText = 'padding:7px 18px;border-radius:8px;border:1px solid #2f3746;cursor:pointer;' +
        'font-size:13px;background:' + (CFG.guestMode ? '#1f6f3a;color:#7ee2a8' : '#3a2020;color:#e08a8a');
    }
    gidSw.onclick = function () { CFG.guestMode = !CFG.guestMode; paintGid(); };
    paintGid();
    gidRow.appendChild(gidSw);

    var gidInfo = document.createElement('div');
    gidInfo.style.cssText = 'color:#5f6a7a;font-size:10px;margin:-4px 0 4px;word-break:break-all';
    gidInfo.textContent = '游客 ID: ' + gid;
    box.appendChild(gidInfo);

    var adRow = row();
    label(adRow, '免激励视频', '拦截广告直接发放奖励');
    var adSw = document.createElement('button');
    function paintAd() {
      adSw.textContent = CFG.blockAds ? '已开启' : '已关闭';
      adSw.style.cssText = 'padding:7px 18px;border-radius:8px;border:1px solid #2f3746;cursor:pointer;' +
        'font-size:13px;background:' + (CFG.blockAds ? '#1f6f3a;color:#7ee2a8' : '#3a2020;color:#e08a8a');
    }
    adSw.onclick = function () {
      CFG.blockAds = !CFG.blockAds;
      if (CFG.blockAds) patchAds(); else restoreAds();
      paintAd(); paint();
    };
    paintAd();
    adRow.appendChild(adSw);

    var urlRow = row();
    label(urlRow, '游戏地址', '换游戏时可手动指定');
    var urlBtn = document.createElement('button');
    urlBtn.textContent = '设置';
    urlBtn.style.cssText = 'padding:7px 18px;border-radius:8px;border:1px solid #2f3746;cursor:pointer;' +
      'font-size:13px;background:#1c212b;color:#ddd';
    urlBtn.onclick = function () {
      var cur = localStorage.getItem(GAME_URL_KEY) || GAME_FALLBACK[0];
      var v = window.prompt('输入游戏页面地址（留空则用默认）：', cur);
      if (v === null) return;
      v = (v || '').trim();
      if (v) { localStorage.setItem(GAME_URL_KEY, v); alert('已保存，刷新后生效'); }
      else { localStorage.removeItem(GAME_URL_KEY); alert('已恢复默认'); }
    };
    urlRow.appendChild(urlBtn);

    var g0 = grid();
    addBtn(g0, '★ 完成新手流程', function () {
      if (!need()) return;
      var n = finishTutorial();
      alert('已写 ' + n + ' 个新手字段，刷新页面生效'); closePanel();
    }, true);

    var g1 = grid();
    addBtn(g1, '一键全刷', function () {
      if (!need()) return;
      if (applyAll()) { alert('已刷满，刷新页面生效'); closePanel(); }
    }, true);

    var g2 = grid();
    addBtn(g2, '金币/碎片', function () {
      if (!need()) return;
      var p = readJSON(KEY_MAIN);
      p._gold = CFG.gold; p._fragment = CFG.fragment; p._goldenKey = CFG.goldenKey;
      writeJSON(KEY_MAIN, p);
      alert('已刷金币/碎片，刷新生效'); closePanel();
    });
    addBtn(g2, '战绩/关卡', function () {
      if (!need()) return;
      var p = readJSON(KEY_MAIN), c = readJSON(KEY_CLOUD);
      p._win = CFG.win; p._lose = CFG.lose; p._mvp = CFG.mvp;
      writeJSON(KEY_MAIN, p);
      if (c) { grantCloud(c); writeJSON(KEY_CLOUD, c); }
      alert('已刷战绩/关卡，刷新生效'); closePanel();
    });

    var g3 = grid();
    addBtn(g3, '解锁模式', function () {
      if (!need()) return;
      var p = readJSON(KEY_MAIN);
      grantModes(p); writeJSON(KEY_MAIN, p); alert('6 个模式已解锁'); closePanel();
    });
    addBtn(g3, '解锁皮肤', function () {
      if (!need()) return;
      var p = readJSON(KEY_MAIN);
      grantSkins(p); grantTrollSkins(p); writeJSON(KEY_MAIN, p); alert('皮肤已全解锁'); closePanel();
    });

    var g4 = grid();
    addBtn(g4, '建筑满级', function () {
      if (!need()) return;
      var p = readJSON(KEY_MAIN);
      grantBlueprints(p); writeJSON(KEY_MAIN, p); alert('建筑蓝图已满级'); closePanel();
    });
    addBtn(g4, '剧情通关', function () {
      if (!need()) return;
      var p = readJSON(KEY_MAIN);
      clearStory(p); writeJSON(KEY_MAIN, p); alert('剧情地图已通关'); closePanel();
    });

    var g6 = grid();
    addBtn(g6, '导出存档', function () {
      var n = exportSave();
      alert('已导出：' + n + '\n存档仅存本机，建议定期备份。');
      closePanel();
    });
    addBtn(g6, '导入存档', function () { importSave(); closePanel(); });

    var g5 = grid();
    addBtn(g5, '备份当前', function () {
      localStorage.removeItem(BACKUP_KEY); backupOnce(); alert('已重新备份'); closePanel();
    });
    addBtn(g5, '恢复备份', function () { restoreBackup(); closePanel(); });

    var tip = document.createElement('div');
    tip.style.cssText = 'color:#6b7484;font-size:11px;margin-top:6px;line-height:1.5';
    tip.textContent = '全部修改仅作用于浏览器 localStorage，不上传任何数据。清理浏览器数据会丢失存档，请用「导出存档」备份。';
    box.appendChild(tip);

    mask.appendChild(box);
    mask.addEventListener('click', function (e) { if (e.target === mask) closePanel(); });
    var stop = function (e) { e.stopPropagation(); };
    mask.addEventListener('touchstart', stop, true);
    mask.addEventListener('touchmove', stop, true);
    box.addEventListener('touchstart', stop, true);
    box.addEventListener('touchmove', stop, true);
    document.body.appendChild(mask);
  }
  window.__lmzPanel = openPanel;

  /* ------------------------- 游戏内齿轮入口 -------------------------
   * 8 次迭代（详见 docs/05-脚本迭代史.md）：
   *   1 再挂 click -> 游戏原版也执行 -> 弹「网络出错」
   *   2 覆写 hitTest -> 该按钮类没有此方法 -> 无效
   *   3 自绘 CSS 图标 -> 视觉不统一
   *   4 覆盖层 + preventDefault -> 阻止 click 生成 -> 点不动
   *   5 覆写 btn.on -> 破坏游戏逻辑 -> 页面卡死
   *   6 覆盖层放入 layaContainer -> Laya 自有层消费触摸
   *   7 document 捕获监听 -> 合成事件通过，真机无效
   *   8 直接挂 mousedown -> OK
   * 关键：Laya.Event.MOUSE_DOWN 的值是字符串 'mousedown'（小写 d）。 */
  function findTop() {
    var top = null;
    (function find(n, d) {
      if (!n || top || d > 9) return;
      if (n.name === 'topBox') { top = n; return; }
      if (n.numChildren) for (var i = 0; i < n.numChildren; i++) find(n.getChildAt(i), d + 1);
    })(window.Laya && Laya.stage, 0);
    return top;
  }

  function bindGear(gear) {
    if (gear.__lmzBound) return;
    gear.__lmzBound = true;
    var fire = function (e) { if (e && e.stopPropagation) e.stopPropagation(); openPanel(); };
    var ev = gear._events || gear._$events;
    if (!ev) { ev = {}; gear._events = ev; }
    ev.click = [];
    if (!Array.isArray(ev.mousedown)) ev.mousedown = [];
    ev.mousedown.push({ __lmz: true, runWith: fire });
  }

  // ★ setChildIndex 是布局操作，每 250ms 调一次会让游戏重算整个 topBox 布局
  //   → 设置按钮与其他 topBox 子项被反复重排 → 表现为"设置/皮肤不显示"
  // 改为只在可见性被游戏关掉时才提层，且加 2 秒节流。
  var _lastLift = 0;
  function syncGear() {
    if (!CFG.menuInGame || !isGame() || !window.Laya || !Laya.stage) return;
    var top = findTop();
    if (!top) return;
    var gear = top.getChildByName('settingBtn');
    if (!gear) return;
    var need = false;
    if (!gear.visible) { gear.visible = true; need = true; }
    if (gear.alpha !== 1) { gear.alpha = 1; need = true; }
    var now = Date.now();
    if (need && now - _lastLift > 2000) {
      _lastLift = now;
      try {
        if (top.getChildIndex(gear) !== top.numChildren - 1) {
          top.setChildIndex(gear, top.numChildren - 1);
        }
      } catch (e) {}
    }
    if (!gear.__lmzBound) bindGear(gear);
  }

  /* ------------------------- 启动 ------------------------- */
  function boot() {
    if (window.__lmzBooted) return;      // 防止同帧重复启动
    window.__lmzBooted = true;
    if (CFG.guestMode) ensureGuestIdentity();
    patchAds();
    // ★ 进入即 = 已完成一局：不弹引导/公告板，模式与关卡直接是通关后的状态
    if (CFG.finishOnEnter) finishTutorial();
    setInterval(function () {
      if (CFG.guestMode) ensureGuestIdentity();
      if (CFG.blockAds) patchAds();   // 等 MetaH5Ad 加载出来再补，幂等
      killLogin();
      injectGame();
      syncGear();
    }, 500);                          // 250ms 太频，500ms 足够且不卡
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'F1') { e.preventDefault(); openPanel(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  // 兜底：某些浏览器（Via / Kiwi）在 document-end 不一定准时触发
  setTimeout(function () { if (!window.__lmzBooted) boot(); }, 3000);
})();
