/* ── Frame 1 clip wrapper ── positioned/sized by the parent's
   ng-holo-frame1-box message (see holographicLayer.js's _frame1Box()) and
   masked to Frame 1's own painted silhouette — the web equivalent of
   clipping this layer to another. Path is one level up from this document
   (UI/holographic/ -> UI/Frame 1.png). */
const holoClip = document.getElementById('holo-clip');
holoClip.style.maskImage = 'url("../Frame 1.png")';
holoClip.style.webkitMaskImage = 'url("../Frame 1.png")';

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

/* ── Per-mode profiles ── every visual parameter (Motion/Shape/Color/Sparkle
   uniforms, vortex base colour, and the two baked overlay layers) is a
   fully independent set per mode (normal/yandere/drug) — not one shared
   base with small deltas layered on top (the earlier "Mode Preset"
   design). Picking a mode in the panel's dropdown edits THAT profile's own
   full set of sliders with zero cross-talk between modes. 'normal' plays
   when no stat-driven mode is active; EffectDirector's ng-holo-mode picks
   which profile — and how strongly, via intensity — to blend toward each
   frame (see frame() below). */
const PROFILE_KEYS=['normal','yandere','drug'];

const PROFILE_DEFAULTS={
  normal:{
    speed:2.45, steps:0.06, ring_density:5.50,
    warp:0.00, drift_amp:0.50, drift_speed:0.17,
    hue:0.88, vignette:1.00,
    sparkle_size:12.0, sparkle_rate:0.39, sparkle:1.0, num_centers:6.0,
    vortexHex:'#D1CCDE',
    retro:{hex:'#ffffff',opa:0.11,off:false},
    cf:{hex:'#ffb8ce',opa:0.15,off:false},
  },
  yandere:{
    speed:1.00, steps:0.06, ring_density:2.00,
    warp:0.00, drift_amp:0.30, drift_speed:0.10,
    hue:0.92, vignette:1.00,
    sparkle_size:10.0, sparkle_rate:0.55, sparkle:1.0, num_centers:4.0,
    vortexHex:'#ffb3d9',
    retro:{hex:'#ffffff',opa:0.11,off:false},
    cf:{hex:'#ff9fd0',opa:0.20,off:false},
  },
  drug:{
    speed:4.50, steps:0.06, ring_density:9.50,
    warp:0.40, drift_amp:0.45, drift_speed:0.30,
    hue:-0.35, vignette:1.00,
    sparkle_size:14.0, sparkle_rate:0.30, sparkle:1.0, num_centers:8.0,
    vortexHex:'#7fd8ff',
    retro:{hex:'#00ffe0',opa:0.16,off:false},
    cf:{hex:'#7fe8ff',opa:0.20,off:false},
  },
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
  NeedyGirlState.set(STORAGE_KEY, JSON.stringify({ profiles:PROFILES }));
}
const saved=loadSaved();

const PROFILES={};
PROFILE_KEYS.forEach(mode=>{
  const def=PROFILE_DEFAULTS[mode], sv=saved.profiles?.[mode]||{};
  PROFILES[mode]={
    ...def, ...sv,
    retro:{...def.retro, ...(sv.retro||{})},
    cf:{...def.cf, ...(sv.cf||{})},
  };
});

/* ── Pointer ── */
const mouse={x:0.5,y:0.5,tx:0.5,ty:0.5};
function pointer(e){ const p=e.touches?e.touches[0]:e; mouse.tx=p.clientX/innerWidth; mouse.ty=1.0-p.clientY/innerHeight; }
addEventListener('mousemove',pointer);
addEventListener('touchmove',(e)=>{pointer(e);e.preventDefault();},{passive:false});

// externalMode/Intensity: last value actually received from EffectDirector
// via ng-holo-mode (the real, stat-driven signal). previewMode/Intensity:
// non-null while the panel's Mode dropdown below is forcing a mode for
// editing — takes priority over the external signal, so dragging a slider
// is visible immediately without needing real StatStore affection/darkness
// at the right values. See frame() below for how these combine into the
// actually-applied profile/intensity each draw.
let externalMode='normal', externalIntensity=0;
let previewMode=null, previewIntensity=1;

