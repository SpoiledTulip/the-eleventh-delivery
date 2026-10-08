/* ============================================================
 * net.js — 联机层
 * ============================================================
 * 架构：房主权威（host-authoritative）
 *
 *   房主(host)                      客人(guest)
 *   ┌─────────────┐                 ┌─────────────┐
 *   │ 跑完整物理   │                 │ 只采集按键   │
 *   │ 两个角色都算 │◄── 客人按键 ────│ 上报到云端   │
 *   │             │─── 世界状态 ───►│ 插值显示     │
 *   └─────────────┘                 └─────────────┘
 *
 * 为什么房主权威：
 *   如果两边各算各的物理，位置会逐渐漂移，两个人看到的画面不一样。
 *   房主一个人算，结果广播出去，保证"世界只有一个真相"。
 *   代价：客人会有网络延迟（他按下去，自己屏幕上的人晚一点动）。
 *
 * 传输方式：轮询云数据库（80ms 一次）
 *   云服务没有 WebSocket，只有数据库读写，所以用轮询。
 *   ~80ms 轮询 ≈ 单程 40ms 延迟，合作游戏够用。
 *
 * 房间码：6 位大写字母+数字，避开容易混淆的 0/O/1/I。
 * ============================================================ */

const Net = {
  enabled: false,
  role: null,          // 'host' | 'guest' | null
  code: null,          // 房间码
  clientId: null,      // 本机唯一 id
  peerConnected: false,
  lastError: null,
  statusText: '未连接',

  // 轮询控制
  _pollTimer: null,
  _pollBusy: false,
  _pollStopped: true,
  _pollInterval: 60,
  _lastSeq: -1,

  // 房主：待发送给客人的世界快照
  _outState: null,
  // 客人：收到的最新世界快照 + 插值用
  remoteState: null,
  prevRemoteState: null,
  remoteAt: 0,
  // 客人：本地采集的按键
  localInput: { left: false, right: false, jump: false },

  // 按键"抢跑"用：上次上报的按键指纹 / 上次抢跑时刻
  _lastInputFp: '',
  _lastBurstAt: 0,

  POLL_MS: 60,
};

/* ---------------- 工具 ---------------- */

/* 生成 6 位房间码（避开易混字符 0 O 1 I L） */
function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* 本机 id（存在 localStorage，刷新不变） */
function getClientId() {
  let id = null;
  try { id = localStorage.getItem('waimai_client_id'); } catch (e) { id = null; }
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem('waimai_client_id', id); } catch (e) { /* 隐私模式忽略 */ }
  }
  return id;
}

/* 云客户端（SDK 加载后填入） */
let cloudClient = null;

/**
 * 初始化云服务客户端
 * @param {{endpoint:string, publishableKey:string}} publicConfig
 */
function initCloud(publicConfig) {
  if (!publicConfig || !publicConfig.endpoint || !publicConfig.publishableKey) {
    Net.lastError = '云服务配置缺失';
    return false;
  }
  if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud) {
    Net.lastError = '云 SDK 未加载';
    return false;
  }
  cloudClient = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    publishableKey: publicConfig.publishableKey,
  });
  Net.clientId = getClientId();
  return true;
}

/* ---------------- 房主：建房间 ---------------- */

async function hostRoom(publicConfig) {
  if (!cloudClient && !initCloud(publicConfig)) return null;

  Net.statusText = '正在创建房间…';
  const code = makeRoomCode();
  const { data, error } = await cloudClient.database
    .from('game_rooms')
    .insert({
      code: code,
      host_id: Net.clientId,
      level_id: 1,
      state: null,
      guest_input: null,
      command: null,
      seq: 0,
    })
    .select();

  if (error) {
    Net.lastError = '创建房间失败：' + (error.message || error.code || '未知错误');
    Net.statusText = '创建失败';
    return null;
  }

  Net.enabled = true;
  Net.role = 'host';
  Net.code = code;
  Net.peerConnected = false;
  Net._lastSeq = 0;
  Net.statusText = '房间已创建，等待朋友加入…';
  startPolling();
  return code;
}

/* ---------------- 客人：加入房间 ---------------- */

