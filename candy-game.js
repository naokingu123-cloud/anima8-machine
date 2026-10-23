(function(global){
'use strict';
const SPECIAL_RATE=0.02;
const SIZE=10,COLORS=['赤','黄','緑','青','紫'];
const BASE_TENTHS=[0,0,0,0,5,10,20,30,50,80,120,180,250];
const payoutTenths=n=>n<4?0:n<=12?BASE_TENTHS[n]:250+(n-12)*100;
const chainTenths=n=>n<5?10:12+(n-5)*3;
const payoutHundredths=(maxLink,maxChain)=>payoutTenths(maxLink)*chainTenths(maxChain);
const formatPayout=hundredths=>(hundredths/100).toFixed(2).replace(/0$/,'');
function shuffle(a,random){for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function groups(board){
 const seen=new Set(),found=[];
 for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
  const tile=board[r][c],key=r*SIZE+c;if(!tile||seen.has(key))continue;
  const cells=[],stack=[[r,c]];seen.add(key);
  while(stack.length){const [y,x]=stack.pop();cells.push([y,x]);for(const [dy,dx] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const yy=y+dy,xx=x+dx,k=yy*SIZE+xx;
   if(yy<0||yy>=SIZE||xx<0||xx>=SIZE||seen.has(k)||!board[yy][xx]||board[yy][xx].color!==tile.color)continue;
   seen.add(k);stack.push([yy,xx]);
  }}
  if(cells.length>=3)found.push({color:tile.color,cells,size:cells.length,tenths:payoutTenths(cells.length)});
 }
 return found;
}
class Engine{
 constructor({random=Math.random,onEvent=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),speed=1}={}){
  this.random=random;this.onEvent=onEvent;this.sleep=sleep;this.speed=speed;this.version=0;this.uid=0;this.reset();
 }
 emit(phase,detail={}){this.phase=phase;this.onEvent({phase,...detail},this);}
 reset(){
  this.version++;this.queue=[];this.seen=new Set();this.drawn=new Set();this.history=[];this.totalHundredths=0;this.maxLink=0;this.maxChain=0;this.processed=0;this.accepted=0;this.busy=false;this.running=false;this.paused=false;
  this.board=Array.from({length:SIZE},()=>Array(SIZE).fill(null));this.fill(true);this.emit('ready');
 }
 start(){this.running=true;this.emit('waiting');}
 enqueue(number){
  if(!this.running||!Number.isInteger(number)||number<1||number>25||this.seen.has(number)||this.accepted>=8)return false;
  this.seen.add(number);this.accepted++;this.queue.push(number);this.emit('queued',{number});if(!this.busy)this.drain();return true;
 }
 get idle(){return !this.busy&&!this.queue.length;}
 async wait(ms,token){
  let remaining=ms/this.speed;
  while(remaining>0&&token===this.version){await this.sleep(Math.min(40,remaining));if(!this.paused)remaining-=Math.min(40,remaining);}
  return token===this.version;
 }
 fill(initial=false){
  const fresh=[];
  // Existing tiles are stable. Each new tile is checked against its entire
  // orthogonal component, so L/T-shaped groups cannot appear on refill either.
  for(let r=SIZE-1;r>=0;r--)for(let c=0;c<SIZE;c++)if(!this.board[r][c]){
   const tile={id:++this.uid,color:0,number:null,special:this.random()<SPECIAL_RATE};
   this.board[r][c]=tile;fresh.push(tile);let valid=false;
   for(const color of shuffle([0,1,2,3,4],this.random)){
    tile.color=color;
    if(!groups(this.board).some(g=>g.cells.some(([y,x])=>y===r&&x===c))){valid=true;break;}
   }
   if(!valid)throw new Error('補充する色を決められませんでした');
  }
  const present=new Set(this.board.flat().filter(t=>t.number!=null).map(t=>t.number));
  const oldBlanks=shuffle(this.board.flat().filter(t=>t.number==null&&!fresh.includes(t)),this.random);
  const blanks=[...oldBlanks,...shuffle(fresh,this.random)];
  for(const n of shuffle(Array.from({length:25},(_,i)=>i+1),this.random)){
   if(!this.seen.has(n)&&!present.has(n)){const tile=blanks.pop();if(tile)tile.number=n;}
  }
 }
 gravity(){
  for(let c=0;c<SIZE;c++){let dest=SIZE-1;for(let r=SIZE-1;r>=0;r--)if(this.board[r][c]){
   if(dest!==r){this.board[dest][c]=this.board[r][c];this.board[r][c]=null;}dest--;
  }}
 }
 remove(cells){for(const [r,c] of cells)this.board[r][c]=null;}
 recordLinks(linked,{ball,number,depth}){
  const before=this.totalHundredths;
  for(const g of linked){this.history.push({ball,number,depth,color:g.color,size:g.size,tenths:g.tenths});this.maxLink=Math.max(this.maxLink,g.size);}
  this.maxChain=Math.max(this.maxChain,depth);
  this.totalHundredths=payoutHundredths(this.maxLink,this.maxChain);
  return this.totalHundredths-before;
 }
 resolveLinks(linked){
  const colors=new Set(),cells=new Map();
  for(const g of linked)for(const [r,c] of g.cells){
   cells.set(r*SIZE+c,[r,c]);
   if(this.board[r][c].special)colors.add(this.board[r][c].color);
  }
  if(colors.size)for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
   if(this.board[r][c]&&colors.has(this.board[r][c].color))cells.set(r*SIZE+c,[r,c]);
  }
  return {cells:[...cells.values()],colors:[...colors]};
 }
 async drain(){
  const token=this.version;this.busy=true;
  try{
   while(this.queue.length&&token===this.version){
    const number=this.queue.shift(),ball=this.processed+1;let depth=0;this.drawn.add(number);
    const hit=[];for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)if(this.board[r][c]?.number===number)hit.push([r,c]);
    this.emit('hit',{number,ball,cells:hit});if(!await this.wait(420,token))return;
    this.remove(hit);this.emit('remove',{number,ball});if(!await this.wait(160,token))return;
    this.gravity();this.emit('fall',{number,ball});if(!await this.wait(380,token))return;
    let linked=groups(this.board);
    while(linked.length){
     depth++;const gain=this.recordLinks(linked,{ball,number,depth});
     const resolved=this.resolveLinks(linked);
     this.emit('link',{number,ball,depth,groups:linked,gain,cells:resolved.cells,clearColors:resolved.colors});
     if(!await this.wait(550+Math.min(500,Math.max(...linked.map(g=>g.size))-4)*65,token))return;
     this.remove(resolved.cells);this.emit('remove',{number,ball});if(!await this.wait(150,token))return;
     this.gravity();this.emit('fall',{number,ball});if(!await this.wait(380,token))return;
     linked=groups(this.board);
    }
    this.fill();this.emit('refill',{number,ball,depth});if(!await this.wait(480,token))return;
    this.processed++;this.emit('settled',{number,ball,depth});
   }
  }catch(error){if(token===this.version){this.running=false;this.queue=[];this.emit('error',{message:error.message});}}
  finally{if(token===this.version){this.busy=false;if(this.processed===8){this.running=false;this.emit('complete');}else if(this.running)this.emit('waiting');}}
 }
}

