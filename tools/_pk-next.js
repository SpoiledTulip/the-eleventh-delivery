const fs=require('fs'),path=require('path'),vm=require('vm');
const SRC=path.resolve(__dirname,'..','src');
function bs(){function noop(){}
  const prox=new Proxy({},{get:function(t,k){if(k==='createLinearGradient')return function(){return{addColorStop:noop}};if(k==='measureText')return function(){return{width:10}};return noop;},set:function(){return true;}});
  const sb={console,Math,Date,Object,Array,Infinity,NaN,JSON,Promise,String,Number,Boolean,isNaN,parseInt,parseFloat,Proxy,Set,Map,
    window:{addEventListener:noop,requestAnimationFrame:function(){return 0},Image:function(){},
      AudioContext:function(){return{state:'running',currentTime:0,sampleRate:44100,createBuffer:function(c,l){return{getChannelData:function(){return new Float32Array(l)}}},createBufferSource:function(){return{buffer:null,loop:false,connect:noop,start:noop,stop:noop}},createBiquadFilter:function(){return{type:'',frequency:{setValueAtTime:noop,exponentialRampToValueAtTime:noop},Q:{setValueAtTime:noop},connect:noop}},createOscillator:function(){return{frequency:{setValueAtTime:noop,exponentialRampToValueAtTime:noop},connect:noop,start:noop,stop:noop}},createGain:function(){return{gain:{setValueAtTime:noop,linearRampToValueAtTime:noop,exponentialRampToValueAtTime:noop},connect:noop}},destination:{},resume:noop}}},
    document:{getElementById:function(){return{getContext:function(){return prox},width:0,height:0,style:{}}},addEventListener:noop,createElement:function(){return{getContext:function(){return prox},style:{},appendChild:noop}}},
    performance:{now:function(){return Date.now()}},requestAnimationFrame:function(){return 0},
    setTimeout:setTimeout,clearTimeout:clearTimeout,setInterval:function(){return 0},clearInterval:noop,
    localStorage:{getItem:function(){return null},setItem:noop,removeItem:noop,clear:noop}};
  sb.Image=sb.window.Image;sb.globalThis=sb;vm.createContext(sb);return sb;}
const FILES=['levels.js','sprites.js','audio.js','physics.js','characters.js','device-mode.js','save.js','net.js','scooter.js','ai-rider.js','render.js','game.js','ui.js'];
const sb=bs();FILES.forEach(f=>vm.runInContext(fs.readFileSync(path.join(SRC,'js',f),'utf8'),sb,{filename:f}));
const run=c=>vm.runInContext(c,sb);
const res=run(`(function(){
  var out={};
  /* 开一局 PK */
  Save.reset(); Save.data.maxUnlocked=11;
  var ids=[]; listForLibrary().forEach(function(c){ids.push(c.id);}); Save.data.unlockedCharacters=ids;
  Game.isPk=true; Game.pkMyRole='kangaroo'; Game.aiRoles=['dragon']; Game.pkLevelIndex=0;
  Game.mode='local'; Game.playerCount=2;
  if (InputState.clearAI) InputState.clearAI();
  loadLevel(0); Game.state='playing';
  out.pk0 = { isPk:Game.isPk, players:Game.players.length, aiRoles:Game.aiRoles, lv:Game.level.name };

  /* 让玩家到终点（PK 判定） */
  var lv=Game.level;
  Game.players[0].x = lv.goal.x; Game.players[0].y = lv.goal.y;
  update(1/60);
  out.afterWin = { state:Game.state, pk:!!Game.pkResult,
                   winner: Game.pkResult ? (Game.pkResult.winnerIsAI?'AI':'玩家') : '-' };

  /* ★ 模拟"按空格接下一单" —— 走 startGame(next) 这条路 ★ */
  var next = (typeof nextLevelIndex==='function') ? nextLevelIndex(Game.levelIndex) : null;
  out.nextIdx = next;
  Game.skipWeatherBrief = true;
  startGame(next);
  Game.skipWeatherBrief = false;
  out.afterNext = { isPk:Game.isPk, aiRoles:Game.aiRoles, players:Game.players.length,
                    lv:Game.level.name, state:Game.state,
                    aiCount: Object.keys(InputState.aiInput).length };
  return out;
})()`);
console.log('开局: ' + JSON.stringify(res.pk0));
console.log('玩家到终点后: ' + JSON.stringify(res.afterWin));
console.log('按空格接下一单（next=' + res.nextIdx + '）后: ' + JSON.stringify(res.afterNext));
console.log();
const a=res.afterNext;
if(a.isPk===false && a.aiRoles===null && a.players===1) console.log('⇒ PK 状态被清了，下一关是**普通模式**（AI 不在了）');
else console.log('⇒ ⚠️ PK 状态还在！下一关**仍然是 PK**（AI 还在场上）');
