/**
 * Runner Road — та же сцена, что car-road; персонажи из person/
 */
(function () {
    const MODELS_ROOT = 'assets/models/';
    const PERSON_DIR = 'person/';
    const TEXTURES_BASE = '../car-road/assets/textures/';
    const ACTOR_X = -2.2;
    const ACTOR_ROT_Y = Math.PI;
    const GROUND_Y = -0.85;
    const ROAD_Y = GROUND_Y + 0.14;
    const ROAD_THICKNESS = 0.14;
    const ROAD_SURFACE_Y = ROAD_Y + ROAD_THICKNESS;
    const TILE_WIDTH = 28;
    const ROAD_DEPTH = 2.4;
    const GROUND_DEPTH = 72;
    const GROUND_TEX_TILE = 36;
    const BASE_SPEED = 5;
    const BOOST_MULT = 2.5;
    const GRAVITY = -18;
    const JUMP_VY = 6.2;
    const STATE_SUFFIX_RX = /_(run|jump)$/i;
    const CAMERA_RADIUS_MIN = 4.8;
    const CAMERA_RADIUS_MAX = 13.5;

    const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer, scene, camera;
    let runner = null;
    let runnerMixer = null;
    let runnerAnimations = [];
    let runnerGroundOffset = 0;
    let activeModelFile = null;
    let selectedRunnerFile = null;
    let runnerFiles = [];
    let allPersonFiles = [];
    let runnerIndex = 0;
    let characterVariants = { idle: null, run: null, jump: null };
    let characterState = 'idle';
    let modelCache = new Map();
    let roadTiles = [];
    let groundTiles = [];
    let roadMaterial = null;
    let roadTopMaterial = null;
    let roadSideMaterial = null;
    let groundMaterial = null;
    let roadUvScroll = 0;
    let groundUvScroll = 0;
    let dustParticles = [];
    let lastT = 0;
    let runHeld = false;
    let scrollSpeed = BASE_SPEED;
    let isJumping = false;
    let jumpY = 0;
    let jumpVy = 0;
    let jumpStateTimer = 0;
    let camShake = 0;
    const cameraOrbit = {
        yaw: -0.55,
        pitch: 0.2,
        radius: 7.8,
        dragging: false,
        pointerId: null,
        lastX: 0,
        lastY: 0
    };
    const orbitPointers = new Map();
    let pinchStartDist = 0;
    let pinchStartRadius = cameraOrbit.radius;

    const canvas = document.getElementById('game-canvas');
    const gameLoading = document.getElementById('game-loading');
    const gameUi = document.getElementById('game-ui');
    const btnRun = document.getElementById('btnRun');
    const btnJump = document.getElementById('btnJump');
    const btnNextRunner = document.getElementById('btnNextRunner');

    function assetUrl(path) {
        return new URL(path, document.baseURI).href;
    }

    function waitForThree() {
        return window.GltfHelpers?.waitForThree() ?? Promise.resolve(false);
    }

    function clampCameraRadius(r) {
        return Math.max(CAMERA_RADIUS_MIN, Math.min(CAMERA_RADIUS_MAX, r));
    }

    function orbitPointerDistance() {
        const pts = [...orbitPointers.values()];
        if (pts.length < 2) return 0;
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        return Math.hypot(dx, dy);
    }

    function syncPinchBaseline() {
        pinchStartDist = orbitPointerDistance();
        pinchStartRadius = cameraOrbit.radius;
    }

    function isBasePersonFile(file) {
        if (!/\.glb$/i.test(file) || !file.startsWith(PERSON_DIR)) return false;
        const name = (file.split('/').pop() || '').replace(/\.glb$/i, '');
        return !STATE_SUFFIX_RX.test(name);
    }

    function personBaseName(file) {
        return (file.split('/').pop() || '').replace(/\.glb$/i, '').replace(STATE_SUFFIX_RX, '');
    }

    function findPersonFile(name) {
        const target = name.toLowerCase();
        return allPersonFiles.find((f) => (f.split('/').pop() || '').toLowerCase() === target) || null;
    }

    function buildCharacterVariants(baseFile) {
        const base = personBaseName(baseFile);
        return {
            idle: findPersonFile(base + '.glb') || baseFile,
            run: findPersonFile(base + '_run.glb'),
            jump: findPersonFile(base + '_jump.glb')
        };
    }

    function createSurfaceMaterial(color, roughness = 0.92) {
        const THREE = window.THREE;
        return new THREE.MeshStandardMaterial({
            color,
            roughness,
            metalness: 0,
            side: THREE.DoubleSide
        });
    }

    function loadTexture(url) {
        const THREE = window.THREE;
        return new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(url, resolve, undefined, reject);
        });
    }

    function setupRepeatingTexture(tex, repeatX, repeatY, rotate90 = true) {
        const THREE = window.THREE;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.center.set(0.5, 0.5);
        tex.rotation = rotate90 ? Math.PI / 2 : 0;
        if ('colorSpace' in tex && THREE.SRGBColorSpace) {
            tex.colorSpace = THREE.SRGBColorSpace;
        }
        return tex;
    }

    async function loadWorldMaterials() {
        const THREE = window.THREE;
        roadMaterial = createSurfaceMaterial(0x3a3a3a, 0.88);
        roadSideMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.96,
            metalness: 0
        });
        groundMaterial = createSurfaceMaterial(0x5c7a42);

        try {
            const roadTex = setupRepeatingTexture(
                await loadTexture(assetUrl(TEXTURES_BASE + 'road.png')),
                1,
                1,
                true
            );
            roadTopMaterial = new THREE.MeshStandardMaterial({
                map: roadTex,
                roughness: 0.88,
                metalness: 0,
                side: THREE.DoubleSide
            });
            roadMaterial = roadTopMaterial;
        } catch (e) {
            console.warn('road.png not found', e);
            roadTopMaterial = roadMaterial;
        }

        try {
            const groundTex = setupRepeatingTexture(
                await loadTexture(assetUrl(TEXTURES_BASE + 'ground.png')),
                1,
                1,
                true
            );
            groundMaterial = new THREE.MeshStandardMaterial({
                map: groundTex,
                roughness: 0.92,
                metalness: 0,
                side: THREE.DoubleSide
            });
        } catch (e) {
            console.warn('ground.png not found', e);
        }
    }

    function makeGroundTile(x) {
        const THREE = window.THREE;
        const geo = new THREE.PlaneGeometry(TILE_WIDTH, GROUND_DEPTH);
        const uv = geo.attributes.uv;
        const depthTiles = GROUND_DEPTH / GROUND_TEX_TILE;
        for (let i = 0; i < uv.count; i++) {
            uv.setY(i, uv.getY(i) * depthTiles);
        }
        const mesh = new THREE.Mesh(geo, groundMaterial);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, GROUND_Y - 0.02, 0);
        mesh.receiveShadow = false;
        scene.add(mesh);
        return { mesh, width: TILE_WIDTH };
    }

    function makeRoadTile(x) {
        const THREE = window.THREE;
        const mats = [
            roadSideMaterial || roadMaterial,
            roadSideMaterial || roadMaterial,
            roadTopMaterial || roadMaterial,
            roadSideMaterial || roadMaterial,
            roadSideMaterial || roadMaterial,
            roadSideMaterial || roadMaterial
        ];
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(TILE_WIDTH, ROAD_THICKNESS, ROAD_DEPTH),
            mats
        );
        mesh.position.set(x, ROAD_Y + ROAD_THICKNESS * 0.5, 0);
        mesh.receiveShadow = false;
        scene.add(mesh);
        return { mesh, width: TILE_WIDTH };
    }

    function initWorld() {
        const THREE = window.THREE;

        const SKY_RADIUS = 220;
        const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            fog: false,
            depthWrite: false,
            uniforms: {
                uTop: { value: new THREE.Color(0x3d2f78) },
                uMid: { value: new THREE.Color(0xe87840) },
                uBot: { value: new THREE.Color(0xffb347) }
            },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform vec3 uTop;
                uniform vec3 uMid;
                uniform vec3 uBot;
                varying vec3 vWorldPos;
                void main() {
                    vec3 dir = normalize(vWorldPos);
                    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
                    float horizon = smoothstep(0.08, 0.38, t);
                    float zenith = smoothstep(0.45, 0.92, t);
                    vec3 col = mix(uBot, uMid, horizon);
                    col = mix(col, uTop, zenith);
                    col += vec3(0.12, 0.04, 0.02) * (1.0 - abs(t - 0.32) * 3.0);
                    gl_FragColor = vec4(col, 1.0);
                }
            `
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        sky.renderOrder = -1000;
        scene.add(sky);

        scene.add(new THREE.HemisphereLight(0xffc89b, 0x8b5a3c, 0.5));
        scene.add(new THREE.AmbientLight(0xffffff, 0.42));
        const sun = new THREE.DirectionalLight(0xfff5e0, 0.85);
        sun.position.set(5, 10, 8);
        scene.add(sun);

        for (let i = 0; i < 3; i++) {
            const x = ACTOR_X + (i - 1) * TILE_WIDTH;
            groundTiles.push(makeGroundTile(x));
            roadTiles.push(makeRoadTile(x));
        }
    }

    function scrollTiles(tiles, move) {
        for (const tile of tiles) tile.mesh.position.x -= move;
        for (const tile of tiles) {
            if (tile.mesh.position.x <= -TILE_WIDTH * 1.5) {
                let maxX = -Infinity;
                for (const t of tiles) maxX = Math.max(maxX, t.mesh.position.x);
                tile.mesh.position.x = maxX + tile.width;
            }
        }
    }

    async function getModelData(file) {
        if (modelCache.has(file)) return modelCache.get(file);
        const gltf = await window.GltfHelpers.loadGlb(assetUrl(MODELS_ROOT + file));
        const data = { scene: gltf.scene, animations: gltf.animations || [] };
        modelCache.set(file, data);
        return data;
    }

    function disposeRunner() {
        if (!runner) return;
        scene.remove(runner);
        runner.traverse((ch) => {
            if (ch.geometry) ch.geometry.dispose();
            if (ch.material) {
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                mats.forEach((m) => m.dispose());
            }
        });
        runner = null;
        if (runnerMixer) {
            runnerMixer.stopAllAction();
            runnerMixer = null;
        }
    }

    function playRunnerAnimations() {
        if (!runner || !runnerAnimations.length) return;
        const THREE = window.THREE;
        runnerMixer = new THREE.AnimationMixer(runner);
        runnerAnimations.forEach((clip) => {
            runnerMixer.clipAction(clip).reset().play();
        });
    }

    async function loadRunnerModel(file) {
        if (!file) return;
        const H = window.GltfHelpers;
        const data = await getModelData(file);
        disposeRunner();
        activeModelFile = file;
        const template = data.scene;
        H.prepareModelAsAuthored(template, { groundY: 0 });
        runner = template.clone(true);
        runnerAnimations = data.animations;
        runner.rotation.y = ACTOR_ROT_Y;
        scene.add(runner);
        updateRunnerPosition();
        runner.updateMatrixWorld(true);
        const box = new window.THREE.Box3().setFromObject(runner);
        runnerGroundOffset = runner.position.y - box.min.y;
        playRunnerAnimations();
    }

    async function applyCharacterState(state) {
        characterState = state;
        const nextFile = characterVariants[state] || characterVariants.idle;
        if (!nextFile || nextFile === activeModelFile) return;
        const savedJump = jumpY;
        await loadRunnerModel(nextFile);
        jumpY = savedJump;
        updateRunnerPosition();
    }

    function setupCharacter(baseFile) {
        characterVariants = buildCharacterVariants(baseFile);
        characterState = 'idle';
    }

    async function initRunnerList() {
        const files = await window.GltfHelpers.loadModelsManifest(assetUrl(MODELS_ROOT));
        allPersonFiles = files.filter((f) => /\.glb$/i.test(f) && f.startsWith(PERSON_DIR));
        runnerFiles = allPersonFiles.filter(isBasePersonFile);
        runnerFiles.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        runnerIndex = Math.max(0, runnerFiles.indexOf(selectedRunnerFile));
    }

    async function loadRunner(file) {
        selectedRunnerFile = file;
        setupCharacter(file);
        jumpY = 0;
        jumpVy = 0;
        isJumping = false;
        jumpStateTimer = 0;
        await loadRunnerModel(characterVariants.idle || file);
    }

    async function nextRunner() {
        if (!runnerFiles.length) return;
        runnerIndex = (runnerIndex + 1) % runnerFiles.length;
        await loadRunner(runnerFiles[runnerIndex]);
    }

    function updateRunnerPosition() {
        if (!runner) return;
        runner.position.x = ACTOR_X;
        runner.position.y = ROAD_SURFACE_Y + jumpY;
        runner.position.z = 0;
        runner.rotation.y = ACTOR_ROT_Y;
        if (isJumping || jumpY > 0.01) {
            runner.rotation.z = Math.sin(performance.now() * 0.012) * 0.15 - 0.1;
        } else {
            runner.rotation.z *= 0.92;
        }
    }

    function updateJump(dt) {
        if (jumpStateTimer > 0) jumpStateTimer -= dt;
        if (!isJumping && jumpY <= 0) {
            jumpY = 0;
            jumpVy = 0;
            return;
        }
        jumpVy += GRAVITY * dt;
        jumpY += jumpVy * dt;
        if (jumpY <= 0) {
            jumpY = 0;
            jumpVy = 0;
            isJumping = false;
            camShake = 0.15;
            if (characterState === 'jump') {
                const next = runHeld ? 'run' : 'idle';
                applyCharacterState(next).catch((e) => console.warn(e));
            }
        }
    }

    function syncRunState() {
        if (isJumping || jumpStateTimer > 0) return;
        const want = runHeld ? 'run' : 'idle';
        if (want !== characterState && characterState !== 'jump') {
            applyCharacterState(want).catch((e) => console.warn(e));
        }
    }

    function triggerJump() {
        if (isJumping) return;
        isJumping = true;
        jumpVy = JUMP_VY;
        jumpStateTimer = 0.4;
        applyCharacterState('jump').catch((e) => console.warn(e));
    }

    const DUST_MAX = 200;

    function spawnDust(mode = 'boost') {
        if (!runner || dustParticles.length >= DUST_MAX) return;
        const THREE = window.THREE;
        const isIdle = mode === 'idle';
        const size = isIdle ? 0.06 + Math.random() * 0.06 : 0.09 + Math.random() * 0.11;
        const shade = 0x5a5f66 + Math.floor(Math.random() * 0x303030);
        const p = new THREE.Mesh(
            new THREE.SphereGeometry(size, 5, 5),
            new THREE.MeshBasicMaterial({
                color: shade,
                transparent: true,
                opacity: isIdle ? 0.35 + Math.random() * 0.15 : 0.55 + Math.random() * 0.25
            })
        );
        const wheelZ = isIdle
            ? (Math.random() - 0.5) * 0.12
            : (Math.random() < 0.5 ? -0.45 : 0.45);
        p.position.set(
            ACTOR_X - 0.08 - Math.random() * (isIdle ? 0.22 : 0.45),
            ROAD_SURFACE_Y + 0.02 + Math.random() * (isIdle ? 0.02 : 0.04),
            wheelZ + (Math.random() - 0.5) * 0.12
        );
        scene.add(p);
        const life = isIdle ? 0.45 + Math.random() * 0.35 : 0.75 + Math.random() * 0.55;
        dustParticles.push({
            mesh: p,
            life,
            maxLife: life,
            vx: isIdle ? -2.2 - Math.random() * 1.1 : -4.5 - Math.random() * 3,
            vy: isIdle ? 0.18 + Math.random() * 0.45 : 0.35 + Math.random() * 1.1,
            vz: isIdle ? (Math.random() - 0.5) * 0.45 : (Math.random() - 0.5) * 1.4
        });
    }

    function updateDust(dt) {
        for (let i = dustParticles.length - 1; i >= 0; i--) {
            const d = dustParticles[i];
            d.life -= dt;
            d.mesh.position.x += d.vx * dt;
            d.mesh.position.y += (d.vy || 0) * dt;
            d.mesh.position.z += (d.vz || 0) * dt;
            const fade = d.life / (d.maxLife || 0.75);
            d.mesh.material.opacity = fade * 0.85;
            d.mesh.scale.setScalar(0.7 + (1 - fade) * 2.2);
            if (d.life <= 0) {
                scene.remove(d.mesh);
                d.mesh.geometry.dispose();
                d.mesh.material.dispose();
                dustParticles.splice(i, 1);
            }
        }
        if (runHeld) {
            const burst = 7 + Math.floor(Math.random() * 5);
            for (let n = 0; n < burst; n++) spawnDust('boost');
        } else if (scrollSpeed >= BASE_SPEED * 0.95) {
            const idleBurst = 1 + (Math.random() < 0.45 ? 1 : 0);
            for (let n = 0; n < idleBurst; n++) spawnDust('idle');
        }
    }

    function scrollWorld(dt, speed) {
        const move = speed * dt;
        scrollTiles(groundTiles, move);
        scrollTiles(roadTiles, move);
        if (groundMaterial?.map) {
            groundUvScroll -= move / TILE_WIDTH * 1.15;
            groundMaterial.map.offset.y = groundUvScroll % 1;
        }
        if (roadMaterial?.map) {
            roadUvScroll -= move / TILE_WIDTH * 1.15;
            roadMaterial.map.offset.y = roadUvScroll % 1;
        }
    }

    function loop(t) {
        if (!lastT) lastT = t;
        const dt = Math.min(0.05, (t - lastT) / 1000);
        lastT = t;
        if (runnerMixer) runnerMixer.update(dt);

        scrollSpeed = runHeld ? BASE_SPEED * BOOST_MULT : BASE_SPEED;
        if (runHeld) camShake = Math.min(0.08, camShake + dt * 2);

        scrollWorld(dt, scrollSpeed);
        syncRunState();
        updateJump(dt);
        updateRunnerPosition();
        updateDust(dt);

        if (camera) {
            const shakeX = camShake > 0 ? (Math.random() - 0.5) * camShake : 0;
            const shakeY = camShake > 0 ? (Math.random() - 0.5) * camShake * 0.5 : 0;
            const lookX = ACTOR_X;
            const lookY = ROAD_SURFACE_Y + jumpY + 0.45;
            const lookZ = 0;
            const cosPitch = Math.cos(cameraOrbit.pitch);
            const sinPitch = Math.sin(cameraOrbit.pitch);
            const cosYaw = Math.cos(cameraOrbit.yaw);
            const sinYaw = Math.sin(cameraOrbit.yaw);
            camera.position.x = lookX + cameraOrbit.radius * cosPitch * cosYaw + shakeX;
            camera.position.y = lookY + cameraOrbit.radius * sinPitch + shakeY;
            camera.position.y = Math.max(ROAD_SURFACE_Y + 0.75, camera.position.y);
            camera.position.z = lookZ + cameraOrbit.radius * cosPitch * sinYaw;
            camera.lookAt(lookX, lookY, lookZ);
            camShake *= 0.9;
        }

        renderer.render(scene, camera);
        requestAnimationFrame(loop);
    }

    function bindControls() {
        const setRun = (on) => {
            runHeld = on;
            btnRun?.classList.toggle('is-active', on);
        };
        btnRun?.addEventListener('pointerdown', (e) => { e.preventDefault(); setRun(true); });
        btnRun?.addEventListener('pointerup', () => setRun(false));
        btnRun?.addEventListener('pointerleave', () => setRun(false));
        btnRun?.addEventListener('pointercancel', () => setRun(false));

        btnJump?.addEventListener('click', (e) => {
            e.preventDefault();
            triggerJump();
        });

        btnNextRunner?.addEventListener('click', (e) => {
            e.preventDefault();
            nextRunner();
        });

        const canStartDrag = (target) => {
            if (!target) return true;
            return !target.closest('#runner-select, .controls, .hub-back, .btn');
        };

        window.addEventListener('pointerdown', (e) => {
            if (!canStartDrag(e.target)) return;
            orbitPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (orbitPointers.size === 1) {
                cameraOrbit.dragging = true;
                cameraOrbit.pointerId = e.pointerId;
                cameraOrbit.lastX = e.clientX;
                cameraOrbit.lastY = e.clientY;
            } else if (orbitPointers.size >= 2) {
                cameraOrbit.dragging = false;
                cameraOrbit.pointerId = null;
                syncPinchBaseline();
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (!orbitPointers.has(e.pointerId)) return;
            orbitPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (orbitPointers.size >= 2) {
                const dist = orbitPointerDistance();
                if (pinchStartDist > 1) {
                    cameraOrbit.radius = clampCameraRadius(pinchStartRadius / (dist / pinchStartDist));
                }
                return;
            }
            if (!cameraOrbit.dragging || cameraOrbit.pointerId !== e.pointerId) return;
            const dx = e.clientX - cameraOrbit.lastX;
            const dy = e.clientY - cameraOrbit.lastY;
            cameraOrbit.lastX = e.clientX;
            cameraOrbit.lastY = e.clientY;
            cameraOrbit.yaw -= dx * 0.006;
            cameraOrbit.pitch = Math.max(0.03, Math.min(0.78, cameraOrbit.pitch - dy * 0.004));
        });

        const stopOrbitPointer = (e) => {
            orbitPointers.delete(e.pointerId);
            if (cameraOrbit.pointerId === e.pointerId) {
                cameraOrbit.dragging = false;
                cameraOrbit.pointerId = null;
            }
            if (orbitPointers.size >= 2) syncPinchBaseline();
            else pinchStartDist = 0;
        };
        window.addEventListener('pointerup', stopOrbitPointer);
        window.addEventListener('pointercancel', stopOrbitPointer);

        window.addEventListener('wheel', (e) => {
            if (canvas?.classList.contains('is-hidden')) return;
            if (e.target?.closest?.('#runner-select, .controls, .hub-back, .btn')) return;
            e.preventDefault();
            cameraOrbit.radius = clampCameraRadius(cameraOrbit.radius + e.deltaY * 0.004);
        }, { passive: false });
    }

    async function init() {
        if (prefersReducedMotion) {
            const hint = document.querySelector('.hint-bar');
            if (hint) hint.textContent = 'Анимация отключена в системе';
            return;
        }
        const ready = await waitForThree();
        if (!ready) return;

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.1, 80);
        camera.position.set(4, 2.2, 11);

        const onResize = () => {
            renderer.setSize(innerWidth, innerHeight, false);
            camera.aspect = innerWidth / innerHeight;
            camera.updateProjectionMatrix();
        };
        onResize();
        window.addEventListener('resize', onResize);

        await loadWorldMaterials();
        initWorld();
        scene.background = new THREE.Color(0x3d2f78);
        scene.fog = new THREE.Fog(0xb86a50, 28, 70);
        await initRunnerList();
        if (!selectedRunnerFile && runnerFiles.length) selectedRunnerFile = runnerFiles[0];
        await loadRunner(selectedRunnerFile);
        bindControls();
        requestAnimationFrame(loop);
    }

    function showGameLoading() {
        gameLoading?.classList.remove('is-hidden');
        gameLoading?.setAttribute('aria-busy', 'true');
    }

    function hideGameLoading() {
        gameLoading?.classList.add('is-hidden');
        gameLoading?.setAttribute('aria-busy', 'false');
    }

    function revealGame() {
        canvas?.classList.remove('is-hidden');
        gameUi?.classList.remove('is-hidden');
    }

    function lockUntilPick() {
        hideGameLoading();
        canvas?.classList.add('is-hidden');
        gameUi?.classList.add('is-hidden');
    }

    async function bootstrap() {
        lockUntilPick();
        await new Promise((resolve) => {
            if (window.RunnerRoad?.selectedRunnerFile) {
                selectedRunnerFile = window.RunnerRoad.selectedRunnerFile;
                resolve();
                return;
            }
            window.addEventListener('runner-selected', (e) => {
                selectedRunnerFile = e.detail.file;
                resolve();
            }, { once: true });
        });
        showGameLoading();
        try {
            await init();
            revealGame();
        } catch (e) {
            console.error('Runner init failed', e);
            const text = gameLoading?.querySelector('.game-loading__text');
            if (text) text.textContent = 'Ошибка загрузки';
        } finally {
            hideGameLoading();
        }
    }

    bootstrap();
})();
