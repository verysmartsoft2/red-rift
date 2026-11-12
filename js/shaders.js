// Shared GLSL snippets + material factories.
import * as THREE from 'three';

export const GLSL_NOISE = /* glsl */`
float hash3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.-2.*f);
 return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; } return s; }
`;

const ROCK_FN = /* glsl */`
vec3 rockColor(vec3 p, vec3 n){
  float w = fbm3(p*0.012)*2.2 + vnoise(p*0.09)*0.5;
  float band = p.y*0.085 + w*0.4;
  float b1 = 0.5+0.5*sin(band); float b2 = 0.5+0.5*sin(band*2.7+1.3);
  vec3 c1 = vec3(0.42,0.12,0.055), c2 = vec3(0.70,0.27,0.11), c3 = vec3(0.86,0.50,0.27), c4 = vec3(0.24,0.075,0.045);
  vec3 col = mix(c1,c2,b1);
  col = mix(col,c3, smoothstep(0.72,1.0,b2)*0.75);
  col = mix(col,c4, smoothstep(0.78,1.0,1.0-b1)*0.7);
  float streak = vnoise(vec3(p.x*0.07,p.y*0.012,p.z*0.07));
  col *= 0.68+0.42*streak;
  col *= 0.82+0.3*vnoise(p*0.55);
  vec3 sand = vec3(0.80,0.45,0.22)*(0.85+0.25*fbm3(p*0.04));
  float ripple = 0.5+0.5*sin(p.x*0.35+p.z*0.12+vnoise(p*0.03)*6.0);
  sand *= 0.93+0.09*ripple;
  float fl = smoothstep(0.70,0.92,n.y);
  // salt lake around the start (reference: white crust with hexagonal cracks)
  float salt = uSalt.w * (1.0 - smoothstep(uSalt.z * 0.65, uSalt.z, length(p.xz - uSalt.xy))) * smoothstep(0.85, 0.97, n.y);
  vec2 hq = p.xz * 0.055; vec2 hr = vec2(1.0, 1.732); vec2 hh = hr * 0.5;
  vec2 ha = mod(hq, hr) - hh; vec2 hb = mod(hq - hh, hr) - hh; vec2 hg = dot(ha, ha) < dot(hb, hb) ? ha : hb;
  float hx = max(dot(abs(hg), normalize(vec2(1.0, 1.732))), abs(hg.x));
  float crack = smoothstep(0.44, 0.5, hx) * (0.6 + 0.4 * vnoise(p * 0.3));
  vec3 saltC = vec3(0.92, 0.89, 0.85) * (0.9 + 0.1 * vnoise(p * 0.15)) * (1.0 - 0.45 * crack);
  return mix(mix(col, sand, fl), saltC, salt);
}
`;

// Rock / terrain material: strata by world height + sand on flats; optional tunnel-mouth holes.
export function makeRockMaterial({ portals = null, tint = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0.0 });
  m.userData.uniforms = {
    uSalt: { value: new THREE.Vector4(0, 0, 1, 0) },
    uPortA: { value: new THREE.Vector3(1e6, 0, 0) }, uDirA: { value: new THREE.Vector3(1, 0, 0) },
    uPortB: { value: new THREE.Vector3(1e6, 0, 0) }, uDirB: { value: new THREE.Vector3(1, 0, 0) },
    uPR: { value: 0 }, uTint: { value: tint },
  };
  if (portals) Object.assign(m.userData.uniforms, portals);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n mat4 mm4 = modelMatrix;\n#ifdef USE_INSTANCING\n mm4 = modelMatrix * instanceMatrix;\n#endif\n vWPos = (mm4 * vec4(transformed,1.0)).xyz; vWNrm = normalize(mat3(mm4) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;\nuniform vec3 uPortA,uDirA,uPortB,uDirB; uniform float uPR; uniform float uTint; uniform vec4 uSalt;\n' + GLSL_NOISE + ROCK_FN)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        { vec3 d = vWPos-uPortA; float al = dot(d,uDirA); if (abs(al)<34.0 && length(d-al*uDirA)<uPR) discard; }
        { vec3 d = vWPos-uPortB; float al = dot(d,uDirB); if (abs(al)<34.0 && length(d-al*uDirB)<uPR) discard; }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= rockColor(vWPos, normalize(vWNrm)) * uTint;');
  };
  return m;
}

// Soft radial sprite texture
let _soft;
export function softTex() {
  if (_soft) return _soft;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _soft = new THREE.CanvasTexture(c); _soft.colorSpace = THREE.SRGBColorSpace;
  return _soft;
}

let _smoke;
export function smokeTex() {
  if (_smoke) return _smoke;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 18 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  _smoke = new THREE.CanvasTexture(c); _smoke.colorSpace = THREE.SRGBColorSpace;
  return _smoke;
}

// Additive glow material for beams/flares: core white -> colour falloff across the beam (uv.x)
export function beamMaterial(color, opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec2 vUv;
      void main(){ float d = abs(vUv.x-0.5)*2.0; float core = smoothstep(0.35,0.0,d); float glow = pow(1.0-d,2.2);
        float flick = 0.85+0.15*sin(vUv.y*80.0-uTime*60.0);
        vec3 c = uColor*glow*1.6*flick + vec3(1.0)*core*1.4; float a = (glow*0.75+core)*uOpacity;
        gl_FragColor = vec4(c*a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Holographic force-field (hex grid), fades in near the player
export function forceFieldMaterial(color = 0x38f3ff) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPlayer: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBase: { value: 0.0 } },
    vertexShader: `varying vec3 vW; varying vec2 vUv; attribute float aBase; varying float vBase;
      void main(){ vUv=uv; vBase=aBase; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uPlayer; uniform float uTime; varying vec3 vW; varying vec2 vUv; varying float vBase;
      float hexd(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0,1.73))), p.x); }
      void main(){
        vec2 p = vUv*vec2(0.11,0.11);
        vec2 r = vec2(1.0,1.73); vec2 h = r*0.5;
        vec2 a = mod(p,r)-h; vec2 b = mod(p-h,r)-h; vec2 g = dot(a,a)<dot(b,b)?a:b;
        float edge = smoothstep(0.44,0.5,hexd(g));
        float dist = distance(vW,uPlayer);
        float near = smoothstep(150.0,15.0,dist);
        float pulse = 0.6+0.4*sin(uTime*3.0 - dist*0.08);
        float alpha = edge*(near*0.9*pulse + vBase*0.22) + near*0.05;
        if (alpha<0.003) discard;
        gl_FragColor = vec4(uColor*alpha*1.6, alpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
