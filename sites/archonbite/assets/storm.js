/*
 * Salty Pirate backdrop: a stylised-realistic 3D storm sea (WebGL, no image or video download).
 * The camera rides a few metres above the swell and looks at the horizon. The water is a height field of peaked,
 * domain-warped wave trains; rays find it with a secant search, then get a Fresnel mix of the storm sky's reflection
 * and a dark-green body colour that glows through thin crests, foam on the crests, rain rings near the camera, and
 * distance fog. The palette follows the cold, desaturated teal of the page.
 * Cost control: renders at a fraction of the window size and lowers that fraction itself when frames run slow;
 * pauses in a hidden tab; prefers-reduced-motion gets one still frame and no lightning. Without WebGL the CSS
 * gradient fallback stays.
 */
(function () {
  'use strict';
  var main = document.querySelector('main[data-game-page="salty-pirate"]');
  if (!main) return;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var cv = document.createElement('canvas');
  cv.className = 'storm'; cv.setAttribute('aria-hidden', 'true');
  var gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' });
  if (!gl) return;

  var VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var FS = [
    'precision highp float;',
    'uniform vec2 R;uniform float T;uniform float F;',
    'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    ' return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
    'float fbm(vec2 p){float a=.5,s=0.;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*noise(p);p=m*p;a*=.5;}return s;}',

    // Height field: wave trains that turn ~57 degrees per octave, get shorter, faster (rough deep-water dispersion)
    // and less peaked. The warp keeps crests from lining up into a visible grid.
    'float sea(vec2 p,int oct){',
    ' float h=0.,a=1.05,f=.11,ch=3.4;vec2 d=vec2(.94,.34);',
    ' for(int i=0;i<6;i++){if(i>=oct)break;',
    '  vec2 q=p*f;q+=.9*vec2(noise(q*.7+T*.03),noise(q*.7-T*.03+5.3));',
    '  float sp=T*(.9+1.1*sqrt(float(i)+1.));',
    '  float w=.5+.5*sin(dot(q,d)*2.2-sp);',
    '  float w2=.5+.5*sin(dot(q,vec2(-d.y,d.x))*1.3+sp*.6+1.7);',
    '  h+=a*(pow(w,ch)*.8+w2*w*.35);',
    '  d=mat2(.54,-.84,.84,.54)*d;f*=1.95;a*=.42;ch=max(1.2,ch*.72);}',
    ' if(oct>5)h+=.02*fbm(p*2.4+vec2(T*.5,T*.25));', // wind chop, only for close-up shading
    ' return h;}',

    'vec3 sky(vec3 rd){',
    ' float y=max(rd.y,0.);',
    ' vec3 c=mix(vec3(.20,.29,.265),vec3(.04,.07,.068),pow(y,.5));',
    ' vec2 cp=rd.xz/(rd.y+.09)*.9+vec2(T*.015,T*.04);',
    ' float cl=smoothstep(.34,.74,fbm(cp*.5)+.15*fbm(cp*2.3));',
    ' float horizonFade=smoothstep(-.02,.22,rd.y);',
    ' c=mix(c*1.18,vec3(.05,.075,.075),cl*.92*horizonFade);',
    ' c+=vec3(.10,.14,.13)*exp(-abs(rd.y)*16.)*.7;', // pale band where rain hides the horizon
    ' c+=F*vec3(.42,.52,.54)*(.25+cl*1.2)*horizonFade;', // lightning lights the cloud deck from inside
    ' return c;}',

    // camera-near raindrop rings: grid cells with random birth times
    'float ripples(vec2 p){',
    ' vec2 id=floor(p),f=fract(p)-.5;float h=hash(id);',
    ' vec2 o=(vec2(hash(id+3.1),hash(id+7.7))-.5)*.5;',
    ' float t=fract(T*(.5+.4*h)+h*9.);',
    ' return step(.35,h)*smoothstep(.035,.0,abs(length(f-o)-t*.45))*(1.-t)*(1.-t);}',

    'vec3 water(vec3 p,vec3 n,vec3 rd,float dist,float h){',
    ' float fres=pow(clamp(1.-dot(n,-rd),0.,1.),3.)*.72;',
    ' vec3 refl=sky(reflect(rd,n));',
    ' float sh=pow(n.y*.4+.6,4.);sh=mix(sh,floor(sh*4.+.5)/4.,.6);', // soft banding: painted, not photographic
    ' vec3 body=vec3(.008,.026,.024)+vec3(.045,.115,.095)*sh*.22;',
    ' body+=vec3(.06,.13,.115)*max(h-.9,0.)*1.1;', // light glowing through thin wave crests
    ' vec3 c=mix(body,refl,fres);vec3 L=normalize(vec3(.35,.22,1.));c+=vec3(.30,.38,.36)*pow(max(dot(reflect(rd,n),L),0.),48.)*smoothstep(160.,10.,dist);',
    ' float foam=smoothstep(1.3,1.37,h+.5*fbm(p.xz*2.1+vec2(T*.15,0.)))*smoothstep(140.,25.,dist);',
    ' c=mix(c,vec3(.40,.45,.42),foam*.55);',
    ' c+=vec3(.22,.29,.27)*(ripples(p.xz*1.7)+ripples(p.xz*2.9+4.)*.6)*smoothstep(22.,3.,dist)*.6;',
    ' return c;}',

    // thin falling streaks in screen space, three depths; kept faint so they read as weather, not a pattern
    'float rain(vec2 uv,float sc,float len,float sp,float seed){',
    ' uv=mat2(.986,-.166,.166,.986)*uv;',
    ' vec2 g=vec2(uv.x*sc,uv.y*sc/len+T*sp);vec2 id=floor(g),f=fract(g);float h=hash(id+seed);',
    ' float x=f.x-.5-(hash(id+seed+3.)-.5)*.7;',
    ' return step(.72,h)*smoothstep(.07,0.,abs(x))*smoothstep(0.,.3,f.y)*smoothstep(1.,.55,f.y)*(h-.72)*3.6;}',

    'void main(){',
    ' vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;',
    ' float bob=.22*sin(T*.55)+.08*sin(T*1.3);',
    ' vec3 ro=vec3(0.,3.1+bob,T*.9);',
    ' float roll=.025*sin(T*.4),pitch=-.11+.015*sin(T*.7);',
    ' vec3 rd=normalize(vec3(uv.x*cos(roll)-uv.y*sin(roll),uv.x*sin(roll)+uv.y*cos(roll)+pitch,1.55));',
    ' vec3 col;',
    ' if(rd.y>-.001){col=sky(rd);}',
    ' else{',
    '  float tm=0.,tx=420.;vec3 p=ro+rd*tx;float hx=p.y-sea(p.xz,3);',
    '  float hm=ro.y-sea(ro.xz,3);float t=tx;',
    '  for(int i=0;i<9;i++){t=mix(tm,tx,hm/(hm-hx));p=ro+rd*t;float hh=p.y-sea(p.xz,3);if(hh<0.){tx=t;hx=hh;}else{tm=t;hm=hh;}}',
    '  int oct=t<45.?6:4;',
    '  float e=.004+t*.0016;float h0=sea(p.xz,oct);',
    '  vec3 n=normalize(vec3(h0-sea(p.xz+vec2(e,0.),oct),e,h0-sea(p.xz+vec2(0.,e),oct)));',
    '  col=water(p,n,rd,t,h0);',
    '  vec3 fogc=sky(normalize(vec3(rd.x,.002,rd.z)));',
    '  col=mix(col,fogc,1.-exp(-t*.021));',
    ' }',
    ' float r=rain(uv,16.,7.,9.,1.)*.10+rain(uv+.37,34.,6.,13.,2.)*.075+rain(uv+.71,70.,5.,17.,3.)*.055;',
    ' col+=vec3(.62,.72,.70)*r;',
    ' col+=F*.06;',
    ' float g=dot(col,vec3(.299,.587,.114));col=mix(vec3(g),col,.78);', // a little film desaturation
    ' col*=.72;col*=1.-.45*smoothstep(.35,1.05,length(uv*vec2(.85,1.15)));',
    ' col+=(hash(gl_FragCoord.xy+fract(T)*61.)-.5)*.015;',
    ' gl_FragColor=vec4(col,1.);}'
  ].join('\n');

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (window.console) console.warn('storm shader:', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var uR = gl.getUniformLocation(pr, 'R'), uT = gl.getUniformLocation(pr, 'T'), uF = gl.getUniformLocation(pr, 'F');

  // Resolution fraction: the sea is soft and fogged, so half resolution upscaled looks the same and costs a quarter.
  var small = window.innerWidth < 700, scale = small ? 0.4 : 0.5, minScale = small ? 0.28 : 0.33;
  var run = false, raf = 0, t0 = performance.now(), nextFlash = 8 + Math.random() * 6, slow = 0, lastNow = 0;
  function size() {
    var w = Math.max(2, Math.round(window.innerWidth * scale)), h = Math.max(2, Math.round(window.innerHeight * scale));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
  }
  // one slow swell of light, then a weaker echo: a smooth envelope, never a hard strobe
  function flash(t) {
    if (reduce) return 0;
    var d = t - nextFlash;
    if (d < 0) return 0;
    if (d > 2.4) { nextFlash = t + 11 + Math.random() * 10; return 0; }
    var a = Math.exp(-d * 3) * Math.min(1, d * 8), b = Math.exp(-(d - .4) * 3.4) * Math.min(1, Math.max(0, d - .4) * 8) * .5;
    return Math.max(a, b);
  }
  function draw(now) {
    var t = (now - t0) / 1000;
    gl.uniform2f(uR, cv.width, cv.height); gl.uniform1f(uT, t * 0.5); gl.uniform1f(uF, flash(t));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) {
    if (!run) return;
    // adaptive quality: ~1.5 s of frames slower than 30 fps lowers the render fraction one step
    if (lastNow) { if (now - lastNow > 33) slow++; else if (slow > 0) slow--; }
    lastNow = now;
    if (slow > 45 && scale > minScale) { scale = Math.max(minScale, scale - 0.07); slow = 0; size(); }
    draw(now); raf = requestAnimationFrame(loop);
  }
  function start() { if (reduce || run) return; run = true; lastNow = 0; raf = requestAnimationFrame(loop); }
  function stop() { run = false; cancelAnimationFrame(raf); }

  document.body.insertBefore(cv, document.body.firstChild);
  document.documentElement.classList.add('storm-on');
  size(); draw(t0 + 12000);
  window.addEventListener('resize', function () { size(); if (!run) draw(performance.now()); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  start();
})();
