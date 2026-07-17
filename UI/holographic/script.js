/* ── WebGL ── */
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
if (gl) gl.getExtension('OES_standard_derivatives');
if (!gl) { document.body.innerHTML = '<p style="padding:2rem">Your browser does not support WebGL.</p>'; }

const vert = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }
`;

const frag = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_mouse;
uniform float u_speed;
uniform float u_steps;
uniform float u_sparkle;
uniform float u_ring_density;
uniform float u_warp_strength;
uniform float u_hue_shift;
uniform float u_drift_amp;
uniform float u_drift_speed;
uniform float u_sparkle_size;
uniform float u_sparkle_rate;
uniform float u_vignette;
uniform float u_num_centers;
uniform vec3  u_pal_a;       /* vortex palette base colour */

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0, amp=0.5; mat2 rot=mat2(0.8,-0.6,0.6,0.8);
  for(int i=0;i<5;i++){ v+=amp*noise(p); p=rot*p*2.0+11.3; amp*=0.5; }
  return v;
}
vec3 palette(float t){
  /* u_pal_a = user-chosen base colour; amplitude tuned for pink/blue/cream */
  vec3 b=vec3(0.17,0.10,0.16);
  vec3 c=vec3(1.0,1.0,1.0);
  vec3 d=vec3(0.10,0.28,0.55);
  return u_pal_a + b*cos(6.2831853*(c*t+d));
}
float aaRound(float x, float steps){
  float v=x*steps; float fw=max(fwidth(v),1e-4);
  float aa=smoothstep(0.5-fw,0.5+fw,fract(v));
  return (floor(v)+aa)/steps;
}
float starShape(vec2 d){
  vec2 a=abs(d);
  float rx=smoothstep(0.020,0.0,a.y)*smoothstep(0.14,0.0,a.x);
  float ry=smoothstep(0.020,0.0,a.x)*smoothstep(0.14,0.0,a.y);
  float core=smoothstep(0.028,0.0,length(d));
  return clamp(max(rx,ry)*0.85+core,0.0,1.0);
}

void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy;
  float aspect=u_res.x/u_res.y;
  vec2 p=vec2(uv.x*aspect,uv.y);
  float tt=u_time;

  float phase=0.0, wsum=0.0;
  for(int i=0;i<8;i++){
    float fi=float(i);
    float active=step(fi+0.5,u_num_centers);
    vec2 c=vec2(0.5*aspect,0.5)
          +vec2(cos(fi*2.4)*0.36*aspect,sin(fi*3.1)*0.34)
          +u_drift_amp*vec2(sin(tt*u_drift_speed+fi*1.3),
                            cos(tt*u_drift_speed*0.85+fi*2.1));
    float di=length(p-c);
    float wi=active/(di*di+0.010);
    phase+=di*wi; wsum+=wi;
  }
  {
    vec2 c=vec2(u_mouse.x*aspect,u_mouse.y);
    float di=length(p-c);
    float wi=1.0/(di*di+0.006)*1.3;
    phase+=di*wi; wsum+=wi;
  }
  phase/=wsum;

  float warp=fbm(p*1.6+tt*0.05);
  phase+=u_warp_strength*warp;

  float expand=tt*0.12*u_speed;
  float hue=phase*u_ring_density-expand+0.06*warp+u_hue_shift;
  float hueStep=aaRound(hue,3.0);
  hue=mix(hue,hueStep,u_steps);

  vec3 col=palette(hue);
  col=mix(col,vec3(0.75,0.75,0.94),0.16);   /* periwinkle-blue tint */
  col=mix(col,vec3(0.99,0.96,0.88),0.08);   /* warm cream tint */
  float centreGlow=smoothstep(0.16,0.0,phase);
  col=mix(col,vec3(1.0),centreGlow*0.25);

  if(u_sparkle>0.5){
    vec2 sp=vec2(uv.x*aspect,uv.y);
    vec2 g=sp*u_sparkle_size; vec2 id=floor(g); vec2 fp=fract(g)-0.5;
    float rnd=hash(id*1.7+3.1);
    float present=step(1.0-u_sparkle_rate,rnd);
    vec2 off=(vec2(hash(id+2.3),hash(id+9.7))-0.5)*0.55;
    float tw=sin(tt*2.2+rnd*40.0); tw=pow(max(tw,0.0),5.0);
    float s=starShape(fp-off)*tw*present;
    vec3 sc=mix(vec3(1.0),vec3(0.72,1.0,0.78),step(0.5,hash(id+5.0)));
    col+=s*sc*0.9;
  }

  float vig=smoothstep(1.35,0.35,length(uv-0.5));
  col*=1.0-u_vignette*(1.0-vig);

  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
}
`;