async function joinRoom(code, publicConfig) {
  if (!cloudClient && !initCloud(publicConfig)) return false;

  code = (code || '').trim().toUpperCase();
  if (code.length !== 6) {
    Net.lastError = '房间码应为 6 位';
    Net.statusText = '房间码错误';
    return false;
  }

  Net.statusText = '正在加入房间…';
  const { data, error } = await cloudClient.database
    .from('game_rooms')
    .select('code, host_id, guest_id, level_id, seq')
    .eq('code', code)
    .maybeSingle();

  if (error) {
    Net.lastError = '查询房间失败：' + (error.message || error.code);
    Net.statusText = '加入失败';
    return false;
  }
  if (!data) {
    Net.lastError = '房间不存在，请检查房间码';
    Net.statusText = '房间不存在';
    return false;
  }
  if (data.guest_id && data.guest_id !== Net.clientId) {
    Net.lastError = '房间已满（已有其他玩家）';
    Net.statusText = '房间已满';
    return false;
  }

  // 登记为客人
  const upd = await cloudClient.database
    .from('game_rooms')
    .update({ guest_id: Net.clientId, updated_at: new Date().toISOString() })
    .eq('code', code)
    .select();

  if (upd.error) {
    Net.lastError = '加入房间失败：' + (upd.error.message || upd.error.code);
    Net.statusText = '加入失败';
    return false;
  }

  Net.enabled = true;
  Net.role = 'guest';
  Net.code = code;
  Net.peerConnected = true;
  Net._lastSeq = data.seq || 0;
  Net.statusText = '已加入房间 ' + code;
  startPolling();
  return true;
}

/* ---------------- 轮询 ----------------
 *
 * ⚠️ 从 setInterval 改成「自己排下一次」的循环，原因：
 *
 * 原来用 setInterval(pollOnce, 80)：不管上一轮跑没跑完，到点就触发。
 * 而一轮 polling 要发 2 个 HTTP 请求。云服务单次往返实测 150~180ms，
 * 一轮就是 300ms+ —— 远超 80ms 的间隔。
 * 结果：定时器回调持续堆积，每个回调都在主线程上解析 JSON、
 * 跑 Promise 微任务，把游戏主循环挤得一顿一顿。
 *
 * 现在改成：**上一轮彻底结束后，再等 gap 毫秒才排下一轮**。
 * 天然不会堆积 —— 网络慢就自动降频，但绝不堵住主线程。
 *
 * ============ 实测性能基线（2026-10-05）============
 *   云数据库单次往返：读 155ms / 写 182ms / 并行读写 160ms
 *   所以：串行一轮 337ms → 并行一轮 160ms（提升 2.1 倍）
 *   这就是为什么 hostPoll/guestPoll 改成 Promise.all 并行发。
 *   理论极限约 6 次/秒 —— 瓶颈在云端 RTT，代码层面压不下去了。
 * ==================================================
 */
function startPolling() {
  stopPolling();
  Net._pollStopped = false;
  Net._pollInterval = Net.POLL_MS;
  schedulePoll(0);
}

/* ------------------------------------------------------------
 * ★ 按键"抢跑"机制（降低操作延迟的关键）★
 * ------------------------------------------------------------
 * 问题：如果只在固定轮询周期上报按键，客人按下后最多要等
 *       整个间隔（最坏 160ms）才会被发出去 —— 白白多等一拍。
 *
 * 做法：检测到按键状态**发生变化**时，立刻插一次上报，
 *       不用等下一个周期。
 *
 *       按键按下/松开是"稀疏事件"（不是每帧都变），
 *       所以额外请求很有限（人手动最多每秒几次），
 *       不会把云端打爆，但能把操作延迟砍掉最多一整拍。
 *
 * 只对客人生效（房主是本地权威，不需要上报自己的按键）。
 * ------------------------------------------------------------ */
function notifyLocalInputChanged() {
  if (!Net.enabled || Net.role !== 'guest') return;

  /* 计算当前按键指纹，和上次比 —— 变了才抢跑 */
  var inp = Net.localInput || { left: false, right: false, jump: false };
  var fp = (inp.left ? '1' : '0') + (inp.right ? '1' : '0') + (inp.jump ? '1' : '0');
  if (fp === Net._lastInputFp) return;
  Net._lastInputFp = fp;

  /* 如果当前正在进行一轮轮询，就让它自然结束（下面的 finally 会
   * 读到最新按键）；否则立刻插一轮"只上报按键"的轻请求。
   * 用一个短的节流防止滚筒式按键疯狂发请求。 */
  var now = performance.now();
  if (Net._lastBurstAt && now - Net._lastBurstAt < 40) return;
  Net._lastBurstAt = now;

  if (Net._pollBusy) return;   // 正在轮询，它这轮会带上最新按键
  sendInputBurst();
}

/* 把抢跑入口挂到 Net 上（game.js 里通过 Net.notifyInputChanged() 调用） */
Net.notifyInputChanged = notifyLocalInputChanged;