/* This iframe is always full-viewport (so #panel below isn't cropped — see
   the top-of-file #holo-clip comment); #holo-clip itself is positioned to
   Frame 1's live box by the parent instead, via ng-holo-frame1-box. That
   iframe also isn't necessarily the topmost element there (z-order tracks
   Frame 1, see setZIndex in holographicLayer.js) — so it won't reliably get
   real mousemove/touchmove events of its own either; the parent forwards
   pointer position (already normalized against Frame 1's box) instead.
   Same-origin check since NeedyGirl always serves both from one origin. */
addEventListener('message', (e)=>{
  if(e.origin!==location.origin) return;
  const d=e.data;
  if(d && d.type==='ng-holographic-pointer'){ mouse.tx=d.tx; mouse.ty=d.ty; }
  else if(d && d.type==='ng-holo-mode'){
    externalMode=(d.mode && PROFILES[d.mode]) ? d.mode : 'normal';
    externalIntensity=Math.max(0,Math.min(1,d.intensity??0));
  }
  else if(d && d.type==='ng-holo-frame1-box'){
    Object.assign(holoClip.style,{
      left:`${d.left}px`, top:`${d.top}px`, width:`${d.width}px`, height:`${d.height}px`,
      transform: d.rotation ? `rotate(${d.rotation}rad)` : 'none',
      visibility:'visible',
    });
    resize();
  }
});

/* ── Resize ── canvas resolution now tracks #holo-clip's own box (Frame 1's
   live size), not the full iframe viewport — the longest-side clamp this
   used to do locally now lives in shared/device-perf.js's
   getPerfResolutionCap() itself, so every consumer (Stage.js, pixelCursor,
   this) gets it automatically. */
