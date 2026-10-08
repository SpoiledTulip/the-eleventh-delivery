/* 临时：真浏览器确认 P1/P2 标签的显隐 */
const CDP=require('chrome-remote-interface');
const {spawn}=require('child_process');
const path=require('path'),fs=require('fs'),http=require('http');
const SRC=path.resolve(__dirname,'..','src');
const CHROME='C://Users//spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9666,HP=9211;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer(function(q,s){let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(SRC,p);if(!f.startsWith(SRC)){s.writeHead(403);s.end();return;}fs.readFile(f,function(e,d){if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});s.end(d);});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let PASS=0,FAIL=0;
function ck(ok,msg,extra){if(ok){console.log('  ✅ '+msg);PASS++;}else{console.log('  ❌ '+msg+(extra?'  → '+extra:''));FAIL++;}}
(async()=>{
  await new Promise(r=>server.listen(HP,'127.0.0.1',r));
  const tmp=path.join(process.env.TEMP||'/tmp','tg-'+Date.now());
  const ch=spawn(CHROME,['--remote-debugging-port='+PORT,'--user-data-dir='+tmp,'--headless=new','--disable-gpu','--no-first-run','--window-size=1200,700','http://127.0.0.1:'+HP+'/index.html'],{stdio:'ignore'});
  let t=null;
  for(let i=0;i<40;i++){await sleep(300);try{const l=await CDP.List({port:PORT});t=l.find(x=>x.type==='page'&&x.url.includes('index.html'));if(t)break;}catch(e){}}
  const c=await CDP({target:t,port:PORT});
  const {Runtime}=c;await Runtime.enable();
  const ev=async e=>{const r=await Runtime.evaluate({expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description));return r.result.value;};
  await sleep(3000);

  console.log('======== P1/P2 标签真浏览器验证 ========');

  /* 用"记录 fillText 的文字"来验证真的没画 */
  await ev(`(function(){
    window.__texts = [];
    var orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(txt){
      try { window.__texts.push(String(txt)); } catch(e){}
      return orig.apply(this, arguments);
    };
    return true;
  })()`);

  const check = async (label, setupExpr, expectP1) => {
    await ev('(function(){ window.__texts = []; return true; })()');
    await ev(setupExpr);
    await sleep(900);   // 跑几十帧，确保 drawHUD/drawCharacter 都执行过
    const got = await ev('(function(){ return window.__texts.slice(); })()');
    const hasP1 = got.indexOf('P1') >= 0;
    const hasP2 = got.indexOf('P2') >= 0;
    if (expectP1) {
      ck(hasP1 && hasP2, label + ' → 画出了 P1/P2（P1=' + hasP1 + ' P2=' + hasP2 + '）');
    } else {
      ck(!hasP1 && !hasP2, label + ' → **没有** P1/P2' + (hasP1||hasP2 ? '（却画出了！）' : ' ✅'));
    }
  };

  /* ① 单人模式 */
  await check('单人模式',
    '(function(){ Save.reset(); Save.data.maxUnlocked=11; Game.isPk=false; Game.aiRoles=null; Game.pkMyRole=null; Game.mode="single"; Game.playerCount=1; if(InputState.clearAI)InputState.clearAI(); Game.skipWeatherBrief=true; startGame(0); Game.skipWeatherBrief=false; for(var i=0;i<20;i++){update(1/60);InputState.tick();} return true; })()',
    false);

  /* ② PK 模式 */
  await check('PK 模式',
    '(function(){ Save.reset(); Save.data.maxUnlocked=11; var ids=[]; listForLibrary().forEach(function(c){ids.push(c.id);}); Save.data.unlockedCharacters=ids; Game.skipWeatherBrief=true; startGame(0,{pk:true,aiRoles:["dragon"],myRole:"kangaroo",pkLevelIndex:0}); Game.skipWeatherBrief=false; for(var i=0;i<200;i++){update(1/60);InputState.tick();} return true; })()',
    false);

  /* ③ 双人同屏 */
  await check('双人同屏',
    '(function(){ Save.reset(); Game.isPk=false; Game.aiRoles=null; Game.mode="local"; Game.playerCount=2; if(InputState.clearAI)InputState.clearAI(); Game.skipWeatherBrief=true; startGame(0); Game.skipWeatherBrief=false; for(var i=0;i<20;i++){update(1/60);InputState.tick();} return true; })()',
    true);

  console.log();
  console.log('========================================');
  console.log('  P1/P2 标签验证: '+PASS+' 通过 / '+FAIL+' 失败');
  console.log('========================================');
  await c.close();ch.kill();server.close();
  try{fs.rmSync(tmp,{recursive:true,force:true});}catch(e){}
  process.exit(FAIL>0?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