const SVG=[
 '<path d="M8 17 Q5 7 18 8 Q31 6 28 17 Q25 29 18 33 Q10 28 8 17" fill="#ff7890"/><path d="M12 9l-2-5 7 3 5-4 1 6" fill="#4dc385"/><g fill="#ffd0b5"><ellipse cx="12" cy="17" rx="1" ry="2"/><ellipse cx="23" cy="16" rx="1" ry="2"/><ellipse cx="18" cy="24" rx="1" ry="2"/></g>',
 '<path d="M10 10h16l4 18q-12 7-24 0z" fill="#ffe88c"/><path d="M10 10q8-7 16 0l1 4H9z" fill="#bd744c"/><ellipse cx="18" cy="8" rx="8" ry="3" fill="#f6ad61"/>',
 '<path d="M7 13q11-12 22 0v13q-11 9-22 0z" fill="#9dec9f"/><path d="M8 17h20v6H8z" fill="#f7ffe2"/><path d="M8 12q10-7 20 0" stroke="#d9ffd0" stroke-width="3" fill="none"/>',
 '<path d="M8 13L2 8v19l7-4m18-10l7-5v19l-7-4" fill="#b6e4ff"/><rect x="8" y="9" width="20" height="20" rx="8" fill="#7bcaff"/><path d="M12 13l11 12m-10 0l10-12" stroke="#dcf6ff" stroke-width="3"/>',
 '<path d="M7 16q11-20 22 0z" fill="#deb5ff"/><path d="M8 18h20l-3 14H11z" fill="#b18bea"/><path d="M12 21l2 9m5-9v9m5-9l-2 9" stroke="#f3d7ff" stroke-width="2"/><circle cx="18" cy="7" r="3" fill="#ffe0f5"/>'
];
function markup(){return `
 <header class="sweet-header"><div><small>SWEET LINK</small><h2>おかしの連鎖工房</h2><p>3つで消して、4つから配当。色消しで大連鎖！</p></div><div class="sweet-total"><small>最終配当</small><strong data-sweet-total>0.0<span>倍</span></strong></div></header>
 <div class="sweet-layout"><div class="sweet-play"><div class="sweet-balls" aria-label="8球の入賞番号"></div><div class="sweet-board-wrap"><div class="sweet-board" role="img" aria-label="10行10列のお菓子ブロック盤面"></div><div class="sweet-celebration" aria-hidden="true"></div></div><div class="sweet-status" role="status" aria-live="polite"></div></div>
 <aside class="sweet-info"><div class="sweet-progress"><b data-sweet-count>0 / 8球</b><span data-sweet-phase>待機中</span></div><p class="sweet-mode-note"></p><div class="sweet-buttons"><button type="button" data-sweet-real>抽選開始</button><button type="button" data-sweet-demo>8球おためし</button><button type="button" data-sweet-reset>リセット</button><label><input type="checkbox" data-sweet-sound checked>効果音</label></div><p class="sweet-demo-note"></p><h3>基礎配当 · 最大LINK</h3><table class="sweet-paytable"><thead><tr><th scope="col">LINK</th><th scope="col">配当</th></tr></thead><tbody>${Array.from({length:10},(_,i)=>i+3).map(n=>`<tr><th scope="row">${n}LINK</th><td>×${(payoutTenths(n)/10).toFixed(1)}</td></tr>`).join('')}</tbody></table><div class="sweet-chain-table" aria-label="最大連鎖の倍率"><strong>最大連鎖倍率</strong><span>1〜4連鎖 ×1.0</span><span>5連鎖 ×1.2</span><span>6連鎖 ×1.5</span><span>7連鎖 ×1.8</span><span>8連鎖 ×2.1</span><span>以降 ＋0.3</span></div><p class="sweet-rule">13LINK以降 ＋10倍／個</p><div class="sweet-receipt"><h3>最大LINK × 最大連鎖倍率</h3><div data-sweet-receipt>まだLINKはありません</div></div><details><summary>あそびかた</summary><p>通常8球の入賞番号に一致するブロックをすべて消します。落下後、上下左右で同色が3つ以上つながると消去。3LINKは配当0倍、4LINKから配当がつきます。連鎖が終わってから100マスへ補充します。</p><p>番号は1〜25を各1マスだけに付けます。連鎖で番号が消えた場合は、補充時に未入賞番号だけを付け直します。色消しマスは約2%で出現。LINKで消えると同色を盤面全体から消します（番号HITだけでは発動しません）。追加の色消し数はLINK数に加算しません。8球を通した最大LINKの基礎配当と、1回のHITで続いた最大連鎖の倍率を掛けます。LINKごとの配当は合算しません。初期配置・補充で3LINK以上は作りません。斜めはつながりません。</p></details></aside></div>`;}
