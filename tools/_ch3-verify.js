/* 校准：把某关某段原样打出来（不合并列），核对地形 */
const fs=require('fs'),path=require('path'),vm=require('vm');
function noop(){}
const prox=new Proxy({},{get:(t,k)=>(k==='createLinearGradient'||k==='createRadialGradient')?()=>({addColorStop:noop}):(k==='measureText'?()=>({width:10}):noop),set:()=>true});
const sb={console,Math,Date,JSON,Object,Array,String,Number,Boolean,parseInt,parseFloat,isNaN,Infinity,NaN,Error,Proxy,Set,Map,Promise,
 window:{addEventListener:noop,requestAnimationFrame:()=>0},
 document:{getElementById:()=>({getContext:()=>prox,width:0,height:0,style:{}}),addEventListener:noop,createElement:()=>({getContext:()=>prox,style:{},appendChild:noop})},
 performance:{now:()=>Date.now()},requestAnimationFrame:()=>0,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
 localStorage:{getItem:()=>null,setItem:noop,removeItem:noop,clear:noop}};
sb.globalThis=sb; vm.createContext(sb);
['levels.js','ch3-builder.js','levels-ch3.js'].forEach(f=>{try{vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src','js',f),'utf8'),sb,{filename:f})}catch(e){}});
const id=+process.argv[2]||13;
const c1=+process.argv[3]||28, c2=+process.argv[4]||48;
const m=JSON.parse(vm.runInContext('JSON.stringify(__CH3_LEVEL_BUILDERS['+id+']().map)',sb));
const H=m.length;
let hdr='     ';
for(let c=c1;c<=c2;c++) hdr += (c%10===0?'|':' ')+(c%10===0?'':String(c%10));
console.log(hdr);
for(let r=0;r<H;r++){
  let line=String(r).padStart(3)+' |';
  for(let c=c1;c<=c2;c++) line+=m[r][c];
  console.log(line);
}