/* ── Compile & link ── */
function sh(type, src){
  const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}
const prog=gl.createProgram();
gl.attachShader(prog,sh(gl.VERTEX_SHADER,vert));
gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,frag));
gl.linkProgram(prog); gl.useProgram(prog);

const bufb=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,bufb);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(prog,'p');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);

const U={
  res:          gl.getUniformLocation(prog,'u_res'),
  time:         gl.getUniformLocation(prog,'u_time'),
  mouse:        gl.getUniformLocation(prog,'u_mouse'),
  speed:        gl.getUniformLocation(prog,'u_speed'),
  steps:        gl.getUniformLocation(prog,'u_steps'),
  sparkle:      gl.getUniformLocation(prog,'u_sparkle'),
  ring_density: gl.getUniformLocation(prog,'u_ring_density'),
  warp_strength:gl.getUniformLocation(prog,'u_warp_strength'),
  hue_shift:    gl.getUniformLocation(prog,'u_hue_shift'),
  drift_amp:    gl.getUniformLocation(prog,'u_drift_amp'),
  drift_speed:  gl.getUniformLocation(prog,'u_drift_speed'),
  sparkle_size: gl.getUniformLocation(prog,'u_sparkle_size'),
  sparkle_rate: gl.getUniformLocation(prog,'u_sparkle_rate'),
  vignette:     gl.getUniformLocation(prog,'u_vignette'),
  num_centers:  gl.getUniformLocation(prog,'u_num_centers'),
  pal_a:        gl.getUniformLocation(prog,'u_pal_a'),
};

/* ── Persistence ── auto-saves every panel change (via shared/state-sync.js,
   backed by state.json on disk) so a reload restores the same look instead
   of resetting to the coded defaults below, and so it's shared across any
   dev-server port pointed at this same project folder — not just this one
   origin's localStorage (mirrors the root index.html "Save Layout" pattern,
   but scoped to this effect's own internal params, which the parent page's
   LayerManager never sees). */
