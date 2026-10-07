/** The sky dome and the gantry's name banner. */
import * as THREE from "three";
import type { Mood } from "../../data/types";

/** The gantry's banner: the circuit's name drawn at runtime onto a CanvasTexture. */
export function lpBanner(text: string, w: number, h: number): THREE.Mesh {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const g = c.getContext("2d") as CanvasRenderingContext2D, font = (px: number) => `800 ${px}px "Hanken Grotesk", "Helvetica Neue", Arial, sans-serif`;
  g.fillStyle = "#0f131c"; g.fillRect(0, 0, 512, 96); g.fillStyle = "#e8b84c"; g.fillRect(0, 86, 512, 10);
  let px = 58; g.font = font(px); while (g.measureText(text).width > 472 && px > 18) g.font = font(--px);
  g.fillStyle = "#f1f3f8"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 44);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), new THREE.MeshBasicMaterial({ map: tex }));
  m.userData.text = text; return m;
}

/** Gradient sky dome with a sun glow, drawn behind everything and kept centred on the camera. */
export function lpSky(mood: Mood, sunDir: THREE.Vector3): THREE.Mesh {
  const u = { top: { value: new THREE.Color(mood.sky.top) }, bottom: { value: new THREE.Color(mood.sky.bottom) }, fogC: { value: new THREE.Color(mood.fog.color) }, sunC: { value: new THREE.Color(mood.sun.color) }, sunD: { value: sunDir.clone() } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vD; void main(){ vD=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 fogC; uniform vec3 sunC; uniform vec3 sunD; varying vec3 vD;
        void main(){ vec3 d=normalize(vD); float y=d.y;
          vec3 c=y<0.?fogC:mix(mix(fogC,bottom,smoothstep(0.,.07,y)),top,pow(smoothstep(.04,.6,y),.8));
          float s=max(dot(d,sunD),0.); c+=sunC*(smoothstep(.99955,.99975,s)*.85+pow(s,24.)*.25);
          gl_FragColor=vec4(c,1.);
          #include <colorspace_fragment>
        }`,
  }));
  m.renderOrder = -1; m.frustumCulled = false; return m;
}
