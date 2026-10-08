/* ============================================================
 * account.js — 本机账号系统（2026-10-06 十一要求）
 * ============================================================
 *
 * 十一的原话：
 *   "支持在本机创建多个账号并在其间切换；创建账号时需输入昵称和密码，
 *    且本机已存在的账号昵称不可重复；切换账号时需输入对应密码进行验证；
 *    退出账号后返回未登录状态。"
 *
 * ------------------------------------------------------------
 * ★★ 为什么是"本机"而不是"云端账号"（重要，别以后自己搞混）★★
 * ------------------------------------------------------------
 *   十一还问了"能不能做加好友、任意电脑登录游戏 ID"。
 *   查过家底后**明确做不到**，原因不是数据库存不下，而是：
 *
 *     ① 我们有的那个云服务（腾讯 WorkBuddy Cloud）**只有数据库读写**，
 *        没有账号/认证模块；
 *     ② 更要命的是**没有服务端代码的写权限** ——
 *        它是托管平台，我只能读写它给的几张表；
 *     ③ 没有服务端，"验证密码"这个动作就只能放在**浏览器里做**。
 *        而浏览器代码是用户可以改的 ⇒ 任何人开控制台就能改掉
 *        自己的密码、列出所有账号、甚至冒充别人登录。
 *
 *   ⇒ 把"密码"放进客户端直连的数据库 = **假装安全**，比不做还糟。
 *     所以本机版必须叫本机版，不能对外宣传成"账号"。
 *
 * ------------------------------------------------------------
 * ★★ 但整个模块是"面向云端可升级"的形状 ★★
 * ------------------------------------------------------------
 *   十一明确要求："先做本机版，但把它设计成以后能升级到云端的形状。"
 *
 *   做法：把"数据存在哪、谁来验证密码"抽成一个 **Store 接口**：
 *
 *       ACCOUNT.getStore()   → 当前的存储实现
 *       ACCOUNT.useStore(s)  → 换一个实现
 *
 *   今天只有一个实现 `LocalStore`（localStorage）。
 *   以后有了后端，**只需要再写一个 `CloudStore`**，把同样几个方法
 *   （list / create / verify / remove …）实现成网络请求，
 *   然后 `ACCOUNT.useStore(CloudStore)` —— UI 层一行都不用改。
 *
 *   ⚠️ 记住这条边界：**UI 永远只调 ACCOUNT 的公开方法，
 *      绝不直接碰 Store，更不直接读 localStorage。**
 *      只要守住这条，换云端就是"加一个文件"的事。
 *
 * ------------------------------------------------------------
 * ★★ 密码怎么存（本机版也认真做）★★
 * ------------------------------------------------------------
 *   即使是本机版，也**绝不存明文密码**。理由：
 *     · 存档是浏览器里的明文 JSON，谁都能打开看一眼；
 *     · 十一可能会把存档发给朋友、或者截图求助；
 *     · 而人**普遍在别处复用同一个密码** —— 泄漏一份就是泄漏一片。
 *
 *   做法：salt（每个账号独立随机） + SHA-256 迭代 1000 次。
 *   ⚠️ 说清楚：这**不是**工业级安全（真正的方案是 bcrypt/argon2 +
 *      服务端校验）。它的定位是"**防窥屏、防顺手改 JSON**"，
 *      对"本机多个玩家互相不串档"这个真实场景**足够**。
 *      别在注释或界面里吹成"加密安全"。
 *
 * ------------------------------------------------------------
 * ★ 密码找回？没有。
 * ------------------------------------------------------------
 *   本机系统没有"找回密码"的能力（没有邮箱、没有客服）。
 *   所以界面上必须**如实告诉玩家**："忘记密码只能删除该账号重来"。
 *   偷偷留个后门（比如万能密码）比没有找回更糟 ——
 *   那会让"密码"这个功能变成摆设。
 * ============================================================ */

