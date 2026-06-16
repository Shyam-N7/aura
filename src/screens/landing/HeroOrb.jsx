import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// Quick capability probe so the parent can choose the CSS-orb fallback up front.
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function readAccent(el) {
  try {
    const v = getComputedStyle(el).getPropertyValue('--color-accent').trim();
    if (/^#|^rgb/i.test(v)) return v;
  } catch { /* ignore */ }
  return '#b06a3f';
}

/* The audio-reactive hero orb. An icosahedron whose vertices are displaced by
   3D simplex noise every frame — gently (time-based "breathing") when idle, and
   harder when audio is playing (amplitude from the shared AnalyserNode). three +
   simplex-noise are dynamically imported so they only download when the orb will
   actually render (never under reduced-motion / no-WebGL, and never for the app).
   Renders on the single gsap.ticker (shared with Lenis); pauses off-screen/hidden.
   `onReady` fires once the canvas is live so the parent can hide the CSS orb. */
export function HeroOrb({ isPlaying, analyser, onReady }) {
  const mountRef = useRef(null);
  const live = useRef({ isPlaying, analyser });
  live.current = { isPlaying, analyser };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let disposed = false;
    let teardown = null;

    Promise.all([import('three'), import('simplex-noise')])
      .then(([THREE, SN]) => {
        if (disposed || !mount) return;
        const noise3D = SN.createNoise3D();
        const small = window.matchMedia('(max-width: 900px)').matches;
        const w = mount.clientWidth || 480;
        const h = mount.clientHeight || 480;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.z = 3.1;

        const renderer = new THREE.WebGLRenderer({ antialias: !small, alpha: true, powerPreference: 'low-power' });
        renderer.setSize(w, h);
        // Cap the drawing buffer at 1.5× — the orb is soft/organic so 1.5 reads
        // fine, and it's ~44% fewer framebuffer pixels than 2× on retina.
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        mount.appendChild(renderer.domElement);

        const accent = new THREE.Color(readAccent(mount));
        const geometry = new THREE.IcosahedronGeometry(1, small ? 3 : 4);
        const basePos = geometry.attributes.position.array.slice();
        const posAttr = geometry.attributes.position;
        const nVerts = posAttr.count;

        const material = new THREE.MeshStandardMaterial({
          color: accent, emissive: accent, emissiveIntensity: 0.25, roughness: 0.32, metalness: 0.0,
        });
        const orb = new THREE.Mesh(geometry, material);
        scene.add(orb);

        // Soft glow halo (backside additive-ish sphere).
        const haloGeo = new THREE.SphereGeometry(1.4, 32, 32);
        const haloMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.05, side: THREE.BackSide });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        scene.add(halo);

        const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 4, 5); scene.add(key);
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const rim = new THREE.PointLight(accent.getHex(), 0.9, 20); rim.position.set(-3, -2, 2); scene.add(rim);

        let buf = null;
        let level = 0;
        let tick = 0;
        let visible = true;
        const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
        io.observe(mount);

        const start = performance.now();
        const render = () => {
          if (disposed) return;
          if (!visible || document.hidden) return;
          if (++tick % 2) return;                    // ~30fps — plenty for a slow orb, halves GPU work
          const t = (performance.now() - start) / 1000;

          const { isPlaying: playing, analyser: an } = live.current;
          let target = 0;
          if (playing && an) {
            if (!buf || buf.length !== an.frequencyBinCount) buf = new Uint8Array(an.frequencyBinCount);
            an.getByteFrequencyData(buf);
            let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
            target = (sum / buf.length) / 255;
          }
          level += (target - level) * 0.12;          // smooth toward target

          const amp = 0.14 + level * 0.6;
          const freqScale = 1.35;
          const arr = posAttr.array;
          for (let i = 0; i < nVerts; i++) {
            const ix = i * 3;
            const bx = basePos[ix], by = basePos[ix + 1], bz = basePos[ix + 2];
            const n = noise3D(bx * freqScale + t * 0.22, by * freqScale + t * 0.22, bz * freqScale - t * 0.15);
            const d = 1 + n * amp;
            arr[ix] = bx * d; arr[ix + 1] = by * d; arr[ix + 2] = bz * d;
          }
          posAttr.needsUpdate = true;
          geometry.computeVertexNormals();

          orb.rotation.y += 0.0015 + level * 0.012;
          orb.rotation.x = Math.sin(t * 0.2) * 0.12;
          material.emissiveIntensity = 0.25 + level * 0.6;
          halo.scale.setScalar(1 + level * 0.12);
          renderer.render(scene, camera);
        };

        gsap.ticker.add(render);
        renderer.render(scene, camera);   // one guaranteed frame so the canvas isn't blank when onReady hides the CSS orb
        onReady?.();

        const onResize = () => {
          const ww = mount.clientWidth, hh = mount.clientHeight;
          if (!ww || !hh) return;
          camera.aspect = ww / hh; camera.updateProjectionMatrix(); renderer.setSize(ww, hh);
        };
        window.addEventListener('resize', onResize);

        teardown = () => {
          gsap.ticker.remove(render);
          io.disconnect();
          window.removeEventListener('resize', onResize);
          geometry.dispose(); material.dispose(); haloGeo.dispose(); haloMat.dispose();
          renderer.dispose();
          try { renderer.forceContextLoss(); } catch { /* not all contexts support it */ }
          if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
        };
      })
      .catch(() => { /* import/setup failed — parent keeps the CSS orb */ });

    return () => { disposed = true; teardown?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="hero-orb" aria-hidden="true" />;
}
