/*
 * Salty Pirate backdrop: a procedural stormy sea seen from above (WebGL, no image download).
 * Why a shader and not video/sprites: it scales to any screen, costs ~4 KB, and lets the sea, rain, ripples and a distant
 * maelstrom share one lighting model, which is what makes it read as stylised realism instead of cartoon art.
 * It renders at reduced resolution (the sea is soft anyway), pauses when the tab is hidden, and with
 * prefers-reduced-motion draws one still frame with no lightning. Without WebGL the CSS gradient fallback stays.
 */
(function () {
  'use strict';
  var main = document.querySelector('main[data-game-page="salty-pirate"]');
  if (!main) return;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var cv = document.createElement('canvas');
  cv.className = 'storm'; cv.setAttribute('aria-hidden', 'true');
  var gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return;

  var VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var FS = [
    'precision highp float;',
    'uniform vec2 R;uniform float T;uniform float F;',
    'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    ' return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
    'float fbm(vec2 p){float a=.5,s=0.;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*noise(p);p=m*p;a*=.5;}return s;}',
    'const vec2 C=vec2(.75,-.35);', // maelstrom centre, off to the right of the text column
    'vec2 swirl(vec2 p){vec2 d=p-C;float r=length(d);float a=1.0*exp(-r*1.2)+.15*sin(T*.07);float s=sin(a),c=cos(a);return C+mat2(c,-s,s,c)*d;}',
    'float sw(vec2 q,vec2 d,float f,float w,float sp){float v=.5+.5*sin(dot(q,d)*f+w*11.-T*sp);return v*v;}',
    'float height(vec2 p){',
    ' vec2 q=swirl(p);float w=fbm(q*1.6+vec2(T*.03,T*.02));',
    ' float h=.5*sw(q,vec2(.8,.6),7.,w,.7)+.3*sw(q,vec2(-.5,.86),12.,w,1.1)+.2*sw(q,vec2(.2,-.98),21.,w,1.6);',
    ' h+=.1*fbm(q*30.+vec2(0.,T*.12))+.05*fbm(q*70.-vec2(T*.1,0.));',
    ' return h;}',

    'float streaks(vec2 p,float scale,float speed,float seed){',
    ' float c=cos(.2),s=sin(.2);p=mat2(c,-s,s,c)*p;',
    ' vec2 g=vec2(p.x*scale,p.y*scale*.09);vec2 id=floor(g);float h=hash(id+seed);',
    ' float x=fract(g.x)-.5-(h-.5)*.55;',
    ' float y=fract(g.y+T*speed*(.7+h*.6)+h*13.);',
    ' float on=step(.5,hash(id*1.7+seed));',
    ' return on*smoothstep(.045,.0,abs(x))*smoothstep(0.,.03,y)*smoothstep(.5,.04,y)*(.35+.65*h);}',
    'float ripples(vec2 p,float k){',
    ' vec2 g=p*k;vec2 id=floor(g);vec2 f=fract(g)-.5;float h=hash(id);',
    ' vec2 o=(vec2(hash(id+3.1),hash(id+7.7))-.5)*.5;',
    ' float t=fract(T*(.22+.2*h)+h*9.);float d=abs(length(f-o)-t*.42);',
    ' return step(.45,h)*smoothstep(.028,.0,d)*(1.-t)*(1.-t);}',
    'void main(){',
    ' vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;uv.y=-uv.y;',
    ' vec2 p=uv*1.4;float e=.006;',
    ' float h=height(p);float hx=height(p+vec2(e,0.));float hy=height(p+vec2(0.,e));',
    ' vec3 n=normalize(vec3(-(hx-h)*4.4,-(hy-h)*4.4,1.));',
    ' vec3 L=normalize(vec3(-.35,.45,.8));',
    ' float diff=clamp(dot(n,L),0.,1.);',
    ' float spec=pow(max(dot(reflect(-L,n),vec3(0.,0.,1.)),0.),22.);',
    ' vec3 deep=vec3(.012,.030,.038),mid=vec3(.055,.095,.104),hi=vec3(.21,.28,.27);',
    ' vec3 col=mix(deep,mid,smoothstep(.2,1.0,h*.8+diff*.4));',
    ' col=mix(col,hi,smoothstep(.9,1.35,h+diff*.2)*.45);',
    ' col+=vec3(.55,.64,.61)*spec*.5;',
    ' float foam=smoothstep(1.05,1.3,h+fbm(swirl(p)*22.)*.25);',
    ' col=mix(col,vec3(.62,.69,.66),foam*.45);',
    ' float rr=length(p-C);',
    ' col*=mix(.32,1.,smoothstep(.02,.85,rr));',        // dark eye of the maelstrom
    ' col*=1.-.4*smoothstep(.3,.9,length(uv*vec2(.8,1.)));', // overall vignette
    ' float rain=streaks(p,60.,1.5,1.)*.5+streaks(p+9.,34.,1.1,2.)*.45+streaks(p+21.,90.,2.1,3.)*.3;',
    ' col+=vec3(.7,.8,.78)*rain*.62;',
    ' col+=vec3(.7,.8,.78)*(ripples(p,11.)+ripples(p+4.,18.)*.7)*.28;',
    ' col+=F*vec3(.20,.26,.27)*(.45+h+spec*2.);',        // lightning: one soft swell, never a hard strobe
    ' float g=dot(col,vec3(.299,.587,.114));col=mix(vec3(g),col,.62);', // pull colour toward film-grey
    ' col*=1.3;col+=(hash(gl_FragCoord.xy+fract(T)*61.)-.5)*.035;',
    ' gl_FragColor=vec4(col,1.);}'
  ].join('\n');

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var uR = gl.getUniformLocation(pr, 'R'), uT = gl.getUniformLocation(pr, 'T'), uF = gl.getUniformLocation(pr, 'F');

  var scale = window.innerWidth < 700 ? 0.45 : 0.75, run = false, raf = 0, t0 = performance.now(), nextFlash = 9 + Math.random() * 6;
  function size() {
    var w = Math.max(2, Math.round(window.innerWidth * scale)), h = Math.max(2, Math.round(window.innerHeight * scale));
    cv.width = w; cv.height = h; gl.viewport(0, 0, w, h);
  }
  // one slow swell of light, then a weaker echo: smooth envelope so it can never strobe
  function flash(t) {
    if (reduce) return 0;
    var d = t - nextFlash;
    if (d < 0) return 0;
    if (d > 2.2) { nextFlash = t + 11 + Math.random() * 9; return 0; }
    var a = Math.exp(-d * 3.2) * Math.min(1, d * 9), b = Math.exp(-(d - .35) * 3.6) * Math.min(1, Math.max(0, d - .35) * 9) * .55;
    return Math.max(a, b);
  }
  function draw(now) {
    var t = (now - t0) / 1000;
    gl.uniform2f(uR, cv.width, cv.height); gl.uniform1f(uT, t); gl.uniform1f(uF, flash(t));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) { if (!run) return; draw(now); raf = requestAnimationFrame(loop); }
  function start() { if (reduce || run) return; run = true; raf = requestAnimationFrame(loop); }
  function stop() { run = false; cancelAnimationFrame(raf); }

  document.body.insertBefore(cv, document.body.firstChild);
  document.documentElement.classList.add('storm-on');
  size(); draw(t0 + 14000);
  window.addEventListener('resize', function () { size(); if (!run) draw(performance.now()); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  start();
})();
