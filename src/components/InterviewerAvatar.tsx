import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla Three.js avatar — avoids @react-three/fiber entirely so it doesn't
// conflict with @splinetool's internally-bundled Three.js copy.
// ─────────────────────────────────────────────────────────────────────────────

interface InterviewerAvatarProps {
    isSpeaking: boolean;
    accentColor?: 'blue' | 'green' | 'purple';
}

const RING_COLORS: Record<string, string> = {
    blue: 'border-blue-400/40 shadow-blue-500/30',
    green: 'border-green-400/40 shadow-green-500/30',
    purple: 'border-purple-400/40 shadow-purple-500/30',
};

export function InterviewerAvatar({
    isSpeaking,
    accentColor = 'blue',
}: InterviewerAvatarProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isSpeakingRef = useRef(isSpeaking);
    const disposeRef = useRef<(() => void) | null>(null);

    // Keep a live ref so the animation loop can read current value without
    // needing a re-render or closure update.
    useEffect(() => {
        isSpeakingRef.current = isSpeaking;
    }, [isSpeaking]);

    // Build the Three.js scene once on mount.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // ── Renderer ───────────────────────────────────────────────────────────
        const renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;

        // ── Scene & Camera ─────────────────────────────────────────────────────
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
            38,
            canvas.clientWidth / canvas.clientHeight,
            0.01,
            100,
        );
        camera.position.set(0, 0.05, 0.45);

        // ── Lights ─────────────────────────────────────────────────────────────
        scene.add(new THREE.AmbientLight(0xffffff, 1.2));

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
        keyLight.position.set(1, 2, 2);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x8b9eff, 0.6);
        fillLight.position.set(-1, 0, 1);
        scene.add(fillLight);

        // ── Morph-target helpers ───────────────────────────────────────────────
        let headMesh: THREE.SkinnedMesh | null = null;
        let teethMesh: THREE.SkinnedMesh | null = null;

        const getMorphIndex = (mesh: THREE.SkinnedMesh, name: string): number | undefined =>
            mesh.morphTargetDictionary?.[name];

        const setMorph = (mesh: THREE.SkinnedMesh | null, name: string, value: number) => {
            if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) return;
            const idx = getMorphIndex(mesh, name);
            if (idx !== undefined) mesh.morphTargetInfluences[idx] = value;
        };

        const lerp = THREE.MathUtils.lerp;

        // ── Load GLB ───────────────────────────────────────────────────────────
        const loader = new GLTFLoader();
        let animFrameId = 0;
        let modelGroup: THREE.Group | null = null;
        let blinkValue = 0;
        let blinkTimer = Math.random() * 4 + 2;
        let prevTimestamp = 0;

        loader.load('/model.glb', (gltf) => {
            modelGroup = gltf.scene;

            // Find the two meshes by name
            gltf.scene.traverse((obj) => {
                if (!(obj instanceof THREE.SkinnedMesh)) return;
                if (obj.name === 'AvatarHead') headMesh = obj;
                if (obj.name === 'AvatarTeethLower') teethMesh = obj;
            });

            scene.add(modelGroup);

            // ── Positioning ──────────────────────────────────────────────────
            // Most humanoid models are ~1.7m tall. To show the head, we move 
            // the model down so the head is at the camera's level.
            modelGroup.position.y = -1.55;
            modelGroup.position.z = 0;

            // ── Animation loop ─────────────────────────────────────────────────
            const clock = new THREE.Clock();

            const animate = () => {
                animFrameId = requestAnimationFrame(animate);
                const t = clock.getElapsedTime();
                const delta = clock.getDelta();

                // Jaw animation
                const speaking = isSpeakingRef.current;
                const targetJaw = speaking
                    ? Math.max(0, Math.sin(t * 9) * 0.45 + 0.3)
                    : 0;

                if (headMesh?.morphTargetInfluences && headMesh.morphTargetDictionary) {
                    const idx = getMorphIndex(headMesh, 'jawOpen');
                    if (idx !== undefined) {
                        headMesh.morphTargetInfluences[idx] = lerp(
                            headMesh.morphTargetInfluences[idx] ?? 0,
                            targetJaw,
                            0.18,
                        );
                    }
                }
                if (teethMesh?.morphTargetInfluences && teethMesh.morphTargetDictionary) {
                    const idx = getMorphIndex(teethMesh, 'jawOpen');
                    if (idx !== undefined) {
                        teethMesh.morphTargetInfluences[idx] = lerp(
                            teethMesh.morphTargetInfluences[idx] ?? 0,
                            targetJaw,
                            0.18,
                        );
                    }
                }

                // Blink
                blinkTimer -= delta;
                if (blinkTimer <= 0) {
                    blinkValue = 1;
                    blinkTimer = Math.random() * 4 + 2;
                }
                blinkValue = lerp(blinkValue, 0, 0.15);
                setMorph(headMesh, 'eyeBlinkLeft', blinkValue);
                setMorph(headMesh, 'eyeBlinkRight', blinkValue);

                // Idle head bob (relative to centered position)
                if (modelGroup) {
                    modelGroup.position.y = -1.55 + Math.sin(t * 0.8) * 0.005;
                    modelGroup.rotation.y = Math.sin(t * 0.5) * 0.03;
                }

                // Resize if canvas changed size
                const w = canvas.clientWidth;
                const h = canvas.clientHeight;
                if (canvas.width !== w || canvas.height !== h) {
                    renderer.setSize(w, h, false);
                    camera.aspect = w / h;
                    camera.updateProjectionMatrix();
                }

                renderer.render(scene, camera);
            };

            animate();
        });

        // ── Cleanup ────────────────────────────────────────────────────────────
        const dispose = () => {
            cancelAnimationFrame(animFrameId);
            renderer.dispose();
        };
        disposeRef.current = dispose;
        return dispose;
    }, []); // run once on mount only

    return (
        <div className="relative w-full h-full">
            {/* 3-D canvas */}
            <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{ display: 'block', background: 'transparent' }}
            />

            {/* Animated speaking rings */}
            {isSpeaking && (
                <>
                    <div
                        className={`absolute inset-[-8px] border-2 rounded-xl pointer-events-none ${RING_COLORS[accentColor]} animate-[ping_1.8s_ease-out_infinite]`}
                    />
                    <div
                        className={`absolute inset-[-16px] border rounded-xl pointer-events-none ${RING_COLORS[accentColor]} animate-[ping_2.3s_ease-out_infinite]`}
                    />
                </>
            )}
        </div>
    );
}

export default InterviewerAvatar;
