/**
 * Runner Road — персонажи из assets/models/person/
 */
(function () {
    const MODELS_ROOT = 'assets/models/';
    const PERSON_DIR = 'person/';
    const TEXTURES_BASE = 'assets/textures/';
    const RUNNER_X = -1.8;
    const RUNNER_ROT_Y = Math.PI / 2;
    const GROUND_Y = -0.82;
    const ROAD_Y = GROUND_Y + 0.14;
    const ROAD_THICKNESS = 0.14;
    const ROAD_SURFACE_Y = ROAD_Y + ROAD_THICKNESS;
    const TILE_WIDTH = 28;
    const ROAD_DEPTH = 2.4;
    const GROUND_DEPTH = 44;
    const BASE_SPEED = 5.2;
    const RUN_SPEED = 8.5;
    const GRAVITY = -18;
    const JUMP_VY = 5.8;
    const STATE_SUFFIX_RX = /_(run|jump)$/i;

    let renderer, scene, camera;
    let runner = null;
    let runnerMixer = null;
    let runnerAnimations = [];
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
    let roadMat = null;
    let groundMat = null;
    let roadUv = 0;
    let groundUv = 0;
    let lastT = 0;
    let runHeld = false;
    let isJumping = false;
    let jumpY = 0;
    let jumpVy = 0;
    let jumpStateTimer = 0;

    const canvas = document.getElementById('game-canvas');
    const gameUi = document.getElementById('game-ui');
    const gameLoading = document.getElementById('game-loading');
    const btnRun = document.getElementById('btnRun');
    const btnJump = document.getElementById('btnJump');
    const btnNextRunner = document.getElementById('btnNextRunner');

    function assetUrl(path) {
        return new URL(path, document.baseURI).href;
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

    function createMat(color, rough = 0.9) {
        const THREE = window.THREE;
        return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, side: THREE.DoubleSide });
    }

    function setupRepeatingTexture(tex, repeatX, repeatY) {
        const THREE = window.THREE;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.center.set(0.5, 0.5);
        tex.rotation = Math.PI / 2;
        if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    async function loadWorldMaterials() {
        const THREE = window.THREE;
        roadMat = createMat(0x3a3a3a, 0.88);
        groundMat = createMat(0x5c7a42, 0.92);
        try {
            const roadTex = await new THREE.TextureLoader().loadAsync(assetUrl(TEXTURES_BASE + 'road.png'));
            roadMat = new THREE.MeshStandardMaterial({ map: setupRepeatingTexture(roadTex, 1, 1), roughness: 0.88, metalness: 0 });
        } catch (e) {
            console.warn('runner-road: road texture fallback', e);
        }
        try {
            const groundTex = await new THREE.TextureLoader().loadAsync(assetUrl(TEXTURES_BASE + 'ground.png'));
            groundMat = new THREE.MeshStandardMaterial({ map: setupRepeatingTexture(groundTex, 1, 1), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
        } catch (e) {
            console.warn('runner-road: ground texture fallback', e);
        }
    }

    function makeGroundTile(x) {
        const THREE = window.THREE;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TILE_WIDTH, GROUND_DEPTH), groundMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, GROUND_Y, 0);
        scene.add(mesh);
        return { mesh, width: TILE_WIDTH };
    }

    function makeRoadTile(x) {
        const THREE = window.THREE;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(TILE_WIDTH, ROAD_THICKNESS, ROAD_DEPTH), roadMat);
        mesh.position.set(x, ROAD_Y + ROAD_THICKNESS * 0.5, 0);
        scene.add(mesh);
        return { mesh, width: TILE_WIDTH };
    }

    function initWorld() {
        const THREE = window.THREE;
        scene.background = new THREE.Color(0x243b63);
        scene.fog = new THREE.Fog(0x516a8f, 18, 70);
        scene.add(new THREE.HemisphereLight(0xd7e8ff, 0x6d4c35, 0.52));
        scene.add(new THREE.AmbientLight(0xffffff, 0.42));
        const sun = new THREE.DirectionalLight(0xffffff, 0.85);
        sun.position.set(5, 12, 8);
        scene.add(sun);

        for (let i = 0; i < 3; i++) {
            const x = RUNNER_X + (i - 1) * TILE_WIDTH;
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
            const action = runnerMixer.clipAction(clip);
            action.reset().play();
        });
    }

    async function loadRunnerModel(file) {
        if (!file) return;
        const H = window.GltfHelpers;
        const data = await getModelData(file);
        disposeRunner();
        activeModelFile = file;
        runner = data.scene.clone(true);
        runnerAnimations = data.animations;
        H.prepareModelAsAuthored(runner, { groundY: ROAD_SURFACE_Y + jumpY });
        runner.position.x = RUNNER_X;
        runner.position.z = 0;
        runner.rotation.y = RUNNER_ROT_Y;
        scene.add(runner);
        playRunnerAnimations();
        updateRunnerPose(performance.now());
    }

    async function applyCharacterState(state) {
        characterState = state;
        const nextFile = characterVariants[state] || characterVariants.idle;
        if (!nextFile || nextFile === activeModelFile) return;
        await loadRunnerModel(nextFile);
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
            if (characterState === 'jump') {
                const next = runHeld ? 'run' : 'idle';
                applyCharacterState(next).catch((e) => console.warn(e));
            }
        }
    }

    function updateRunnerPose(t) {
        if (!runner) return;
        runner.position.x = RUNNER_X;
        runner.position.y = ROAD_SURFACE_Y + jumpY;
        runner.position.z = 0;
        runner.rotation.y = RUNNER_ROT_Y;
        if (!isJumping && jumpY < 0.01 && characterState !== 'jump') {
            const bob = runHeld ? t * 0.02 : t * 0.012;
            runner.position.y += Math.abs(Math.sin(bob)) * (runHeld ? 0.04 : 0.02);
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

    function loop(t) {
        if (!lastT) lastT = t;
        const dt = Math.min(0.05, (t - lastT) / 1000);
        lastT = t;
        if (runnerMixer) runnerMixer.update(dt);

        const speed = runHeld ? RUN_SPEED : BASE_SPEED;
        const move = speed * dt;
        scrollTiles(groundTiles, move);
        scrollTiles(roadTiles, move);
        if (groundMat?.map) {
            groundUv -= move / TILE_WIDTH * 1.12;
            groundMat.map.offset.y = groundUv % 1;
        }
        if (roadMat?.map) {
            roadUv -= move / TILE_WIDTH * 1.12;
            roadMat.map.offset.y = roadUv % 1;
        }

        syncRunState();
        updateJump(dt);
        updateRunnerPose(t);
        camera.lookAt(RUNNER_X, ROAD_SURFACE_Y + jumpY + 0.7, 0);
        renderer.render(scene, camera);
        requestAnimationFrame(loop);
    }

    function bindControls() {
        const setRun = (on) => {
            runHeld = on;
            btnRun?.classList.toggle('is-active', on);
            syncRunState();
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
    }

    async function init() {
        const ready = await (window.GltfHelpers?.waitForThree?.() ?? Promise.resolve(false));
        if (!ready) return;

        const THREE = window.THREE;
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 90);
        camera.position.set(5.3, 2.3, 7.9);

        const onResize = () => {
            renderer.setSize(innerWidth, innerHeight, false);
            camera.aspect = innerWidth / innerHeight;
            camera.updateProjectionMatrix();
        };
        onResize();
        window.addEventListener('resize', onResize);

        await loadWorldMaterials();
        initWorld();
        await initRunnerList();
        if (!selectedRunnerFile && runnerFiles.length) selectedRunnerFile = runnerFiles[0];
        await loadRunner(selectedRunnerFile);
        bindControls();

        if (canvas) canvas.classList.remove('is-hidden');
        if (gameUi) gameUi.classList.remove('is-hidden');
        if (gameLoading) gameLoading.classList.add('is-hidden');
        requestAnimationFrame(loop);
    }

    function lockUntilPick() {
        if (canvas) canvas.classList.add('is-hidden');
        if (gameUi) gameUi.classList.add('is-hidden');
    }

    function waitForPick() {
        if (window.RunnerRoad?.selectedRunnerFile) {
            selectedRunnerFile = window.RunnerRoad.selectedRunnerFile;
            return Promise.resolve(selectedRunnerFile);
        }
        return new Promise((resolve) => {
            window.addEventListener('runner-selected', (e) => {
                selectedRunnerFile = e.detail.file;
                resolve(selectedRunnerFile);
            }, { once: true });
        });
    }

    async function bootstrap() {
        lockUntilPick();
        await waitForPick();
        await init();
    }

    bootstrap();
})();