function resize(){
  const scale=window.getPerfResolutionCap?window.getPerfResolutionCap():Math.min(window.devicePixelRatio||1,2);
  const w=holoClip.clientWidth||innerWidth, h=holoClip.clientHeight||innerHeight;
  canvas.width=Math.floor(w*scale); canvas.height=Math.floor(h*scale);
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
function clamp01(v){ return Math.max(0,Math.min(1,v)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function vecToHex(v){
  const h=(x)=>Math.round(clamp01(x)*255).toString(16).padStart(2,'0');
  return `#${h(v[0])}${h(v[1])}${h(v[2])}`;
}
function lerpHex(hexA,hexB,t){
  const a=hexToVec3(hexA), b=hexToVec3(hexB);
  return vecToHex([lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)]);
}

/* ── Slider builder ── bound to whichever profile is currently selected for
   editing (previewMode, see refreshModeFields() below) rather than one
   shared object — switching the Mode dropdown re-points every slider at a
   different PROFILES[mode] entry and refreshes their displayed values. */
const sliderRows=[]; // {key, sl, val, step} — replayed by refreshModeFields()
function makeSlider({id,label,min,max,step,key,noMax}){
  const ct=document.getElementById(id);
  const top=document.createElement('div'); top.className='sg-top';
  const lbl=document.createElement('span'); lbl.className='sg-label'; lbl.textContent=label;
  const val=document.createElement('span'); val.className='sg-val';
  top.appendChild(lbl); top.appendChild(val);

  const tr=document.createElement('div'); tr.className='sg-track';
  const sl=document.createElement('input'); sl.type='range';
  sl.min=min; sl.max=max; sl.step=step;
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
  function upd(){
    if(!previewMode) return;
    const v=parseFloat(sl.value);
    PROFILES[previewMode][key]=v;
    val.textContent=v.toFixed(step<1?2:0);
    saveState();
  }
  sl.addEventListener('input',upd);
  sliderRows.push({key,sl,val,step});
}

/* ── Build sliders (structure only — values populated once a mode is
   selected, see refreshModeFields()) ── */
makeSlider({id:'sg-speed',label:'Flow Speed',   min:0.1,max:5,   step:0.05, key:'speed'       });
makeSlider({id:'sg-steps',label:'Sharpness',    min:0,  max:1,   step:0.01, key:'steps'       });
makeSlider({id:'sg-ring', label:'Ring Density', min:1,  max:30,  step:0.5,  key:'ring_density'});
makeSlider({id:'sg-ncen', label:'Vortex Count', min:1,  max:8,   step:1,    key:'num_centers', noMax:true});
makeSlider({id:'sg-warp', label:'Warp',         min:0,  max:1,   step:0.01, key:'warp'        });
makeSlider({id:'sg-damp', label:'Drift Range',  min:0,  max:0.5, step:0.005,key:'drift_amp'   });
makeSlider({id:'sg-dspd', label:'Drift Speed',  min:0,  max:1,   step:0.01, key:'drift_speed' });
makeSlider({id:'sg-hue',  label:'Hue Shift',    min:-1, max:1,   step:0.01, key:'hue'         });
makeSlider({id:'sg-vig',  label:'Vignette',     min:0,  max:1,   step:0.01, key:'vignette'    });
makeSlider({id:'sg-ssize',label:'Sparkle Grid', min:2,  max:20,  step:0.5,  key:'sparkle_size'});
makeSlider({id:'sg-srate',label:'Sparkle Rate', min:0,  max:1,   step:0.01, key:'sparkle_rate'});

/* ── Vortex colour picker ── */
const vortexColorInp=document.getElementById('vortex-color');
vortexColorInp.addEventListener('input', e=>{
  if(!previewMode) return;
  PROFILES[previewMode].vortexHex=e.target.value;
  saveState();
});

/* ── Retro scan-line overlay ── rendered opacity/colour is computed fresh
   every frame in frame() below (blended by the ACTIVE mode, which can
   differ from whichever mode this panel is currently EDITING) — these
   handlers only write into the profile being edited and refresh this
   panel's own display; they never touch retroEl's CSS directly. */
const retroEl=document.getElementById('retro');
const retroBtn=document.getElementById('retro-btn');
const retroColorInp=document.getElementById('retro-color');
const retroOpaInp=document.getElementById('retro-opa');
const retroOpaMaxInp=document.getElementById('retro-opa-max');
const retroPctEl=document.getElementById('retro-pct');
retroColorInp.addEventListener('input',e=>{
  if(!previewMode) return;
  PROFILES[previewMode].retro.hex=e.target.value; saveState();
});
retroOpaInp.addEventListener('input',e=>{
  if(!previewMode) return;
  PROFILES[previewMode].retro.opa=parseFloat(e.target.value);
  retroPctEl.textContent=Math.round(PROFILES[previewMode].retro.opa*100)+'%';
  saveState();
});
retroOpaMaxInp.addEventListener('change',e=>{
  if(!previewMode) return;
  const nm=parseFloat(e.target.value);
  if(!isNaN(nm)&&nm>0){
    retroOpaInp.max=nm;
    if(PROFILES[previewMode].retro.opa>nm){ PROFILES[previewMode].retro.opa=nm; retroOpaInp.value=nm; saveState(); }
  } else e.target.value=retroOpaInp.max;
});
retroBtn.onclick=()=>{
  if(!previewMode) return;
  const p=PROFILES[previewMode];
  p.retro.off=!p.retro.off;
  retroBtn.classList.toggle('on',!p.retro.off);
  saveState();
};

/* ── Colour filter overlay ── same "editing vs. actively-rendering mode can
   differ" separation as the scanline overlay above. */
const cfEl=document.getElementById('cf');
const cfBtn=document.getElementById('cf-btn');
const cfColorInp=document.getElementById('cf-color');
const cfOpaInp=document.getElementById('cf-opa');
const cfOpaMaxInp=document.getElementById('cf-opa-max');
const cfPctEl=document.getElementById('cf-pct');
cfColorInp.addEventListener('input',e=>{
  if(!previewMode) return;
  PROFILES[previewMode].cf.hex=e.target.value; saveState();
});
cfOpaInp.addEventListener('input',e=>{
  if(!previewMode) return;
  PROFILES[previewMode].cf.opa=parseFloat(e.target.value);
  cfPctEl.textContent=Math.round(PROFILES[previewMode].cf.opa*100)+'%';
  saveState();
});
cfOpaMaxInp.addEventListener('change',e=>{
  if(!previewMode) return;
  const nm=parseFloat(e.target.value);
  if(!isNaN(nm)&&nm>0){
    cfOpaInp.max=nm;
    if(PROFILES[previewMode].cf.opa>nm){ PROFILES[previewMode].cf.opa=nm; cfOpaInp.value=nm; saveState(); }
  } else e.target.value=cfOpaInp.max;
});
cfBtn.onclick=()=>{
  if(!previewMode) return;
  const p=PROFILES[previewMode];
  p.cf.off=!p.cf.off;
  cfBtn.classList.toggle('on',!p.cf.off);
  saveState();
};

/* ── Sparkle toggle ── */
const sparkleBtn=document.getElementById('sparkle-btn');
sparkleBtn.onclick=()=>{
  if(!previewMode) return;
  const p=PROFILES[previewMode];
  p.sparkle=p.sparkle>0.5?0.0:1.0;
  sparkleBtn.classList.toggle('on',p.sparkle>0.5);
  saveState();
};

/* ── Mode dropdown + Preview Intensity + refresh-all-fields ── selecting a
   mode both forces it active for live preview (previewMode/Intensity, see
   frame() below) AND re-points every slider above (Motion/Shape/Color/
   Sparkle/Overlays/vortex colour) at that mode's own PROFILES entry.
   'Auto' hides the whole editable section: there's no single fixed profile
   to show sliders for while StatStore is driving a continuous blend
   between two of them. */
const mpSelect=document.getElementById('mp-select');
const mpIntensityEl=document.getElementById('sg-mp-intensity');
const modeFieldsEl=document.getElementById('mode-fields');

{
  const top=document.createElement('div'); top.className='sg-top';
  const lbl=document.createElement('span'); lbl.className='sg-label'; lbl.textContent='Preview Intensity';
  const val=document.createElement('span'); val.className='sg-val'; val.textContent=previewIntensity.toFixed(2);
  top.appendChild(lbl); top.appendChild(val);
  const tr=document.createElement('div'); tr.className='sg-track';
  const sl=document.createElement('input'); sl.type='range'; sl.min=0; sl.max=1; sl.step=0.01; sl.value=previewIntensity;
  tr.appendChild(sl);
  mpIntensityEl.appendChild(top); mpIntensityEl.appendChild(tr);
  sl.addEventListener('input',()=>{ previewIntensity=parseFloat(sl.value); val.textContent=previewIntensity.toFixed(2); });
}

function refreshModeFields(){
  const hidden=!previewMode;
  mpIntensityEl.classList.toggle('mp-hidden',hidden);
  modeFieldsEl.classList.toggle('mp-hidden',hidden);
  if(hidden) return;
  const p=PROFILES[previewMode];
  sliderRows.forEach(({key,sl,val,step})=>{
    const v=p[key];
    sl.value=v; val.textContent=v.toFixed(step<1?2:0);
  });
  vortexColorInp.value=p.vortexHex;
  retroColorInp.value=p.retro.hex; retroOpaInp.value=p.retro.opa;
  retroBtn.classList.toggle('on',!p.retro.off);
  retroPctEl.textContent=Math.round(p.retro.opa*100)+'%';
  cfColorInp.value=p.cf.hex; cfOpaInp.value=p.cf.opa;
  cfBtn.classList.toggle('on',!p.cf.off);
  cfPctEl.textContent=Math.round(p.cf.opa*100)+'%';
  sparkleBtn.classList.toggle('on',p.sparkle>0.5);
}
mpSelect.addEventListener('change',()=>{ previewMode=mpSelect.value||null; refreshModeFields(); });
refreshModeFields();

/* ── Save (download PNG) ── */
document.getElementById('save-btn').onclick=()=>{
  const a=document.createElement('a'); a.download='holographic-radiating.png';
  a.href=canvas.toDataURL('image/png'); a.click();
};

/* ── Reset (clear ALL saved profiles and reload coded defaults) ── */
document.getElementById('reset-btn').onclick=()=>{
  NeedyGirlState.remove(STORAGE_KEY);
  location.reload();
};

/* ── Panel toggle ── this iframe is click-through by default when embedded
   (see holographicLayer.js) — the internal panel-toggle button below only
   works when this effect is viewed standalone; embedded, the parent's own
   🔮 proxy button flips pointer-events on and messages ng-holo-toggle here
   instead (mirrors UI/retroFilter/script.js's ng-retrofilter-toggle). */
const panel=document.getElementById('panel');
document.getElementById('panel-toggle').onclick=()=>panel.classList.toggle('closed');
addEventListener('message',(e)=>{
  if(e.origin!==location.origin) return;
  if(e.data?.type==='ng-holo-toggle') panel.classList.toggle('closed');
});

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

  // Blend the active mode's FULL profile against 'normal' by intensity —
  // every field differs independently per mode now, so this lerps the
  // whole profile rather than adding small deltas on top of one shared
  // base (the earlier HOLO_MODE_PRESET design). previewMode (forced by the
  // panel's Mode dropdown) takes priority over EffectDirector's real signal
  // so editing is visible immediately.
  const activeMode=previewMode||externalMode;
  const activeIntensity=activeMode==='normal'?0:(previewMode?previewIntensity:externalIntensity);
  const base=PROFILES.normal, mode=PROFILES[activeMode]||base;
  const t=activeIntensity;

  const effSpeed=lerp(base.speed,mode.speed,t);
  const effSteps=lerp(base.steps,mode.steps,t);
  const effRing=lerp(base.ring_density,mode.ring_density,t);
  const effWarp=lerp(base.warp,mode.warp,t);
  const effDriftAmp=lerp(base.drift_amp,mode.drift_amp,t);
  const effDriftSpeed=lerp(base.drift_speed,mode.drift_speed,t);
  const effHue=lerp(base.hue,mode.hue,t);
  const effVignette=lerp(base.vignette,mode.vignette,t);
  const effSparkleSize=lerp(base.sparkle_size,mode.sparkle_size,t);
  const effSparkleRate=lerp(base.sparkle_rate,mode.sparkle_rate,t);
  const effSparkle=lerp(base.sparkle,mode.sparkle,t); // both are 0/1 -- lerp naturally snaps at t=0.5 since the shader just checks >0.5
  const effNumCenters=lerp(base.num_centers,mode.num_centers,t);
  const [br,bg,bb]=hexToVec3(base.vortexHex), [mr,mg,mb]=hexToVec3(mode.vortexHex);
  const effPr=lerp(br,mr,t), effPg=lerp(bg,mg,t), effPb=lerp(bb,mb,t);

  gl.uniform2f(U.res,canvas.width,canvas.height);
  gl.uniform1f(U.time,(now-start)/1000);
  gl.uniform2f(U.mouse,mouse.x,mouse.y);
  gl.uniform1f(U.speed,effSpeed);
  gl.uniform1f(U.steps,effSteps);
  gl.uniform1f(U.sparkle,effSparkle);
  gl.uniform1f(U.ring_density,effRing);
  gl.uniform1f(U.warp_strength,effWarp);
  gl.uniform1f(U.hue_shift,effHue);
  gl.uniform1f(U.drift_amp,effDriftAmp);
  gl.uniform1f(U.drift_speed,effDriftSpeed);
  gl.uniform1f(U.sparkle_size,effSparkleSize);
  gl.uniform1f(U.sparkle_rate,effSparkleRate);
  gl.uniform1f(U.vignette,effVignette);
  gl.uniform1f(U.num_centers,effNumCenters);
  gl.uniform3f(U.pal_a,effPr,effPg,effPb);
  gl.drawArrays(gl.TRIANGLES,0,3);

  // Baked overlays (retro scanline / colour filter) are plain DOM/CSS, not
  // shader uniforms, but blend the same way — recomputed every frame here
  // (cheap: two CSS string writes) rather than only on slider input, so
  // they track the same continuous stat-driven intensity the shader does,
  // even though the panel might currently be EDITING a different mode's
  // values than the one actually rendering.
  const retroOpaEff=lerp(base.retro.off?0:base.retro.opa, mode.retro.off?0:mode.retro.opa, t);
  const retroHexEff=lerpHex(base.retro.hex, mode.retro.hex, t);
  const rt=hexToRgba(retroHexEff,0), rs=hexToRgba(retroHexEff,retroOpaEff);
  retroEl.style.backgroundImage=`repeating-linear-gradient(0deg,${rt} 0px,${rt} 2px,${rs} 2px,${rs} 3px)`;

  const cfOpaEff=lerp(base.cf.off?0:base.cf.opa, mode.cf.off?0:mode.cf.opa, t);
  const cfHexEff=lerpHex(base.cf.hex, mode.cf.hex, t);
  cfEl.style.background=hexToRgba(cfHexEff,cfOpaEff);
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