function mount(root){
 root.innerHTML=markup();const q=s=>root.querySelector(s),boardNode=q('.sweet-board'),status=q('.sweet-status'),celebration=q('.sweet-celebration');
 let engine,mode='eight',source='machine',paused=false,demoToken=0,audio=null,sequence=0,machineRunning=false;
 const elements=new Map();
 function unlockSound(){try{const AC=global.AudioContext||global.webkitAudioContext;if(AC){audio=audio||new AC();audio.resume()?.catch(()=>{});}}catch{}}
 function sound(size,depth=1){
  if(!audio||audio.state!=='running'||!q('[data-sweet-sound]').checked)return;
  const now=audio.currentTime,count=size?Math.min(12,size+1+Math.min(depth-1,2)):2;
  for(let i=0;i<count;i++){
   const o=audio.createOscillator(),g=audio.createGain();o.type=size>=8?'triangle':'sine';
   o.frequency.value=(size?392:240)*Math.pow(2,([0,4,7,12,16,19,24,28,31,36,40,43][i]+Math.min(depth-1,4)*2)/12);
   g.gain.setValueAtTime(0,now+i*.055);g.gain.linearRampToValueAtTime(.035,now+i*.055+.008);g.gain.exponentialRampToValueAtTime(.001,now+i*.055+.23);
   o.connect(g);g.connect(audio.destination);o.start(now+i*.055);o.stop(now+i*.055+.25);
  }
 }
 function draw(event,e){
  const highlighted=new Set(event.cells?.map(([r,c])=>e.board[r][c]?.id)||[]);
  if(event.groups)for(const g of event.groups)for(const [r,c] of g.cells)highlighted.add(e.board[r][c]?.id);
  const alive=new Set();
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
   const t=e.board[r][c];if(!t)continue;alive.add(t.id);let el=elements.get(t.id);
   if(!el){el=document.createElement('div');el.className='sweet-tile sweet-color-'+t.color;el.innerHTML=`<svg viewBox="0 0 36 36" aria-hidden="true">${SVG[t.color]}</svg><b>${t.number==null?'':t.number}</b>`;boardNode.append(el);elements.set(t.id,el);el.style.top=event.phase==='refill'?'-30%':`calc(${r*10}% + 2px)`;}
   el.classList.toggle('sweet-color-clear',!!t.special);el.querySelector('b').textContent=t.number==null?'':t.number;
   el.setAttribute('aria-label',COLORS[t.color]+(t.special?'・色消し':'')+(t.number==null?'':'・'+t.number+'番'));
   if(t.special&&!el.querySelector('.sweet-special-label')){const badge=document.createElement('span');badge.className='sweet-special-label';badge.textContent='色消し';el.append(badge);}
   el.style.left=`calc(${c*10}% + 2px)`;if(event.phase!=='queued'){el.classList.toggle('sweet-hit',event.phase==='hit'&&highlighted.has(t.id));el.classList.toggle('sweet-link',event.phase==='link'&&highlighted.has(t.id));}
   const target=`calc(${r*10}% + 2px)`;
   if(event.phase==='refill'&&el.style.top==='-30%')requestAnimationFrame(()=>{if(elements.has(t.id))el.style.top=target;});else el.style.top=target;
  }
  for(const [id,el] of elements)if(!alive.has(id)){el.remove();elements.delete(id);}
  q('[data-sweet-total]').innerHTML=formatPayout(e.totalHundredths)+'<span>倍</span>';
  q('[data-sweet-count]').textContent=e.processed+' / 8球';
  const phaseNames={ready:'待機中',queued:'入賞待ちに追加',hit:'番号HIT',remove:'消去中',fall:'落下中',link:'LINK成立',refill:'補充中',settled:'処理完了',waiting:'入賞待ち',complete:'結果確定',error:'確認が必要'};
  if(event.phase!=='queued'||!e.busy)q('[data-sweet-phase]').textContent=phaseNames[event.phase]||'';
  q('.sweet-balls').innerHTML=Array.from({length:8},(_,i)=>{const n=[...e.seen][i];return `<span class="${i<e.processed?'done':n?'pending':''}">${n||'·'}</span>`;}).join('');
  q('[data-sweet-receipt]').innerHTML=`<div><span>最大 ${e.maxLink}LINK</span><b>基礎 ×${(payoutTenths(e.maxLink)/10).toFixed(1)}</b></div><div><span>最大 ${e.maxChain}連鎖</span><b>×${(chainTenths(e.maxChain)/10).toFixed(1)}</b></div>`;
  if(event.phase==='ready')status.textContent='3LINKで消去 · 4LINKから基礎配当';
  if(event.phase==='waiting')status.textContent=`${e.queue.length?'次の入賞を処理します':'次の入賞番号を待っています'} · ${source==='demo'?'おためし抽選':'実機シミュレーター連動'}`;
  if(event.phase==='hit'){status.textContent=`${event.ball}球目：${event.number}番 HIT！ 一致する${event.cells.length}マスを消去`;sound(0);}
  if(event.phase==='fall')status.textContent='お菓子が落下中…';
  if(event.phase==='refill')status.textContent='連鎖終了！ 3LINKを作らず100マスへ補充';
  if(event.phase==='link'){
   const cleared=event.clearColors||[];
   const max=Math.max(...event.groups.map(g=>g.size));sequence++;celebration.dataset.tier=max>=10?'grand':max>=7?'big':'normal';celebration.innerHTML=`<strong>${cleared.length?'COLOR CLEAR!':max+' LINK!'}</strong><span>${event.depth}連鎖　配当 ${formatPayout(e.totalHundredths)}倍</span>`+Array.from({length:Math.min(45,max*3)},(_,i)=>{const a=i*2.4,d=70+(i%4)*24;return `<i style="--dx:${Math.cos(a)*d}px;--dy:${Math.sin(a)*d}px;--rot:${i*79}deg;background:hsl(${i*47} 85% 75%)"></i>`;}).join('');
   celebration.classList.remove('show');void celebration.offsetWidth;celebration.classList.add('show');boardNode.dataset.tier=celebration.dataset.tier;
   const thisSequence=sequence;setTimeout(()=>{if(sequence===thisSequence){celebration.classList.remove('show');delete boardNode.dataset.tier;}},900);
   status.textContent=(cleared.length?cleared.map(c=>COLORS[c]).join('・')+'の色消し！ ':'')+event.groups.map(g=>`${COLORS[g.color]} ${g.size}LINK`).join(' ＋ ')+` · ${event.depth}連鎖`;sound(max,event.depth);
  }
  if(event.phase==='complete'){status.textContent=`8球終了！ 合計配当 ${formatPayout(e.totalHundredths)}倍`;q('[data-sweet-demo]').disabled=machineRunning;}
  if(event.phase==='error')status.textContent=event.message+'。抽選をリセットしてください';
 }
 engine=new Engine({onEvent:draw});
 q('[data-sweet-real]').addEventListener('click',()=>{document.querySelector('[data-action="start"]')?.click();});
 q('[data-sweet-reset]').addEventListener('click',()=>{document.querySelector('[data-action="reset"]')?.click();machineRunning=false;clear();});
 function clear(modeValue=mode){mode=modeValue;source='machine';paused=false;root.classList.remove('sweet-paused');demoToken++;sequence++;celebration.classList.remove('show');engine.reset();q('[data-sweet-demo]').disabled=machineRunning;}
 function start(){demoToken++;source='machine';machineRunning=true;q('[data-sweet-demo]').disabled=true;unlockSound();engine.start();}
 q('[data-sweet-demo]').addEventListener('click',async()=>{
  if(machineRunning)return;
  clear();source='demo';engine.start();unlockSound();const token=++demoToken;
  q('[data-sweet-demo]').disabled=true;q('.sweet-demo-note').textContent='おためし：抽選機を使わず、重複しない8番号で盤面を確認します。';
  const nums=shuffle(Array.from({length:25},(_,i)=>i+1),Math.random).slice(0,8);
  for(const n of nums){if(token!==demoToken)return;engine.enqueue(n);while(!engine.idle&&token===demoToken)await new Promise(r=>setTimeout(r,80));}
 });
 document.addEventListener('visibilitychange',()=>{engine.paused=paused||document.hidden;});
 q('.sweet-mode-note').textContent='8球全体の最大記録で配当';
 const api={
  reset:m=>{machineRunning=false;clear(m);q('.sweet-demo-note').textContent='';},
  start:()=>{if(mode==='eight')start();},
  hit:n=>mode==='eight'&&source==='machine'?engine.enqueue(n):false,
  end:()=>{if(mode!=='eight')return;machineRunning=false;q('[data-sweet-demo]').disabled=!engine.idle;if(engine.processed<8){engine.running=false;status.textContent=`入賞${engine.processed}球で抽選終了。通常8球をリセットして再開できます`; }},
  pause:v=>{paused=v;engine.paused=v||document.hidden;root.classList.toggle('sweet-paused',v);},
  get idle(){return source==='demo'||mode!=='eight'||engine.idle;},
  get engine(){return engine;}
 };
 root.sweetLink=api;return api;
}
const exported={Engine,groups,payoutTenths,chainTenths,payoutHundredths,mount};
if(typeof module!=='undefined'&&module.exports)module.exports=exported;
else global.SweetLink=exported;
})(typeof window!=='undefined'?window:globalThis);