const STORAGE_KEY='needygirl-holographic-settings';
function loadSaved(){
  try { return JSON.parse(NeedyGirlState.get(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveState(){
  NeedyGirlState.set(STORAGE_KEY, JSON.stringify({
    V, vortexHex,
    retro:{ hex:retroHex, opa:retroOpa, off:retroEl.classList.contains('off') },
    cf:{ hex:cfHex, opa:cfOpa, off:cfEl.classList.contains('off') },
  }));
}
const saved=loadSaved();

/* ── State ── */
const V={
  speed:2.45, steps:0.06, ring_density:5.50,
  warp:0.00,  drift_amp:0.50, drift_speed:0.17,
  hue:0.88,   vignette:1.00,
  sparkle_size:12.0, sparkle_rate:0.39,
  sparkle:1.0, num_centers:6.0,
  ...(saved.V || {}),
};

/* ── Pointer ── */
const mouse={x:0.5,y:0.5,tx:0.5,ty:0.5};
function pointer(e){ const p=e.touches?e.touches[0]:e; mouse.tx=p.clientX/innerWidth; mouse.ty=1.0-p.clientY/innerHeight; }
addEventListener('mousemove',pointer);
addEventListener('touchmove',(e)=>{pointer(e);e.preventDefault();},{passive:false});

/* When embedded via holographicLayer.js, this iframe is sized/positioned to
   Frame 1's box but isn't necessarily the topmost element there (z-order
   tracks Frame 1, see setZIndex there) — so it won't reliably get real
   mousemove/touchmove events of its own. The parent page forwards pointer
   position (already normalized against this iframe's own box) instead;
   same-origin check since NeedyGirl always serves both from one origin. */
addEventListener('message', (e)=>{
  if(e.origin!==location.origin) return;
  const d=e.data;
  if(d && d.type==='ng-holographic-pointer'){ mouse.tx=d.tx; mouse.ty=d.ty; }
});

/* ── Resize ── */
function resize(){
  const dpr=window.getPerfResolutionCap?window.getPerfResolutionCap():Math.min(window.devicePixelRatio||1,2); let scale=dpr;
  const longest=Math.max(innerWidth,innerHeight)*scale;
  if(longest>2600) scale*=2600/longest;
  canvas.width=Math.floor(innerWidth*scale); canvas.height=Math.floor(innerHeight*scale);
  gl.viewport(0,0,canvas.width,canvas.height);
}
addEventListener('resize',resize); resize();

/* ── Helpers ── */
function hexToVec3(hex){
  return [parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255];
}
function hexToRgba(hex, a){
  const [r,g,b]=hexToVec3(hex).map(v=>Math.round(v*255));
  return `rgba(${r},${g},${b},${a})`;
}

/* ── Slider builder ── */
function makeSlider({id,label,min,max,step,def,key,noMax}){
  const ct=document.getElementById(id);
  const top=document.createElement('div'); top.className='sg-top';
  const lbl=document.createElement('span'); lbl.className='sg-label'; lbl.textContent=label;
  const val=document.createElement('span'); val.className='sg-val';
  val.textContent=def.toFixed(step<1?2:0);
  top.appendChild(lbl); top.appendChild(val);

  const tr=document.createElement('div'); tr.className='sg-track';
  const sl=document.createElement('input'); sl.type='range';
  sl.min=min; sl.max=max; sl.step=step; sl.value=def;
  tr.appendChild(sl);

  if(!noMax){
    const mw=document.createElement('div'); mw.className='max-wrap';
    const ml=document.createElement('span'); ml.className='max-lbl'; ml.textContent='max';
    const mi=document.createElement('input'); mi.type='number'; mi.className='max-inp'; mi.value=max; mi.step=step;
    mw.appendChild(ml); mw.appendChild(mi); tr.appendChild(mw);
    mi.addEventListener('change',()=>{
      const nm=parseFloat(mi.value);
      if(!isNaN(nm)&&nm>parseFloat(sl.min)){sl.max=nm; if(parseFloat(sl.value)>nm){sl.value=nm;upd();}}
      else mi.value=sl.max;
    });
  }
  ct.appendChild(top); ct.appendChild(tr);
  function upd(){ const v=parseFloat(sl.value); V[key]=v; val.textContent=v.toFixed(step<1?2:0); saveState(); }
  sl.addEventListener('input',upd);
}

/* ── Build sliders ── */
makeSlider({id:'sg-speed',label:'Flow Speed',   min:0.1,max:5,   step:0.05, def:V.speed,        key:'speed'       });
makeSlider({id:'sg-steps',label:'Sharpness',    min:0,  max:1,   step:0.01, def:V.steps,        key:'steps'       });
makeSlider({id:'sg-ring', label:'Ring Density', min:1,  max:30,  step:0.5,  def:V.ring_density, key:'ring_density'});
makeSlider({id:'sg-ncen', label:'Vortex Count', min:1,  max:8,   step:1,    def:V.num_centers,  key:'num_centers', noMax:true});
makeSlider({id:'sg-warp', label:'Warp',         min:0,  max:1,   step:0.01, def:V.warp,         key:'warp'        });
makeSlider({id:'sg-damp', label:'Drift Range',  min:0,  max:0.5, step:0.005,def:V.drift_amp,    key:'drift_amp'   });
makeSlider({id:'sg-dspd', label:'Drift Speed',  min:0,  max:1,   step:0.01, def:V.drift_speed,  key:'drift_speed' });
makeSlider({id:'sg-hue',  label:'Hue Shift',    min:-1, max:1,   step:0.01, def:V.hue,          key:'hue'         });
makeSlider({id:'sg-vig',  label:'Vignette',     min:0,  max:1,   step:0.01, def:V.vignette,     key:'vignette'    });
makeSlider({id:'sg-ssize',label:'Sparkle Grid', min:2,  max:20,  step:0.5,  def:V.sparkle_size, key:'sparkle_size'});
makeSlider({id:'sg-srate',label:'Sparkle Rate', min:0,  max:1,   step:0.01, def:V.sparkle_rate, key:'sparkle_rate'});

/* ── Vortex colour picker ── */
let vortexHex=saved.vortexHex || '#D1CCDE';
{
  const el=document.getElementById('vortex-color');
  el.value=vortexHex;
  el.addEventListener('input', e=>{ vortexHex=e.target.value; saveState(); });
}

/* ── Retro scan-line overlay ── */
const retroEl  = document.getElementById('retro');
const retroBtn = document.getElementById('retro-btn');
let retroHex=saved.retro?.hex ?? '#ffffff', retroOpa=saved.retro?.opa ?? 0.11;

function applyRetro(){
  const t=hexToRgba(retroHex,0), s=hexToRgba(retroHex,retroOpa);
  retroEl.style.backgroundImage=`repeating-linear-gradient(0deg,${t} 0px,${t} 2px,${s} 2px,${s} 3px)`;
  document.getElementById('retro-pct').textContent=Math.round(retroOpa*100)+'%';
}
document.getElementById('retro-color').value=retroHex;
document.getElementById('retro-opa').value=retroOpa;
document.getElementById('retro-color').addEventListener('input',e=>{ retroHex=e.target.value; applyRetro(); saveState(); });
document.getElementById('retro-opa').addEventListener('input',e=>{ retroOpa=parseFloat(e.target.value); applyRetro(); saveState(); });
document.getElementById('retro-opa-max').addEventListener('change',e=>{
  const nm=parseFloat(e.target.value), sl=document.getElementById('retro-opa');
  if(!isNaN(nm)&&nm>0){sl.max=nm; if(retroOpa>nm){retroOpa=nm;sl.value=nm;applyRetro();saveState();}}
  else e.target.value=sl.max;
});
if(saved.retro?.off) retroEl.classList.add('off');
retroBtn.classList.toggle('on',!retroEl.classList.contains('off'));
retroBtn.onclick=()=>{ retroEl.classList.toggle('off'); retroBtn.classList.toggle('on',!retroEl.classList.contains('off')); saveState(); };
applyRetro();

/* ── Colour filter overlay ── */
const cfEl  = document.getElementById('cf');
const cfBtn = document.getElementById('cf-btn');
let cfHex=saved.cf?.hex ?? '#ffb8ce', cfOpa=saved.cf?.opa ?? 0.15;

function applyCf(){
  cfEl.style.background=hexToRgba(cfHex,cfOpa);
  document.getElementById('cf-pct').textContent=Math.round(cfOpa*100)+'%';
}
document.getElementById('cf-color').value=cfHex;
document.getElementById('cf-opa').value=cfOpa;
document.getElementById('cf-color').addEventListener('input',e=>{ cfHex=e.target.value; applyCf(); saveState(); });
document.getElementById('cf-opa').addEventListener('input',e=>{ cfOpa=parseFloat(e.target.value); applyCf(); saveState(); });
document.getElementById('cf-opa-max').addEventListener('change',e=>{
  const nm=parseFloat(e.target.value), sl=document.getElementById('cf-opa');
  if(!isNaN(nm)&&nm>0){sl.max=nm; if(cfOpa>nm){cfOpa=nm;sl.value=nm;applyCf();saveState();}}
  else e.target.value=sl.max;
});
if(saved.cf?.off) cfEl.classList.add('off');
cfBtn.classList.toggle('on',!cfEl.classList.contains('off'));
cfBtn.onclick=()=>{ cfEl.classList.toggle('off'); cfBtn.classList.toggle('on',!cfEl.classList.contains('off')); saveState(); };
applyCf();

/* ── Sparkle toggle ── */
const sparkleBtn=document.getElementById('sparkle-btn');
sparkleBtn.classList.toggle('on',V.sparkle>0.5);
sparkleBtn.onclick=()=>{ V.sparkle=V.sparkle>0.5?0.0:1.0; sparkleBtn.classList.toggle('on',V.sparkle>0.5); saveState(); };

/* ── Save ── */
document.getElementById('save-btn').onclick=()=>{
  const a=document.createElement('a'); a.download='holographic-radiating.png';
  a.href=canvas.toDataURL('image/png'); a.click();
};

/* ── Reset (clear this effect's saved settings and reload its defaults) ── */
document.getElementById('reset-btn').onclick=()=>{
  NeedyGirlState.remove(STORAGE_KEY);
  location.reload();
};

/* ── Panel toggle ── */
const panel=document.getElementById('panel');
document.getElementById('panel-toggle').onclick=()=>panel.classList.toggle('closed');

/* ── Hint auto-hide ── */
const hint=document.getElementById('hint'); let idleT;
function wake(){ hint.classList.remove('hidden'); clearTimeout(idleT); idleT=setTimeout(()=>hint.classList.add('hidden'),3200); }
['mousemove','touchstart','keydown'].forEach(ev=>addEventListener(ev,wake)); wake();

/* ── Render loop ── */
const start=performance.now();
let rafId=null;
// Cap actual shader work to ~30fps regardless of display refresh rate —
// rAF still fires every vsync (so `now` stays accurate and pause/resume
// keeps working the same way), but the expensive part (uniform upload +
// drawArrays, the fbm/center-loop fragment shader) only runs every other
// tick on a 60Hz screen, or every 4th tick on 120Hz. This is a slow ambient
// vortex, not something that benefits from matching a high refresh rate.
const FRAME_INTERVAL=1000/30;
let lastDraw=0;
function frame(now){
  rafId=requestAnimationFrame(frame);
  if(now-lastDraw<FRAME_INTERVAL) return;
  lastDraw=now;
  // Lerp factor doubled vs. the old 60fps-tuned 0.05: half as many updates/sec
  // now, so this keeps the mouse-follow's real-world (seconds) catch-up speed
  // roughly the same instead of feeling laggier at the lower update rate.
  mouse.x+=(mouse.tx-mouse.x)*0.09; mouse.y+=(mouse.ty-mouse.y)*0.09;
  const [pr,pg,pb]=hexToVec3(vortexHex);
  gl.uniform2f(U.res,canvas.width,canvas.height);
  gl.uniform1f(U.time,(now-start)/1000);
  gl.uniform2f(U.mouse,mouse.x,mouse.y);
  gl.uniform1f(U.speed,V.speed);
  gl.uniform1f(U.steps,V.steps);
  gl.uniform1f(U.sparkle,V.sparkle);
  gl.uniform1f(U.ring_density,V.ring_density);
  gl.uniform1f(U.warp_strength,V.warp);
  gl.uniform1f(U.hue_shift,V.hue);
  gl.uniform1f(U.drift_amp,V.drift_amp);
  gl.uniform1f(U.drift_speed,V.drift_speed);
  gl.uniform1f(U.sparkle_size,V.sparkle_size);
  gl.uniform1f(U.sparkle_rate,V.sparkle_rate);
  gl.uniform1f(U.vignette,V.vignette);
  gl.uniform1f(U.num_centers,V.num_centers);
  gl.uniform3f(U.pal_a,pr,pg,pb);
  gl.drawArrays(gl.TRIANGLES,0,3);
}
rafId=requestAnimationFrame(frame);

/* BaseIframeLayer sets this iframe display:none while hidden (layer toggled
   off in the panel, or the tab backgrounded) — that stops rendering but NOT
   this rAF/WebGL loop, since script execution isn't tied to display. Stop it
   explicitly on request so a hidden/backgrounded instance costs nothing
   instead of shading every pixel 60x/sec for no visible result. */
addEventListener('message',(e)=>{
  if(e.origin!==location.origin) return;
  const d=e.data;
  if(d?.type==='ng-effect-pause'){ if(rafId!==null){ cancelAnimationFrame(rafId); rafId=null; } }
  else if(d?.type==='ng-effect-resume'){ if(rafId===null) rafId=requestAnimationFrame(frame); }
});