/* 只发"按键"的最小请求（不读状态，省一半流量和时间） */
async function sendInputBurst() {
  if (!cloudClient || !Net.code) return;
  try {
    await cloudClient.database
      .from('game_rooms')
      .update({ guest_input: Net.localInput, updated_at: new Date().toISOString() })
      .eq('code', Net.code);
  } catch (e) { /* 抢跑失败无所谓，下一次正常轮询会补上 */ }
}

function stopPolling() {
  Net._pollStopped = true;
  if (Net._pollTimer) {
    clearTimeout(Net._pollTimer);
    Net._pollTimer = null;
  }
}

/* 排下一次轮询（用 setTimeout 而非 setInterval —— 保证不堆积） */
function schedulePoll(delay) {
  if (Net._pollStopped) return;
  Net._pollTimer = setTimeout(pollOnce, delay);
}

async function pollOnce() {
  if (Net._pollStopped) return;
  if (!Net.enabled || !cloudClient) { schedulePoll(Net.POLL_MS); return; }

  const t0 = performance.now();
  Net._pollBusy = true;      // 标记：抢跑机制看到它就不重复发请求
  try {
    if (Net.role === 'host') await hostPoll();
    else if (Net.role === 'guest') await guestPoll();
    Net.lastError = null;
  } catch (e) {
    Net.lastError = '同步异常：' + (e && e.message ? e.message : e);
  } finally {
    Net._pollBusy = false;
  }

  const cost = performance.now() - t0;

  /* 间隔策略（基于实测：单轮并行读写约 160ms）：
   *
   * 既然单轮本身就要 160ms，它已经天然"限速"了。
   * 所以**跑完立刻排下一轮**（gap 取一个最小值兜底），
   * 让同步频率紧贴云端的物理极限。
   *
   * 只在单轮异常快（< 60ms，说明设了缓存或网络极好）时，
   * 才补一小段 gap，免得把云端打爆。
   *
   * 上限 400ms：网络真的差时别再雪上加霜，但也不能让画面彻底失联。 */
  let next = 0;
  if (cost < 60) next = 60 - cost;      // 太快 → 补一点间隔
  if (cost > 400) next = 60;            // 太慢 → 立刻重试（已经等够了）
  Net._pollInterval = cost + next;

  schedulePoll(next);
}

/* --- 房主轮询：读客人按键 + 广播世界状态 ---
 *
 * ⚠️ 性能优化：读和写**并行发**，不要串行 await。
 *
 * 原来写成 `const x = await 读; ... await 写;`，
 * 两个请求首尾相接 —— 每次往返 300~500ms 就是两倍延迟，
 * 实测同步频率被拖到只有 1.6 次/秒，客人看到的就是一卡一卡。
 *
 * 读（拿客人按键）和写（广播世界状态）之间**没有数据依赖**：
 * 写的是这一帧的世界快照，读的是客人的输入，互不等待。
 * 所以用 Promise.all 同时发，一轮耗时直接减半。
 */
async function hostPoll() {
  const updates = { updated_at: new Date().toISOString() };

  /* 广播世界状态（由 game.js 每帧填好 Net._outState） */
  if (Net._outState) {
    updates.state = Net._outState;
    updates.seq = (Net._lastSeq || 0) + 1;
    Net._lastSeq = updates.seq;
  }

  /* 读 + 写 同时发 —— 二者互不依赖 */
  const [readRes] = await Promise.all([
    cloudClient.database
      .from('game_rooms')
      .select('guest_id, guest_input, seq')
      .eq('code', Net.code)
      .maybeSingle(),
    cloudClient.database
      .from('game_rooms')
      .update(updates)
      .eq('code', Net.code),
  ]);

  const data = readRes && readRes.data;
  const error = readRes && readRes.error;
  if (error) { Net.lastError = error.message || String(error); return; }

  if (data && data.guest_id) {
    if (!Net.peerConnected) {
      Net.peerConnected = true;
      Net.statusText = '朋友已加入！';
      if (typeof onPeerJoined === 'function') onPeerJoined();
    }
    // 把客人的按键写进输入层（客人角色固定 dragon，与房主键位隔离）
    if (data.guest_input) {
      InputState.applyRemote('dragon', data.guest_input);
    }
  }
}

/* --- 客人轮询：上报按键 + 读世界状态 ---
 *
 * 同样：**读和写并行发**，一轮往返只花一次的时间。
 * 这样才能把同步频率从 1.6 次/秒提到 3 次/秒以上，
 * 配合外推插值，画面才跟得上。
 */