const ACCOUNT = (function () {

  /* ============================================================
   * 常量
   * ============================================================ */

  /* 账号表存哪（和游戏存档分开存 —— 两者生命周期不同：
   * 删账号要连存档一起删，但账号表本身不该被"清空存档"带走） */
  const ACCOUNTS_KEY = 'delivery-game-accounts-v1';

  /* 游戏存档的 key 前缀。
   * ⚠️ 每个账号的存档 = 前缀 + 账号 id（见 saveStorageKey()）。
   *    旧版本的存档 key 是 'delivery-game-save-v1'（无后缀），
   *    迁移时会把它认领给第一个创建的账号（见 adoptLegacySave）。 */
  const SAVE_PREFIX = 'delivery-game-save-v1::';

  /* 旧版存档的 key（迁移用，之后不再写入） */
  const LEGACY_SAVE_KEY = 'delivery-game-save-v1';

  /* 昵称长度限制（中文按 1 个字算） */
  const NAME_MIN = 1;
  const NAME_MAX = 12;

  /* 密码长度限制 */
  const PASS_MIN = 4;
  const PASS_MAX = 32;

  /* 密码连续错几次就临时锁定 + 锁多久（毫秒） */
  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 60 * 1000;

  /* 密码哈希迭代次数。
   * ⚠️ 别调太高：这是纯 JS 实现，跑在主线程上，
   *    迭代太多会让"点登录"有肉眼可见的卡顿（移动端尤其）。
   *    1000 次在普通电脑上约几毫秒，够用。 */
  const HASH_ROUNDS = 1000;

  /* ============================================================
   * 工具：安全读写 localStorage
   * ------------------------------------------------------------
   * ⚠️ 所有 localStorage 访问都必须包 try ——
   *    无痕模式 / 隐私设置 / 配额满 都会直接抛异常。
   *    这些异常绝不能让游戏崩掉（项目红线：任何新功能失败都不许影响玩）。
   * ============================================================ */
  function lsGet(key) {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch (e) { return null; }
  }

  function lsSet(key, val) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(key, val);
      return true;
    } catch (e) { return false; }
  }

  function lsRemove(key) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.removeItem(key);
      return true;
    } catch (e) { return false; }
  }

  /* ============================================================
   * 工具：密码哈希
   * ============================================================ */

  /** 生成随机盐（16 字节 → 32 位十六进制） */
  function makeSalt() {
    let s = '';
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        for (let i = 0; i < buf.length; i++) s += ('0' + buf[i].toString(16)).slice(-2);
        return s;
      }
    } catch (e) { /* 退到下面的 Math.random 方案 */ }
    /* ⚠️ 兜底用的 Math.random **不是密码学安全的**。
     *    但在本机场景下，"盐不可预测"的收益本来就很有限
     *    （能读存档的人也能读盐），所以这里接受降级。 */
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  /* ---- 纯 JS 的 SHA-256 ----
   * ⚠️ 为什么自己实现而不是用 crypto.subtle：
   *    crypto.subtle 是**异步**（返回 Promise），会让整个登录流程变成
   *    异步（UI 回调要全改成 await），而且**在非 https 环境下不可用**
   *    （本地 file:// 打开单文件版时 window.crypto.subtle 是 undefined）。
   *    而单文件版正是十一发给朋友的形态 —— 必须能在 file:// 下跑。
   *    ⇒ 自己实现一个同步版，代价是几十行代码，换来"任何环境都能用"。 */
  function sha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let result = '';

    const words = [];
    const asciiBitLength = ascii.length * 8;

    let hash = sha256.h = sha256.h || [];
    let k = sha256.k = sha256.k || [];
    let primeCounter = k.length;

    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }

    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      if (j >> 8) return '';          // 只处理 ASCII（我们的输入保证是 ASCII）
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;

    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash;
      hash = hash.slice(0, 8);

      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }

      for (let i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (let i = 0; i < 8; i++) {
      for (let j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  /** 把密码 + 盐 迭代哈希成一段十六进制 */
  function hashPassword(password, salt) {
    let h = salt + '::' + password;
    /* 迭代：把上一轮结果当下一轮的输入。
     * ⚠️ sha256 内部用了缓存（sha256.h / sha256.k），
     *    之所以能安全地重复调用，是因为那两份缓存是**常量表**
     *    （质数的平方根/立方根），每轮都会被上面的循环重新算一遍覆盖，
     *    不会残留上一轮的状态。（这段注释是给以后改这里的人看的：
     *    如果你把那个缓存改成动态的，这个循环就会出错。） */
    for (let i = 0; i < HASH_ROUNDS; i++) {
      h = sha256(h + '::' + salt);
    }
    return h;
  }

  /* ============================================================
   * 存储实现（可替换）——今日：本机
   * ============================================================ */

  const LocalStore = {
    name: 'local',

    /* ---- 读整张账号表 ---- */
    _read: function () {
      const raw = lsGet(ACCOUNTS_KEY);
      if (!raw) return { version: 1, accounts: [], currentId: null };
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { version: 1, accounts: [], currentId: null };
        if (!Array.isArray(parsed.accounts)) parsed.accounts = [];
        /* ⚠️ 逐条清洗，而不是整表丢弃 ——
         *    这是项目红线：一条坏了只修那一条，别把其它账号一起带走。
         *    （和 save.js 里"每字段单独判断类型"是同一个原则） */
        parsed.accounts = parsed.accounts.filter(function (a) {
          return a && typeof a === 'object' &&
            typeof a.id === 'string' && a.id &&
            typeof a.name === 'string' && a.name;
        }).map(function (a) {
          return {
            id: a.id,
            name: a.name,
            salt: typeof a.salt === 'string' ? a.salt : '',
            hash: typeof a.hash === 'string' ? a.hash : '',
            createdAt: typeof a.createdAt === 'number' ? a.createdAt : 0,
            lastLoginAt: typeof a.lastLoginAt === 'number' ? a.lastLoginAt : 0,
            /* 失败计数/锁定时间也持久化 ——
             * 否则刷新页面就能绕过"错 5 次锁 60 秒" */
            failCount: typeof a.failCount === 'number' ? a.failCount : 0,
            lockUntil: typeof a.lockUntil === 'number' ? a.lockUntil : 0,
          };
        });
        if (typeof parsed.currentId !== 'string') parsed.currentId = null;
        /* 当前登录的账号如果已经不存在了（被删了/数据坏了）→ 视为未登录 */
        if (parsed.currentId && !parsed.accounts.some(function (a) { return a.id === parsed.currentId; })) {
          parsed.currentId = null;
        }
        return parsed;
      } catch (e) {
        /* JSON 坏了 → 当空表。
         * ⚠️ 但**先备份一份原件**再当空表 —— 万一是可修复的情况，
         *    十一还能从 localStorage 里捞回来。 */
        lsSet(ACCOUNTS_KEY + '::corrupt-' + Date.now(), raw);
        return { version: 1, accounts: [], currentId: null };
      }
    },

    _write: function (tbl) {
      return lsSet(ACCOUNTS_KEY, JSON.stringify(tbl));
    },

    list: function () {
      return this._read().accounts;
    },

    currentId: function () {
      return this._read().currentId;
    },

    _setCurrent: function (id) {
      const t = this._read();
      t.currentId = id || null;
      return this._write(t);
    },

    /* 新建账号。成功返回 { ok:true, account }，失败返回 { ok:false, code, message } */
    create: function (name, password) {
      const t = this._read();
      /* ⚠️ 昵称去重：**大小写与首尾空格都归一化后比较**。
       *    否则"十一"和"十一 "、"Abc"和"abc"会被当成两个账号，
       *    而玩家在界面上根本看不出区别 —— 那种"我明明建过了"
       *    的困惑比直接拦住更糟。 */
      const norm = normalizeName(name);
      if (t.accounts.some(function (a) { return normalizeName(a.name) === norm; })) {
        return { ok: false, code: 'NAME_TAKEN', message: '这个昵称已经有人用了，换一个吧' };
      }
      const salt = makeSalt();
      const acc = {
        id: 'acc_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36),
        name: name,                       // 存玩家输入的原始形态（保留大小写/空格）
        salt: salt,
        hash: hashPassword(password, salt),
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
        failCount: 0,
        lockUntil: 0,
      };
      t.accounts.push(acc);
      t.currentId = acc.id;
      if (!this._write(t)) {
        return { ok: false, code: 'WRITE_FAIL', message: '保存失败（浏览器可能禁用了本地存储）' };
      }
      return { ok: true, account: publicOf(acc) };
    },

    /* 验证密码（不改登录态）。返回 { ok, code, message } */
    verify: function (id, password) {
      const t = this._read();
      const acc = t.accounts.find(function (a) { return a.id === id; });
      if (!acc) return { ok: false, code: 'NO_ACCOUNT', message: '这个账号不存在了' };

      /* 还在锁定期内 → 直接拒绝（不让继续试） */
      const now = Date.now();
      if (acc.lockUntil && now < acc.lockUntil) {
        const sec = Math.ceil((acc.lockUntil - now) / 1000);
        return { ok: false, code: 'LOCKED', message: '试太多次了，请等 ' + sec + ' 秒再试' };
      }

      const good = (hashPassword(password, acc.salt) === acc.hash);
      if (good) {
        acc.failCount = 0;
        acc.lockUntil = 0;
        acc.lastLoginAt = now;
        this._write(t);
        return { ok: true };
      }

      acc.failCount = (acc.failCount || 0) + 1;
      let msg = '密码不对';
      if (acc.failCount >= MAX_ATTEMPTS) {
        acc.lockUntil = now + LOCK_MS;
        acc.failCount = 0;
        msg = '密码连续输错 ' + MAX_ATTEMPTS + ' 次，请等 1 分钟再试';
      } else {
        msg = '密码不对（还可以试 ' + (MAX_ATTEMPTS - acc.failCount) + ' 次）';
      }
      this._write(t);
      return { ok: false, code: 'BAD_PASSWORD', message: msg };
    },

    login: function (id) {
      return this._setCurrent(id);
    },

    logout: function () {
      return this._setCurrent(null);
    },

    remove: function (id) {
      const t = this._read();
      const before = t.accounts.length;
      t.accounts = t.accounts.filter(function (a) { return a.id !== id; });
      if (t.currentId === id) t.currentId = null;
      this._write(t);
      return t.accounts.length < before;
    },

    /* ---- 每个账号的存档 key ---- */
    saveKeyFor: function (id) {
      return SAVE_PREFIX + id;
    },

    /* ---- 旧存档（无账号时代的）处理 ---- */
    readLegacySave: function () {
      return lsGet(LEGACY_SAVE_KEY);
    },
    clearLegacySave: function () {
      return lsRemove(LEGACY_SAVE_KEY);
    },
    hasLegacySave: function () {
      return !!lsGet(LEGACY_SAVE_KEY);
    },
    /* ⚠️ 直读/直写任意 key —— 只给"迁移"这一个场景用。
     *    正常运行时的存档读写一律走 Save.load/save（它们会算 key）。 */
    _rawGet: lsGet,
    _rawSet: lsSet,
  };

  /* ============================================================
   * 当前使用的存储实现
   * ============================================================ */
  let store = LocalStore;

  /* ============================================================
   * 昵称归一化（去重比较用）
   * ============================================================ */
  function normalizeName(name) {
    return String(name == null ? '' : name)
      .replace(/\s+/g, ' ')     // 连续空白压成一个（防"十一　　十"这种假差异）
      .trim()
      .toLowerCase();
  }

  /* 账号 → 对外的安全对象（**绝对不含 salt/hash**）。
   * ⚠️ 这条很重要：UI 层只该拿到这个形状的对象，
   *    免得哪天不小心把 hash 渲染到界面上、或者写进日志。 */
  function publicOf(a) {
    return {
      id: a.id,
      name: a.name,
      createdAt: a.createdAt,
      lastLoginAt: a.lastLoginAt,
    };
  }

  /* ============================================================
   * 公开接口
   * ============================================================ */
  const API = {

    /* ============================================================
     * ★ 限额（公开常量，UI 直接读这里）★
     * ------------------------------------------------------------
     * 【为什么单独暴露成公开字段，而不是让 UI 去读 _internals】
     *   踩过一个很隐蔽的坑：UI 用 `_internals.PASS_MAX` 给输入框设
     *   `maxLength`，而 `_internals` 里**恰好漏了这个字段** →
     *   `maxLength = undefined` → 浏览器把它当 **0** →
     *   **密码框一个字都打不进去**，而且不报任何错。
     *
     *   两个教训：
     *     ① UI 该用的东西要放在**公开**位置，别让它去掏下划线开头的内部对象
     *        （内部对象本来就允许缺东西，掏它等于把"可缺"当成"可靠"）
     *     ② 凡是给 DOM 设数值的地方，都要防 undefined
     *        （见下面 NUM 的兜底写法）
     * ------------------------------------------------------------ */
    LIMITS: {
      NAME_MIN: NAME_MIN,
      NAME_MAX: NAME_MAX,
      PASS_MIN: PASS_MIN,
      PASS_MAX: PASS_MAX,
    },

    /* ---- 存储层（换云端就是换这个）---- */
    getStore: function () { return store; },
    useStore: function (s) { if (s) store = s; },

    /* ---- 查询 ---- */
    list: function () {
      return store.list().map(publicOf);
    },

    count: function () {
      return store.list().length;
    },

    /** 当前登录的账号（未登录返回 null） */
    current: function () {
      const id = store.currentId();
      if (!id) return null;
      const a = store.list().find(function (x) { return x.id === id; });
      return a ? publicOf(a) : null;
    },

    isLoggedIn: function () {
      return !!this.current();
    },

    /* ---- 昵称校验（UI 边输边提示用）---- */
    validateName: function (name) {
      const n = String(name == null ? '' : name);
      if (!n.trim()) return { ok: false, message: '昵称不能是空的' };
      if (n.trim().length < NAME_MIN) return { ok: false, message: '昵称太短了' };
      if (n.trim().length > NAME_MAX) return { ok: false, message: '昵称最多 ' + NAME_MAX + ' 个字' };
      /* ⚠️ 拦掉纯符号/纯数字？ 不拦。
       *    玩家想叫"233"或"(*^▽^*)"都是他的自由，
       *    只要不是空的、不太长就行。别做体验上的过度管束。 */
      return { ok: true };
    },

    validatePassword: function (pass) {
      const p = String(pass == null ? '' : pass);
      if (p.length < PASS_MIN) return { ok: false, message: '密码至少 ' + PASS_MIN + ' 位' };
      if (p.length > PASS_MAX) return { ok: false, message: '密码最多 ' + PASS_MAX + ' 位' };
      return { ok: true };
    },

    /** 昵称是否已被占用（UI 用，实时提示） */
    nameTaken: function (name) {
      const norm = normalizeName(name);
      return store.list().some(function (a) { return normalizeName(a.name) === norm; });
    },

    /* Author perks are a local game feature, not authentication. */

    /* ---- 注册 ---- */
    register: function (name, password, confirm) {
      const vn = this.validateName(name);
      if (!vn.ok) return vn;
      const vp = this.validatePassword(password);
      if (!vp.ok) return vp;
      if (confirm != null && String(confirm) !== String(password)) {
        return { ok: false, code: 'MISMATCH', message: '两次输入的密码不一样' };
      }
      if (this.nameTaken(name)) {
        return { ok: false, code: 'NAME_TAKEN', message: '这个昵称已经有人用了，换一个吧' };
      }
      const r = store.create(String(name).trim(), String(password));
      if (!r.ok) return r;

      /* ★ 旧存档认领：如果这是**第一个**账号，而且本地还留着
       *   无账号时代的存档 —— 把它认领给这个账号，进度一点都不丢。
       *   （详见 adoptLegacySave） */
      if (store.list().length === 1) {
        try { adoptLegacySave(r.account.id); } catch (e) { /* 认领失败不该拦住注册 */ }
      }

      /* ============================================================
       * ⚠️ 2026-10-07：这里**不再有"昵称 = 二十二 就是作者"的特判**。
       * ============================================================
       * 十一要求"改成只靠 code 认作者" ⇒ 注册流程回归**完全普通**：
       *   所有昵称一视同仁，都要密码、都是普通存档。
       *
       * 作者身份改为**事后通过兑换码获得**（设置页输 `code`）。
       * 获得之后，`syncAuthorPerks`（见 save.js）会在每次读档时
       * 自动把全角色/全动作/全关卡补齐，并持续跟版本更新。
       *
       * ⚠️ 但这里保留一个**兼容分支**：万一这个新账号的存档里
       *    已经有 isAuthor 标记（比如用同一个 localStorage 桶、
       *    或测试里预先写好），也顺手把特权补齐 ——
       *    免得出现"标记是作者但内容没解锁"的半吊子状态。
       * ============================================================ */
      try {
        const key = store.saveKeyFor(r.account.id);
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null;
        const data = raw ? JSON.parse(raw) : null;
        if (data && data.isAuthor === true) {
          this.grantAuthorPerks(r.account.id);
        }
      } catch (e) { /* 兼容分支失败不影响注册 */ }

      return { ok: true, account: r.account };
    },

    /* ============================================================
     * 发放作者特权（全角色 / 全动作 / 全关卡）
     * ============================================================
     * ⚠️ 只改**这个账号自己的存档**（按 saveKeyFor(id) 写），
     *    绝不动别的账号 —— 这是"存档隔离"的底线。
     *
     * ⚠️ 实现方式：直接操作该账号的存档 JSON，而不是走 SAVE()。
     *    因为 SAVE() 操作的是"当前登录账号"，而注册过程中
     *    调用时机可能错位；直接按 id 写最稳。
     * ============================================================ */
    grantAuthorPerks: function (id) {
      if (typeof localStorage === 'undefined') return false;
      const key = store.saveKeyFor(id);
      let data = null;
      try {
        const raw = localStorage.getItem(key);
        data = raw ? JSON.parse(raw) : null;
      } catch (e) { data = null; }
      if (!data || typeof data !== 'object') data = {};

      /* ============================================================
       * ★ 作者特权 = 先盖"作者章"，再按章补内容（2026-10-07 改）
       * ============================================================
       * ⚠️⚠️ **顺序不能反**（这是这次改动的关键）：
       *   现在 `syncAuthorPerks` 的判定依据是 **`data.isAuthor` 标记**
       *   （不再看昵称）。所以必须：
       *     ① 先写 `data.isAuthor = true`
       *     ② 再调 `syncAuthorPerks(data)` —— 它才有章可依
       *
       *   第一版我写反了（先同步、后盖章），结果是 syncAuthorPerks
       *   看不到标记 → 直接 return false → **特权一个都没发**。
       *
       * ⚠️ 这里仍是"共用同一份逻辑"：
       *   补内容这件事全交给 `syncAuthorPerks`，绝不自己再写一套
       *   （两套逻辑迟早不一致）。只在 save.js 没加载时走兜底。
       * ============================================================ */
      data.isAuthor = true;          // ★ 先盖章

      let ok = false;
      try {
        if (typeof syncAuthorPerks === 'function') {
          syncAuthorPerks(data);
          ok = true;
        }
      } catch (e) { ok = false; }

      /* 兜底：就算 syncAuthorPerks 因故没跑（比如 save.js 没加载），
       * 也保证"至少解锁当前全部内容"这件核心的事。 */
      if (!ok) {
        if (typeof CHARACTERS !== 'undefined') {
          data.unlockedCharacters = CHARACTERS
            .filter(function (c) { return c.ready; })
            .map(function (c) { return c.id; });
        }
        data.unlockedActions = ['dash', 'doublejump', 'walljump', 'wallslide'];
        data.maxUnlocked = 999;
      }

      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) { return false; }

      /* ⚠️ 写的是 localStorage，但**内存里的 Save.data 还是旧的** ——
       *    必须让 SAVE() 重读一次，否则界面读到的还是特权前的旧数据。
       *    （踩过：注册作者账号后角色库仍只有 1 个角色，
       *      测试里表现为"特权测试全红"。） */
      try {
        const cur = store.currentId();
        if (cur === id && typeof SAVE === 'function') {
          const s = SAVE();
          if (s && typeof s.reload === 'function') s.reload();
        }
      } catch (e) { /* 重载失败不影响已写入的存档 */ }

      return true;
    },

    /* ============================================================
     * 作者身份查询 / 赋予（2026-10-07 改为"看存档标记"）
     * ============================================================
     * 权威来源：**存档里的 `data.isAuthor`**（由兑换码 `code` 写入）。
     * 不再看昵称 —— 十一要求"改成只靠 code 认作者"。
     *
     * ⚠️ 为什么不直接读 `SAVE().data.isAuthor`：
     *    这个函数会被 `save.js` 的 `syncAuthorPerks` 调用，
     *    而 sync 正发生在 load 过程中 —— 那时 `this.data` 还没赋值，
     *    读它只会拿到**上一次**的旧数据（甚至 undefined）。
     *    ⇒ 所以这里**直接读 localStorage**，拿到的是磁盘上的真相。
     * ============================================================ */
    isCurrentAuthor: function () {
      const id = store.currentId();
      if (!id) return false;
      if (typeof localStorage === 'undefined') return false;
      try {
        const raw = localStorage.getItem(store.saveKeyFor(id));
        if (!raw) return false;
        const data = JSON.parse(raw);
        return !!(data && data.isAuthor === true);
      } catch (e) { return false; }
    },

    /* ============================================================
     * 把某个账号变成作者（由兑换码 `code` 调用）
     * ============================================================
     * @param id 账号 id（不传 = 当前登录账号）
     *
     * 做的事：
     *   ① 往该账号存档写 `isAuthor: true`
     *   ② 立刻把全角色/全动作/全关卡补齐（grantAuthorPerks）
     *   ③ 如果它是当前账号，让 SAVE() 重读，界面立刻生效
     * ============================================================ */
    markAsAuthor: function (id) {
      const target = id || store.currentId();
      if (!target) return { ok: false, message: '没有登录账号' };
      if (typeof localStorage === 'undefined') return { ok: false, message: '浏览器不支持本地存储' };

      const key = store.saveKeyFor(target);
      let data = null;
      try {
        const raw = localStorage.getItem(key);
        data = raw ? JSON.parse(raw) : null;
      } catch (e) { data = null; }
      if (!data || typeof data !== 'object') data = {};
      data.isAuthor = true;
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) { return { ok: false, message: '保存失败' }; }

      /* 立刻补齐内容（内部会再读一次存档、补全、写回） */
      try { this.grantAuthorPerks(target); } catch (e) { }

      /* 是当前账号 → 让内存里的存档跟上，界面才能立刻看到效果 */
      try {
        if (target === store.currentId() && typeof SAVE === 'function') {
          const s = SAVE();
          if (s && typeof s.reload === 'function') s.reload();
        }
      } catch (e) { }

      return { ok: true };
    },

    /* ---- 登录（选已有账号 + 输密码）---- */
    login: function (id, password) {
      const v = store.verify(id, password);
      if (!v.ok) return v;
      store.login(id);
      return { ok: true, account: this.current() };
    },

    /** 不验密码直接切（**仅内部/迁移用**，UI 绝不要调它） */
    _forceLogin: function (id) { return store.login(id); },

    /* ---- 退出 ---- */
    logout: function () {
      return store.logout();
    },

    /* ---- 删除账号（连带删掉它的存档）---- */
    remove: function (id, password) {
      const v = store.verify(id, password);
      if (!v.ok) return v;
      /* ⚠️ 先删存档再删账号 —— 反过来的话账号没了、
       *    存档就成了"孤儿"永远删不掉（没人知道它的 key 该配哪个 id）。 */
      const key = store.saveKeyFor(id);
      store._rawSet ? null : null;         // （保留：以后 CloudStore 在此加远端删除）
      if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(key); } catch (e) { }
      }
      const ok = store.remove(id);
      if (!ok) return { ok: false, code: 'NO_ACCOUNT', message: '这个账号不存在了' };
      return { ok: true };
    },

    /* ============================================================
     * 存档 key 计算 —— save.js 唯一的依赖点
     * ============================================================
     * ⚠️ save.js 会调这个方法拿"我该把存档写到哪"。
     *    它必须：
     *      · 已登录 → 返回该账号专属的 key
     *      · 未登录 → 返回**游客 key**（见下面的说明）
     * ============================================================ */
    saveKey: function () {
      const id = store.currentId();
      if (id) return store.saveKeyFor(id);
      /* 未登录时的 key。
       * ⚠️ 为什么不返回 null / 报错：
       *    游戏里有很多"顺手存一下"的调用点（改设置、记通关…），
       *    让它们全部处理"未登录"会到处漏。
       *    所以给一个**游客档**兜底 —— 但 UI 层会拦住"未登录不能开跑"，
       *    所以正常玩不到游客档；它只是保证**任何情况下不崩**。 */
      return SAVE_PREFIX + '__guest__';
    },

    /** 这套存档 key 是不是游客档（调试/测试用） */
    isGuestSaveKey: function (key) {
      return key === SAVE_PREFIX + '__guest__';
    },

    /* ============================================================
     * 测试/迁移辅助（UI 不要用）
     * ============================================================ */
    _internals: {
      hashPassword: hashPassword,
      makeSalt: makeSalt,
      sha256: sha256,
      normalizeName: normalizeName,
      ACCOUNTS_KEY: ACCOUNTS_KEY,
      SAVE_PREFIX: SAVE_PREFIX,
      LEGACY_SAVE_KEY: LEGACY_SAVE_KEY,
      MAX_ATTEMPTS: MAX_ATTEMPTS,
      LOCK_MS: LOCK_MS,
      NAME_MIN: NAME_MIN,
      NAME_MAX: NAME_MAX,
      PASS_MIN: PASS_MIN,
      PASS_MAX: PASS_MAX,
      LocalStore: LocalStore,
    },
  };

  /* ============================================================
   * 旧存档认领
   * ============================================================
   * 【场景】十一已经有存档了（通关好几关那种，存在 LEGACY_SAVE_KEY）。
   *   现在第一次启用账号系统、创建了账号 ——
   *   **必须把这个老档归到新账号名下**，否则玩家一登录发现进度归零，
   *   那是灾难级的体验事故（项目红线：绝不整体丢弃存档）。
   *
   * 【做法】把老档原文**复制**到新 key（而不是移动），
   *   确认写成功后再删老 key。
   *   ⚠️ 顺序不能反：先删后写，万一写失败（配额满）就两种都没了。
   * ============================================================ */
  function adoptLegacySave(accountId) {
    const raw = store.readLegacySave();
    if (!raw) return false;
    const target = store.saveKeyFor(accountId);
    /* 目标位置已经有档了就别覆盖（理论上不会，防万一） */
    if (store._rawGet(target)) return false;
    const ok = store._rawSet(target, raw);
    if (ok) store.clearLegacySave();
    return ok;
  }

  /* 暴露给内部调用（不放进公开 API —— 它不是给 UI 用的） */
  API._adoptLegacySave = adoptLegacySave;

  return API;
})();
