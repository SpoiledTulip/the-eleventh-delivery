const fs=require('fs'),path=require('path'),vm=require('vm');
const SRC=path.resolve(__dirname,'..','src');
function bs(){function noop(){}
  const prox=new Proxy({},{get:function(t,k){if(k==='createLinearGradient')return function(){return{addColorStop:noop}};if(k==='measureText')return function(){return{width:10}};return noop},set:function(){return true}});
  const sb={console,Math,Date,Object,Array,Infinity,NaN,JSON,Promise,String,Number,Boolean,isNaN,parseInt,parseFloat,Proxy,Set,Map,
    window:{addEventListener:noop,requestAnimationFrame:function(){return 0},
      Image:function(){var self=this;this.width=64;this.height=64;setTimeout(function(){self.onload&&self.onload()},0);},
      AudioContext:function(){return{state:'running',currentTime:0,sampleRate:44100,createBuffer:function(c,l){return{getChannelData:function(){return new Float32Array(l)}}},createBufferSource:function(){return{buffer:null,loop:false,connect:noop,start:noop,stop:noop}},createBiquadFilter:function(){return{type:'',frequency:{setValueAtTime:noop,exponentialRampToValueAtTime:noop},Q:{setValueAtTime:noop},connect:noop}},createOscillator:function(){return{frequency:{setValueAtTime:noop,exponentialRampToValueAtTime:noop},connect:noop,start:noop,stop:noop}},createGain:function(){return{gain:{setValueAtTime:noop,linearRampToValueAtTime:noop,exponentialRampToValueAtTime:noop},connect:noop}},destination:{},resume:noop}}},
    document:{getElementById:function(){return{getContext:function(){return prox},width:0,height:0,style:{}}},addEventListener:noop,createElement:function(){return{getContext:function(){return prox},style:{},appendChild:noop}}},
    performance:{now:function(){return Date.now()}},requestAnimationFrame:function(){return 0},
    setTimeout:setTimeout,clearTimeout:clearTimeout,setInterval:function(){return 0},clearInterval:noop,
    localStorage:{getItem:function(){return null},setItem:noop,removeItem:noop,clear:noop}};
  sb.Image=sb.window.Image;sb.globalThis=sb;vm.createContext(sb);return sb;}
const FILES=['levels.js','sprites.js','audio.js','physics.js','characters.js','device-mode.js','save.js','net.js','scooter.js','ai-rider.js','render.js','game.js'];
const sb=bs();FILES.forEach(f=>vm.runInContext(fs.readFileSync(path.join(SRC,'js',f),'utf8'),sb,{filename:f}));
const run=c=>vm.runInContext(c,sb);
console.log('=== 每个角色取到的贴图 ===');
const res=run(`(function(){
  var out=[];
  var all = (typeof listForLibrary==='function') ? listForLibrary() : [];
  all.forEach(function(c){
    /* 模拟"贴图已加载" */
    var slot = SPRITE_IMAGES[c.role];
    if (slot) { slot.ready=true; slot.img={width:64,height:64,name:c.role+'.png'}; }
    var got = getSpriteImage(c.role);
    /* 再模拟 makePlayer 给的 sprite 对象 + roleHint */
    var fake = { role:c.role };
    out.push({ id:c.id, role:c.role, name:c.name,
               src: slot?slot.src:'(无)',
               canGet: !!got, imgName: got?got.img.name:'-' });
  });
  return out;
})()`);
res.forEach(r=>console.log('  ' + String(r.name).padEnd(12) + ' role=' + String(r.role).padEnd(10) +
  ' 取到图=' + (r.canGet?'✅':'❌') + '  图=' + r.imgName + '  (' + r.src + ')'));