async function guestPoll() {
  // 上报自己的按键（Net.localInput 由 game.js 每帧更新）
  const inp = Net.localInput;

  const [readRes] = await Promise.all([
    cloudClient.database
      .from('game_rooms')
      .select('state, seq, command')
      .eq('code', Net.code)
      .maybeSingle(),
    cloudClient.database
      .from('game_rooms')
      .update({ guest_input: inp, updated_at: new Date().toISOString() })
      .eq('code', Net.code),
  ]);

  const data = readRes && readRes.data;
  const error = readRes && readRes.error;
  if (error) { Net.lastError = error.message || String(error); return; }

  if (data && data.state && data.seq !== Net._lastSeq) {
    Net._lastSeq = data.seq;
    Net.prevRemoteState = Net.remoteState;
    Net.remoteState = data.state;
    Net.remoteAt = performance.now();
    Net.peerConnected = true;
  }
}

/* ---------------- 退出 ---------------- */

async function leaveRoom() {
  const code = Net.code;
  const role = Net.role;
  stopPolling();
  Net.enabled = false;
  Net.role = null;
  Net.peerConnected = false;
  Net.remoteState = null;
  Net.prevRemoteState = null;
  Net.statusText = '未连接';

  if (cloudClient && code) {
    try {
      if (role === 'host') {
        // 房主离开 → 关闭房间
        await cloudClient.database.from('game_rooms').delete().eq('code', code);
      } else {
        // 客人离开 → 清掉自己的登记
        await cloudClient.database
          .from('game_rooms')
          .update({ guest_id: null, guest_input: null })
          .eq('code', code);
      }
    } catch (e) { /* 退出失败不阻塞 */ }
  }
  Net.code = null;
}

/* ---------------- 房主：把世界状态打包 ---------------- */

/**
 * 房主每帧调用，把当前世界状态做成快照。
 * 只发必要字段，减小体积（轮询带宽敏感）。
 */
function packWorldState() {
  return {
    levelId: Game.level ? Game.level.id : 1,
    levelIndex: Game.levelIndex,
    elapsed: +Game.elapsed.toFixed(2),
    coinsTaken: Game.coinsTaken,
    coinsTotal: Game.coinsTotal,
    coinsRequired: Game.coinsRequired,   // 过关金币门槛，客人要靠它显示 HUD / 判定
    gameState: Game.state,
    // 两个角色
    players: Game.players.map(function (p) {
      return {
        role: p.role,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx * 10) / 10,
        vy: Math.round(p.vy * 10) / 10,
        dir: p.dir,
        hearts: p.hearts,
        onGround: p.onGround,
        invuln: p.invuln,
        squash: Math.round(p.squash * 100) / 100,
        atGoal: p.atGoal,
      };
    }),
    // 机关状态（按钮亮没亮、门开没开）
    buttons: (Game.level ? Game.level.buttons : []).map(function (b) { return b.pressed ? 1 : 0; }),
    doorOpen: (Game.level ? Game.level.doors : []).map(function (d) { return +d.openAmount.toFixed(2); }),
    // 已吃金币（用下标表示）
    coinsTakenIdx: Game.level
      ? Game.level.coins.map(function (c, i) { return c.taken ? i : -1; }).filter(function (i) { return i >= 0; })
      : [],
    enemiesDead: Game.level
      ? Game.level.enemies.map(function (e, i) { return e.dead ? i : -1; }).filter(function (i) { return i >= 0; })
      : [],

    /* ---- 新机关的状态 ----
     * 这些机关都有"本地演化的状态"，客人必须跟着房主显示才一致，
     * 否则会出现"房主看到桥塌了、客人还站在桥上"这种诡异情况。 */
    // 断裂桥：0=完好 1=在震 2=已塌
    bridges: Game.level && Game.level.bridges
      ? Game.level.bridges.map(function (b) { return b.gone ? 2 : (b.pressed ? 1 : 0); })
      : [],
    // 可炸墙：1=已炸开
    wallsBroken: Game.level
      ? Game.level.solids.map(function (s, i) {
        return (s.destructible && s.broken) ? i : -1;
      }).filter(function (i) { return i >= 0; })
      : [],
    // 炸弹：0=未爆 1=已点燃 2=已爆
    bombs: Game.level && Game.level.bombs
      ? Game.level.bombs.map(function (b) { return b.exploded ? 2 : (b.lit ? 1 : 0); })
      : [],
    // 炸弹剩余引信（用于客人端显示倒计时数字）
    bombTimers: Game.level && Game.level.bombs
      ? Game.level.bombs.map(function (b) { return b.lit ? b.timer : -1; })
      : [],
    // 跷跷板角度（客人端用来画同样的倾角）
    seesawAngles: Game.level && Game.level.seesaws
      ? Game.level.seesaws.map(function (s) { return +s.angle.toFixed(3); })
      : [],
  };
}
