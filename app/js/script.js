// ---------- Estado global & descoberta dinâmica de páginas ----------
let PAGES = [];
let idx = 0;
let currentColor = '#E0C2A2'; // swatch que substitui o preto
let erasing = false;
let svgEl = null;
let undoStack = [];
let redoStack = [];
let soundOn = true; // always on (toggle removed)
let audioCtx;

// ---------- Helpers DOM / UI ----------
const $  = (sel)=>document.querySelector(sel);
const $$ = (sel)=>Array.from(document.querySelectorAll(sel));
function setLabel(){ const total = PAGES.length || '?'; const cur = Math.min(idx+1,total); $('#pageLabel').textContent = `${cur} / ${total}`; }
function clickSoft(){
  if(!soundOn) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type='sine'; o.frequency.value = 1250 + Math.random()*150;
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.035, now+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.04);
    o.connect(g).connect(audioCtx.destination);
    o.start(); setTimeout(()=>o.stop(), 70);
  }catch(e){}
}

// ---------- Cores: normalizador (#fff, white, rgb(), etc.) ----------
function parseColor(c){
  if(!c) return null;
  c = (''+c).trim().toLowerCase();
  if(c==='none') return 'none';
  if(c==='black') return '#000000';
  if(c==='white') return '#ffffff';
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  if(c[0]==='#'){
    if(c.length===4){ // #rgb
      const r=c[1], g=c[2], b=c[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if(c.length===7){ return c; }
    // ignore alpha if present (#rrggbbaa)
    if(c.length===9){ return '#'+c.slice(1,7); }
  }
  // rgb() / rgba()
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if(m){
    const parts = m[1].split(',').map(s=>parseFloat(s.trim()));
    const r = Math.round(parts[0]||0), g = Math.round(parts[1]||0), b = Math.round(parts[2]||0);
    const toHex = (n)=>('0'+Math.max(0,Math.min(255,n)).toString(16)).slice(-2);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  return c; // fallback
}
const isNone = (v)=> (v||'').toLowerCase()==='none';
const isBlack = (v)=> { const p = parseColor(v); return p==='#000000'; };
const isWhite = (v)=> { const p = parseColor(v); return p==='#ffffff'; };

// ---------- Descobrir páginas (HEAD -> fallback GET) ----------
async function probe(url){
  try{ const r = await fetch(url, {method:'HEAD', cache:'no-store'}); if(r.ok) return true; }catch(e){}
  try{ const r = await fetch(url, {method:'GET',  cache:'no-store'}); if(r.ok) return true; }catch(e){}
  return false;
}
async function discoverPages(maxProbe=500){
  const found = [];
  for(let i=1;i<=maxProbe;i++){
    const path = `assets/pages/${i}.svg`;
    const ok = await probe(path);
    if(!ok){ break; }
    found.push(path);
  }
  PAGES = found;
  setLabel();
  updateProgressUI();
}


// ---------- Utilitário: inlining de estilos computados no SVG ----------
function inlineComputedStyles(svgRoot){
  // Copia estilos computados (stroke/fill/width/linejoin/linecap) para atributos inline
  const importantProps = ['stroke','fill','stroke-width','stroke-linejoin','stroke-linecap','stroke-miterlimit','fill-rule','paint-order'];
  const walker = svgRoot.querySelectorAll('*');
  walker.forEach(el=>{
    const cs = getComputedStyle(el);
    importantProps.forEach(p=>{
      try{
        const v = cs.getPropertyValue(p);
        if(v && v.trim() && v !== 'none' && v !== 'rgba(0, 0, 0, 0)'){
          el.setAttribute(p, v.trim());
        }
      }catch(e){}
    });
    // Se o elemento é path/line/poly/rect/circle, força fill='none' se originalmente não houver fill e for traço
    const tag = el.tagName && el.tagName.toLowerCase();
    if(tag && ['path','line','polyline','polygon','rect','circle','ellipse'].includes(tag)){
      const hasFill = el.hasAttribute('fill') && el.getAttribute('fill')!=='none';
      const stroke = el.getAttribute('stroke');
      if(stroke && !hasFill){
        el.setAttribute('fill','none');
      }
    }
  });
  return svgRoot;
}



function forceBlackStrokes(svgRoot){
  try{
    const nodes = svgRoot.querySelectorAll('*');
    nodes.forEach(function(el){
      try{
        if(!el.getAttribute) return;
        let s = el.getAttribute('stroke');
        if(s){
          const norm = (typeof parseColor==='function') ? parseColor(s) : String(s).trim().toLowerCase();
          if(norm==='#ffffff' || norm==='#fff' || norm==='white' || /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i.test(s)){
            el.setAttribute('stroke', '#000000');
          }
        }
      }catch(_){}
    });
  }catch(_){}
  return svgRoot;
}

// ---------- Normalização & garantias ----------
function normalizeSvg(svg){
  // xmlns/version/viewBox
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  svg.setAttribute('version','1.1');
  // Remove width/height fixos para responsividade (mantém A4 via viewBox)
  let w = svg.getAttribute('width'), h = svg.getAttribute('height');
  let hasVB = !!svg.getAttribute('viewBox');
  if(!hasVB){
    // fallback a A4 se não vier
    const W = parseFloat(w)||2480, H = parseFloat(h)||3508;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  }
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  // Responsivo no container
  svg.style.width = '100%'; svg.style.height = 'auto';
}

// Injeta fundo pintável se não houver
function ensurePaintableBackground(svg){
  if(svg.querySelector('[data-bg="1"]')) return;
  // Descobrir tamanho do viewBox
  let vb = svg.getAttribute('viewBox');
  let W=2480, H=3508;
  if(vb){ const p = vb.trim().split(/\s+/).map(Number); if(p.length===4){ W=p[2]; H=p[3]; } }
  const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
  rect.setAttribute('x','0'); rect.setAttribute('y','0');
  rect.setAttribute('width', String(W)); rect.setAttribute('height', String(H));
  rect.setAttribute('fill','#FFFFFF');
  rect.setAttribute('stroke','#000000'); // invisível via opacity
  rect.setAttribute('stroke-width','0.01');
  rect.setAttribute('stroke-opacity','0');
  rect.dataset.bg='1';
  // marca originais
  rect.dataset.origFill   = '#FFFFFF';
  rect.dataset.origStroke = '#000000';
  svg.insertBefore(rect, svg.firstChild);
}

// Salva atributos originais e aplica correções de stroke conforme regra
function snapshotAndFix(el){
  if(!el.getAttribute) return;
  const f = el.getAttribute('fill');
  const s = el.getAttribute('stroke');
  if(el.dataset.origFill===undefined && f!==null)   el.dataset.origFill   = f;
  if(el.dataset.origStroke===undefined && s!==null) el.dataset.origStroke = s;

  // Injeção de stroke se for área pintável sem stroke
  // Regras: se fill é branco (#fff/#ffffff/white/rgb(255,255,255)) e stroke ausente/none -> stroke preto
  const fN = parseColor(f);
  const sN = s==null ? null : parseColor(s);
  if(isWhite(fN) && (sN===null || isNone(sN))){
    el.setAttribute('stroke', '#000000');
    // atualiza origem também
    if(el.dataset.origStroke===undefined) el.dataset.origStroke = '#000000';
  }
}

// Pintável com base nos **atributos originais** do elemento após normalização/correção
function isPaintable(el){
  const f0 = parseColor(el.dataset.origFill);
  const s0 = parseColor(el.dataset.origStroke);
  if(isWhite(f0) && isBlack(s0)) return true;       // área pintável
  if(isNone(f0)  && isBlack(s0)) return false;      // barreira
  if(isBlack(f0) && isBlack(s0)) return false;      // sólido preto
  const tag = el.tagName.toLowerCase();
  if((tag==='text' || tag==='tspan') && (isBlack(f0)||isBlack(s0))) return false;
  return false;
}

// ---------- Carregar página ----------
async function loadPage(newIdx){
  if(PAGES.length===0) return;
  if(newIdx<0) newIdx = 0;
  if(newIdx>=PAGES.length) newIdx = PAGES.length-1;
  idx = newIdx;
  setLabel();
  undoStack.length = 0; redoStack.length = 0;

  const mount = $('#svgMount');
  mount.innerHTML = '';
  let res;
  try{ res = await fetch(PAGES[idx], {cache:'no-store'}); }
  catch(e){ mount.textContent = 'Erro ao carregar SVG.'; return; }
  const svgText = await res.text();

  const wrap = document.createElement('div');
  wrap.innerHTML = svgText.trim();
  const svg = wrap.querySelector('svg');
  if(!svg){ mount.textContent = 'SVG inválido.'; return; }

  normalizeSvg(svg);
  // Snapshot originais e correções de stroke ausente
  svg.querySelectorAll('*').forEach(snapshotAndFix);
  // Fundo
  ensurePaintableBackground(svg);
  // Clique delegação
  svg.addEventListener('click', onSvgClick);

  mount.appendChild(svg);
  svgEl = svg;
  resetPageCounters();
  // Atualiza cabeçalho e mantém progresso de clicks
  updateProgressUI();

  clickSoft();
}

// ---------- Pintura ----------
function onSvgClick(e){
  const el = e.target;
  if(!el || !el.getAttribute) return;
  if(!isPaintable(el)) return;
  clickSoft();
  const prev = el.getAttribute('fill');
  const next = erasing ? '#FFFFFF' : currentColor;
  if(prev===next) return;
  undoStack.push({el, prev, attr:'fill'});
  redoStack.length = 0;
  el.setAttribute('fill', next);
  // Contabiliza clique válido (branco -> cor) e único por elemento
  try{ incClickIfChanged(prev, next); handleUniquePaint(el, prev, next); }catch(e){}
}

// ---------- Undo/Redo ----------
function undo(){
  const item = undoStack.pop(); if(!item) return;
  const cur = item.el.getAttribute(item.attr);
  redoStack.push({el:item.el, prev:cur, attr:item.attr});
  item.el.setAttribute(item.attr, item.prev);
}
function redo(){
  const item = redoStack.pop(); if(!item) return;
  const cur = item.el.getAttribute(item.attr);
  undoStack.push({el:item.el, prev:cur, attr:item.attr});
  item.el.setAttribute(item.attr, item.prev);
}

// ---------- Ferramentas ----------
function highlightSelectedSwatch(c){
  try{
    $$('.sw').forEach(b=>{
      const on = (b.dataset.color||'').toLowerCase() === String(c).toLowerCase();
      b.classList.toggle('active', on);
      if(on){ b.setAttribute('aria-pressed','true'); } else { b.removeAttribute('aria-pressed'); }
    });
  }catch(e){}
}
function setColor(c){
  currentColor = c;
  erasing = false;
  const e = $('#eraserBtn'); if(e) e.classList.remove('active');

  highlightSelectedSwatch(c);
  try{ clickSoft(); }catch(e){}
}
function toggleErase(){
  erasing = !erasing;
  const e = $('#eraserBtn'); if(e) e.classList.toggle('active', erasing);
}

// ---------- Navegação ----------
function prev(){ try{ clickSoft(); }catch(e){} if(idx>0) loadPage(idx-1); }
function next(){ try{ clickSoft(); }catch(e){} if(idx<PAGES.length-1) loadPage(idx+1); }

// ---------- Exportar PNG A4 (alta qualidade, sem fundo extra) ----------
async function savePNG(){
  if(!svgEl) return;

  // 1) Clonar o SVG e garantir viewBox + width/height consistentes
  const clone = svgEl.cloneNode(true);
  inlineComputedStyles(clone);
  
  
forceBlackStrokes(clone);
// Ensure stroked outlines are black on export (avoid white-stroke bug)
  try{
    clone.querySelectorAll('*').forEach(function(el){
      if(!el.getAttribute) return;
      const s = el.getAttribute('stroke');
      if(s){
        // normalize to hex via existing parseColor helper if available
        try{
          const p = (typeof parseColor==='function') ? parseColor(s) : String(s).trim().toLowerCase();
          if(p==='#ffffff' || p==='white' || /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i.test(s)){
            el.setAttribute('stroke', '#000000');
          }
        }catch(_){ if(/^#fff(?:fff)?$/i.test(s)) el.setAttribute('stroke','#000000'); }
      }
    });
  }catch(_){}

clone.removeAttribute('width');
  clone.removeAttribute('height');

  if(!clone.hasAttribute('viewBox')){
    try{
      const tmp = document.createElement('div');
      tmp.style.position = 'absolute'; tmp.style.left = '-99999px'; tmp.appendChild(clone);
      document.body.appendChild(tmp);
      const bb = clone.getBBox();
      clone.setAttribute('viewBox', `0 0 ${Math.max(1,bb.width)} ${Math.max(1,bb.height)}`);
      tmp.remove();
    }catch(e){
      const wAttr = parseFloat(svgEl.getAttribute('width')) || 2480;
      const hAttr = parseFloat(svgEl.getAttribute('height')) || 3508;
      clone.setAttribute('viewBox', `0 0 ${wAttr} ${hAttr}`);
    }
  }
  clone.setAttribute('width', '100%');
  clone.setAttribute('height', '100%');

  // 2) Serializar e carregar
  forceBlackStrokes(clone);
const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgText], {type:'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  await new Promise((res, rej)=>{ img.onload = res; img.onerror = rej; img.src = url; });

  // 3) Dimensões A4 (pixels) — retrato
  const TARGET_W = 2480;
  const TARGET_H = 3508;
  const SS = 3; // supersampling

  // 4) Calcular escala a partir do viewBox (preferir ocupar tudo se o SVG já é A4)
  const vb = (clone.getAttribute('viewBox')||`0 0 ${TARGET_W} ${TARGET_H}`).split(/\s+/).map(parseFloat);
  const vbW = Math.max(1, vb[2] || TARGET_W);
  const vbH = Math.max(1, vb[3] || TARGET_H);
  const ratioTarget = TARGET_W / TARGET_H;
  const ratioSVG = vbW / vbH;

  // Estratégia: se a proporção do SVG for ~A4 (tolerância 1%), desenha FULL sem padding; senão, contain centralizado
  const nearlyA4 = Math.abs(ratioSVG - ratioTarget) <= ratioTarget * 0.01;
  let drawW, drawH, padX, padY;
  if(nearlyA4){
    drawW = TARGET_W * SS;
    drawH = TARGET_H * SS;
    padX = 0; padY = 0;
  }else{
    const scale = Math.min(TARGET_W / vbW, TARGET_H / vbH);
    drawW = Math.round(vbW * scale * SS);
    drawH = Math.round(vbH * scale * SS);
    padX = Math.max(0, Math.round((TARGET_W*SS - drawW)/2));
    padY = Math.max(0, Math.round((TARGET_H*SS - drawH)/2));
  }

  // 5) Canvas hi-res + smoothing
  const hi = document.createElement('canvas');
  hi.width  = TARGET_W * SS;
  hi.height = TARGET_H * SS;
  const hictx = hi.getContext('2d');
  hictx.imageSmoothingEnabled = true;
  hictx.imageSmoothingQuality = 'high';
  hictx.fillStyle = '#FFFFFF';
  hictx.fillRect(0,0,hi.width,hi.height);
  hictx.drawImage(img, padX, padY, drawW, drawH);

  // 6) Downscale exato para A4
  const out = document.createElement('canvas');
  out.width  = TARGET_W;
  out.height = TARGET_H;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.fillStyle = '#FFFFFF';
  octx.fillRect(0,0,out.width,out.height);
  octx.drawImage(hi, 0, 0, out.width, out.height);

  URL.revokeObjectURL(url);

  // 7) Baixar PNG
  const a = document.createElement('a');
  a.download = `pintando-${String(idx+1).padStart(2,'0')}-A4.png`;
  a.href = out.toDataURL('image/png');
  document.body.appendChild(a); a.click(); a.remove();
  try{ clickSoft(); }catch(e){}
}

// ---------- Imprimir somente a arte (A4) ----------
function printInline(){
  if(!svgEl) return;
  const serializer = new XMLSerializer();
  const svgClone = svgEl.cloneNode(true);
  inlineComputedStyles(svgClone);
  // remove event listeners incidentais ao clone, só markup
  const svgString = serializer.serializeToString(svgClone);
  const w = window.open('', '_blank');
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    html,body{height:100%; margin:0; background:#fff;}
    .box{width:100%; min-height:100%; display:flex; justify-content:center; align-items:center;}
    svg{width:100%; height:auto;}
  </style></head><body>
  <div class="box">${svgString}</div>
  <script>
    window.onafterprint = function(){ window.close(); };
    window.onload = function(){ setTimeout(function(){ window.print(); }, 50); setTimeout(function(){ window.close(); }, 2000); };
  <\/script>
  </body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

// ---------- Som ON/OFF ----------
function toggleSound(){ /* removed: sounds always on */ }

// ---------- Init / ligações ----------
(async function init(){
  // Ligações com checagem de existência (evita erros de console)
  const prevBtn = $('#prevBtn');   if(prevBtn)   prevBtn.addEventListener('click', prev);
  const nextBtn = $('#nextBtn');   if(nextBtn)   nextBtn.addEventListener('click', next);
  const saveBtn = $('#savePng');   if(saveBtn)   saveBtn.addEventListener('click', savePNG);
  const printBtn= $('#printBtn');  if(printBtn)  printBtn.addEventListener('click', printInline);
  const undoBtn = $('#undoBtn');   if(undoBtn)   undoBtn.addEventListener('click', undo);
  const redoBtn = $('#redoBtn');   if(redoBtn)   redoBtn.addEventListener('click', redo);
  const erBtn   = $('#eraserBtn'); if(erBtn)     erBtn.addEventListener('click', toggleErase);
// sound toggle removed per spec
  $$('.sw').forEach(b=> b.addEventListener('click', ()=> setColor(b.dataset.color)));
  const pick = $('#picker'); if(pick) pick.addEventListener('input', e=> setColor(e.target.value));

  await discoverPages();
  // Robust event delegation for palette/swatches
  const swCont = $('#swatches');
  if(swCont){
    swCont.addEventListener('click', (e)=>{
      const btn = e.target.closest('.sw');
      if(btn && swCont.contains(btn)){
        const col = btn.dataset.color || getComputedStyle(btn).getPropertyValue('--c') || null;
        if(col){ setColor(col.trim()); }
      }
    });
  }
  const pick2 = $('#picker');
  if(pick2){
    pick2.addEventListener('input', e=> setColor(e.target.value));
    pick2.addEventListener('change', ()=>{ try{ clickSoft(); }catch(e){} });
  }

  // Global click sounds for UI controls (buttons/tools)
  document.addEventListener('click', (ev)=>{
    const el = ev.target.closest('button, .btn, .navbtn, .sw, [data-tool]');
    if(el){ try{ clickSoft(); }catch(e){} }
  }, true);

  setLabel();
  loadPage(0);
})();
// === Stars & Progress (14-click model) ===
const STAR_STORAGE_KEY = 'pp_stars_v2';
const CLICK_STORAGE_KEY = 'pp_clicks_v2';

function loadJSON(k){ try{ return JSON.parse(localStorage.getItem(k)||'{}'); }catch(e){ return {}; } }
function saveJSON(k, v){ try{ localStorage.setItem(k, JSON.stringify(v||{})); }catch(e){} }

let STARS = loadJSON(STAR_STORAGE_KEY);   // map: pageId -> true
let CLICKS = loadJSON(CLICK_STORAGE_KEY); // map: pageId -> integer (progress clicks)

const AUTO_AWARD_CLICKS = 14;

function zeroPad(n, size=2){ n = Number(n||0); return String(n).padStart(size, '0'); }
function pageId(){ try{ return String(PAGES[idx] || ('page-'+(idx+1))); }catch(e){ return 'page-'+(idx+1); } }

function starsCount(){ return Object.keys(STARS).filter(k=>STARS[k]).length; }

function updateProgressUI(){
  const total = PAGES.length||0;
  const stars = starsCount();
  const pct = total>0 ? Math.ceil((stars/total)*100) : 0;
  const e1 = document.getElementById('starCount');
  const e2 = document.getElementById('totalPages');
  const e3 = document.getElementById('progressPercent');
  const fill = document.getElementById('progressFill');
  if(e1) e1.textContent = zeroPad(stars, 2);
  if(e2) e2.textContent = String(total);
  if(e3) e3.textContent = pct + '%';
  if(fill){ fill.style.width = Math.max(0, Math.min(100, pct)) + '%'; }
  const bar = document.querySelector('.progressbar');
  if(bar) bar.setAttribute('aria-valuenow', String(pct));
}

function awardStarOnce(){
  const id = pageId();
  if(!STARS[id]){
    STARS[id] = true; saveJSON(STAR_STORAGE_KEY, STARS);
    try{ const el = document.getElementById('starSound'); if(el){ el.currentTime=0; el.play().catch(()=>{});} }catch(e){}
    updateProgressUI();
  }
}


// === Unique-paint tracker (counts each element at most once) ===
const UNIQUE_STORAGE_KEY = 'pp_uniquecount_v1';
let UNIQUE = loadJSON(UNIQUE_STORAGE_KEY); // map: pageId -> count

const paintedSet = new WeakSet(); // in-memory for current page

function isWhiteOrNone(v){
  const c = (v||'').trim().toLowerCase();
  return (c==='' || c==='white' || c==='#ffffff' || c==='none');
}

function getUniqueCount(id){ return Number(UNIQUE[id]||0); }
function setUniqueCount(id, n){ UNIQUE[id] = Number(n||0); saveJSON(UNIQUE_STORAGE_KEY, UNIQUE); }

function resetPageCounters(){
  // called on page load
  paintedSet.clear?.(); // ignore if not supported
}

function handleUniquePaint(el, prev, next){
  // Count once per element when it becomes colored for the first time on this page
  if(STARS[pageId()]) return; // already awarded
  if(!el || !el.getAttribute) return;
  const becameColored = !isWhiteOrNone(next);
  if(!becameColored) return;
  if(paintedSet.has(el)) return;
  paintedSet.add(el);
  const id = pageId();
  const current = getUniqueCount(id) + 1;
  setUniqueCount(id, current);
  // mirror into CLICKS for UI/debug parity
  CLICKS[id] = current; saveJSON(CLICK_STORAGE_KEY, CLICKS);
  if(current >= AUTO_AWARD_CLICKS){ awardStarOnce(); }
}
function incClickIfChanged(prevFill, nextFill){
  // conta apenas quando um branco/none é trocado por uma cor
  const prev = (prevFill||'').toLowerCase();
  const next = (nextFill||'').toLowerCase();
  const wasWhite = (prev==='white' || prev==='#ffffff' || prev==='none' || prev==='' );
  const isColored = !(next==='white' || next==='#ffffff' || next==='none' || next==='');
  if(!wasWhite || !isColored) return; // não conta
  if(STARS[pageId()]) return; // já ganhou
  const id = pageId();
  const current = Number(CLICKS[id]||0) + 1;
  CLICKS[id] = current; saveJSON(CLICK_STORAGE_KEY, CLICKS);
  if(current >= AUTO_AWARD_CLICKS){ awardStarOnce(); }
}


window.PP_DBG = function(){ 
  const id = pageId();
  console.log('[PP] page:', id, 'stars:', !!STARS[id], 'uniqueCount:', (UNIQUE[id]||0), 'clicks:', (CLICKS[id]||0));
  console.log('[PP] totalStars:', Object.keys(STARS).filter(k=>STARS[k]).length, 'of', PAGES.length);
};


// Sistema de zoom (3 níveis: 1, 1.5, 2)
let zoomLevels = [1, 1.5, 2];
let currentZoomIndex = 0;

function applyZoom() {
  const container = document.getElementById("svgMount");
  if (container) {
    container.style.transform = `scale(${zoomLevels[currentZoomIndex]})`;
    container.style.transformOrigin = "center top";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btnIn = document.getElementById("zoom-in");
  const btnOut = document.getElementById("zoom-out");

  if (btnIn) {
    btnIn.addEventListener("click", () => {
      if (currentZoomIndex < zoomLevels.length - 1) {
        currentZoomIndex++;
        applyZoom();
      }
    });
  }

  if (btnOut) {
    btnOut.addEventListener("click", () => {
      if (currentZoomIndex > 0) {
        currentZoomIndex--;
        applyZoom();
      }
    });
  }
});


// Sistema de navegação lateral no zoom
let offsetX = 0;
const moveStep = 100;

function updatePan() {
  const container = document.getElementById("svgMount");
  if (container) {
    container.style.transform = `scale(${zoomLevels[currentZoomIndex]}) translateX(${offsetX}px)`;
    container.style.transformOrigin = "center top";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const left = document.getElementById("arrow-left");
  const right = document.getElementById("arrow-right");

  function toggleArrows() {
    const left = document.getElementById("arrow-left");
    const right = document.getElementById("arrow-right");
    if (currentZoomIndex > 0) {
      if (left) left.style.display = "block";
      if (right) right.style.display = "block";
    } else {
      if (left) left.style.display = "none";
      if (right) right.style.display = "none";
      offsetX = 0;
    }
  }

  if (left && right) {
    left.addEventListener("click", () => {
      offsetX += moveStep;
      updatePan();
    });
    right.addEventListener("click", () => {
      offsetX -= moveStep;
      updatePan();
    });
  }

  // Integrar com sistema de zoom existente
  const oldApplyZoom = applyZoom;
  applyZoom = function() {
    oldApplyZoom();
    toggleArrows();
  };
});
