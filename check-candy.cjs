const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Engine,groups,payoutTenths}=require('./candy-game.js');
let seed=1820;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const fast={random,sleep:()=>Promise.resolve(),speed:100};
async function done(e){while(!e.idle)await new Promise(r=>setImmediate(r));}
function board(){return Array.from({length:10},()=>Array(10).fill(null));}
function tile(color,number=1){return {id:++seed,color,number};}
(async()=>{
 assert.equal(payoutTenths(3),0,'3LINK has no payout');
 let colorEvent;let zero=new Engine({...fast,onEvent:ev=>{if(ev.phase==='link')colorEvent=ev;}});zero.board=board();zero.board[9][0]=tile(0,1);zero.board[9][1]=tile(0,1);zero.board[9][2]=tile(4,25);zero.board[8][2]=tile(0,1);assert.equal(groups(zero.board).length,0);zero.board[9][0].special=true;zero.board[9][9]=tile(0,null);zero.start();zero.enqueue(25);await done(zero);assert.deepEqual(zero.history.map(h=>[h.size,h.tenths]),[[3,0]]);assert.equal(zero.totalTenths,0);assert.equal(colorEvent.cells.length,4);assert.deepEqual(colorEvent.clearColors,[0]);assert.equal(groups(zero.board).length,0);
 assert.equal(payoutTenths(4)*3+payoutTenths(5)*4,11,'specified example is exactly 1.1x');
 let b=board();for(let i=0;i<4;i++)b[i][i]=tile(0);assert.equal(groups(b).length,0,'diagonal is not connected');
 b=board();for(const [r,c] of [[0,0],[0,1],[1,1],[2,1],[2,2]])b[r][c]=tile(2);assert.equal(groups(b)[0].size,5);assert.equal(groups(b)[0].tenths,2,'L-shaped component awards once');
 for(let i=0;i<30;i++){
  const e=new Engine(fast);assert.equal(groups(e.board).length,0);assert.equal(e.board.flat().length,100);
  for(let n=1;n<=25;n++)assert.equal(e.board.flat().filter(t=>t.number===n).length,1);
 }
 const events=[];const e=new Engine({...fast,onEvent:(ev,engine)=>{events.push(ev);if(ev.phase==='refill'){assert.equal(groups(engine.board).length,0,'refill never pays');assert.equal(engine.board.flat().filter(Boolean).length,100);assert(engine.board.flat().every(t=>!engine.drawn.has(t.number)),'new fixture refill uses unprocessed numbers');}}});
 e.board=board();e.board[8][0]=tile(4,25);e.board[9][1]=tile(4,25);
 for(const [r,c] of [[9,0],[7,0],[8,1]])e.board[r][c]=tile(0,4);
 for(const [r,c] of [[6,0],[7,1],[9,2]])e.board[r][c]=tile(3,5);
 assert.equal(groups(e.board).length,0);e.start();e.enqueue(25);await done(e);
 assert.equal(e.processed,1);assert.equal(events.find(x=>x.phase==='hit').cells.length,2,'one number removes every matching tile');
 assert.deepEqual(e.history.map(h=>[h.size,h.depth,h.tenths]),[[3,1,0],[3,2,0]],'zero-payout clears continue into a second cascade');
 assert.equal(e.totalTenths,0);assert.equal(events.filter(x=>x.phase==='refill').length,1);
 assert.equal(events.filter(x=>x.phase==='link').length,2);
 // A special in a linked component removes isolated matching colors without inventing extra LINK payout.
 const special=new Engine(fast);special.board=board();
 for(const [r,c] of [[9,0],[9,1],[9,2],[2,8]])special.board[r][c]=tile(0,null);
 special.board[9][1].special=true;special.board[5][5]=tile(2,null);
 let resolved=special.resolveLinks(groups(special.board));assert.equal(resolved.cells.length,4);assert.deepEqual(resolved.colors,[0]);
 assert.equal(groups(special.board)[0].tenths,0);special.remove(resolved.cells);assert(special.board[5][5]);assert.equal(special.board.flat().filter(t=>t?.color===0).length,0);
 // Direct numbered HIT on a special does not trigger its color-clear power.
 let firstRemoval;const direct=new Engine({...fast,onEvent:(ev,en)=>{if(ev.phase==='remove'&&!firstRemoval)firstRemoval=en.board.flat().filter(Boolean).map(t=>t.id);}});
 direct.board=board();direct.board[9][0]=tile(0,25);direct.board[9][0].special=true;const untouched=tile(0,null);direct.board[9][9]=untouched;
 direct.start();direct.enqueue(25);await done(direct);assert(firstRemoval.includes(untouched.id));
 // Missing unhit numbers are restored, including if only old blank tiles are available.
 const restore=new Engine(fast);restore.board.flat().find(t=>t.number===15).number=null;restore.fill();assert.equal(restore.board.flat().filter(t=>t.number===15).length,1);
 const excluded=restore.board.flat().find(t=>t.number===16);excluded.number=null;restore.seen.add(16);restore.fill();assert(!restore.board.flat().some(t=>t.number===16));
 for(let trial=0;trial<35;trial++){
  const seen=[];const engine=new Engine({...fast,onEvent:(ev,en)=>{if(ev.phase==='hit')seen.push(ev.number);if(ev.phase==='refill'){assert.equal(groups(en.board).length,0);assert.equal(en.board.flat().filter(Boolean).length,100);
   const nums=en.board.flat().map(t=>t.number).filter(n=>n!=null);assert.equal(new Set(nums).size,nums.length,'numbers are unique');assert(nums.every(n=>!en.drawn.has(n)),'processed numbers do not return');
   for(let n=1;n<=25;n++)if(!en.seen.has(n))assert.equal(nums.filter(v=>v===n).length,1,'every unseen number present exactly once');
  }}});
  engine.start();for(let n=1;n<=8;n++)assert(engine.enqueue(n));assert(!engine.enqueue(1));assert(!engine.enqueue(9));
  await done(engine);assert.deepEqual(seen,[1,2,3,4,5,6,7,8],'3+2 arriving quickly remain five separate operations');
  assert.equal(engine.processed,8);assert.equal(engine.running,false);assert.equal(engine.totalTenths,engine.history.reduce((s,h)=>s+h.tenths,0));
 }
 let release;const cancel=new Engine({random,sleep:()=>new Promise(r=>release=r)});cancel.start();cancel.enqueue(1);cancel.reset();release();await new Promise(r=>setImmediate(r));assert.equal(cancel.processed,0);assert.equal(cancel.totalTenths,0);assert.equal(cancel.history.length,0);assert.equal(cancel.idle,true,'reset cancels old asynchronous transaction');
 const index=fs.readFileSync(__dirname+'/index.html','utf8');for(const m of index.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 const ctx={};vm.createContext(ctx);vm.runInContext(index.slice(index.indexOf('class DrawController{'),index.indexOf('// Lightweight online timing'))+';this.Controller=DrawController;',ctx);
 const physics={settings:{},time:10,active:0,reset(){},launch(){return {};}};const draw=new ctx.Controller(physics);let settled=false;draw.canAdvance=()=>settled;draw.state='running';draw.waiting=true;draw.update();assert.equal(draw.group,0,'3-ball group waits for payout/refill');settled=true;draw.update();assert.equal(draw.group,1,'next 2-ball group starts only after board is stable');
 new vm.Script(fs.readFileSync(__dirname+'/candy-game.js','utf8'));
 console.log('PASS: color clear, HIT does not trigger special, unique sparse numbers, no admitted-number refill, 3LINK clear with zero payout, no initial/refill 3LINK, payout example, 4-neighbor groups, one award per component, 30 initial layouts, true 2-step cascade, no mid-chain refill, 35 full 8-ball games, queued 3+2, no refill links, integer sum, duplicate rejection, reset cancellation, JS syntax');
})().catch(e=>{console.error(e);process.exitCode=1;});
