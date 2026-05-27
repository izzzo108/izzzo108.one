/**
 * Runner picker — tap a character to start.
 */
(function () {
    const MODELS_ROOT = 'assets/models/';
    const PERSON_DIR = 'person/';
    const PREVIEW_ROT_Y = Math.PI / 2;
    const STATE_SUFFIX_RX = /_(run|jump)$/i;

    const screen = document.getElementById('runner-select');
    const grid = document.getElementById('runnerGrid');
    const gameLoading = document.getElementById('game-loading');
    if (!screen || !grid) return;

    let selectedFile = null;
    let gameStarted = false;
    let previews = [];

    function assetUrl(path) {
        return new URL(path, document.baseURI).href;
    }

    function isBasePersonFile(file) {
        if (!/\.glb$/i.test(file) || !file.startsWith(PERSON_DIR)) return false;
        const name = (file.split('/').pop() || '').replace(/\.glb$/i, '');
        return !STATE_SUFFIX_RX.test(name);
    }

    function displayName(file) {
        const base = (file.split('/').pop() || file).replace(/\.glb$/i, '');
        return base.replace(/_/g, ' ') || base;
    }

    async function loadFiles() {
        try {
            const r = await fetch(assetUrl(MODELS_ROOT + 'models-manifest.json'), { cache: 'no-store' });
            if (!r.ok) return [];
            const data = await r.json();
            return (data.models || [])
                .filter(isBasePersonFile)
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        } catch (e) {
            console.warn('runner models manifest failed', e);
            return [];
        }
    }

    function disposePreview(p) {
        if (p.rafId) cancelAnimationFrame(p.rafId);
        p.mixer?.stopAllAction();
        p.renderer?.dispose();
        p.model?.traverse((m) => {
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
                const mats = Array.isArray(m.material) ? m.material : [m.material];
                mats.forEach((it) => it.dispose());
            }
        });
    }

    async function buildPreview(file, canvas) {
        const H = window.GltfHelpers;
        const THREE = window.THREE;
        if (!H?.loadGlb || !THREE) return null;

        const gltf = await H.loadGlb(assetUrl(MODELS_ROOT + file));
        const model = gltf.scene.clone();
        H.prepareModelAsAuthored?.(model, { groundY: 0 });
        model.rotation.y = PREVIEW_ROT_Y;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1f2937);
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const key = new THREE.DirectionalLight(0xfff5e0, 0.95);
        key.position.set(2, 4, 3);
        scene.add(key);
        scene.add(model);

        const mixer = gltf.animations?.length ? new THREE.AnimationMixer(model) : null;
        if (mixer) gltf.animations.forEach((clip) => mixer.clipAction(clip).play());

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        renderer.setSize(canvas.clientWidth || 140, canvas.clientHeight || 140, false);

        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
        camera.position.set(1.8, 1.2, 2.9);
        camera.lookAt(0, 0.8, 0);

        const state = { renderer, scene, camera, model, mixer, rafId: 0 };
        const tick = () => {
            if (gameStarted) return;
            if (mixer) mixer.update(1 / 60);
            renderer.render(scene, camera);
            state.rafId = requestAnimationFrame(tick);
        };
        tick();
        return state;
    }

    function startGame() {
        if (!selectedFile || gameStarted) return;
        gameStarted = true;
        previews.forEach(disposePreview);
        previews = [];
        screen.classList.add('is-hidden');
        if (gameLoading) gameLoading.classList.remove('is-hidden');
        window.RunnerRoad = window.RunnerRoad || {};
        window.RunnerRoad.selectedRunnerFile = selectedFile;
        window.dispatchEvent(new CustomEvent('runner-selected', { detail: { file: selectedFile } }));
    }

    async function init() {
        grid.innerHTML = '<p class="runner-select__loading">Загрузка персонажей…</p>';
        const files = await loadFiles();
        if (!files.length) {
            grid.innerHTML = '<p class="runner-select__error">Положи .glb в assets/models/person/ (например Enot.glb)</p>';
            return;
        }

        grid.innerHTML = '';
        const cards = files.map((file) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'runner-card';
            const canvas = document.createElement('canvas');
            canvas.className = 'runner-card__preview';
            canvas.width = 140;
            canvas.height = 140;
            const name = document.createElement('span');
            name.className = 'runner-card__name';
            name.textContent = displayName(file);
            card.append(canvas, name);
            card.addEventListener('click', () => {
                selectedFile = file;
                grid.querySelectorAll('.runner-card').forEach((el) => el.classList.remove('is-selected'));
                card.classList.add('is-selected');
                startGame();
            });
            grid.appendChild(card);
            return { file, canvas };
        });

        const ready = await (window.GltfHelpers?.waitForThree?.() ?? Promise.resolve(false));
        if (!ready) return;

        await Promise.all(cards.map(async (item) => {
            try {
                const p = await buildPreview(item.file, item.canvas);
                if (p) previews.push(p);
            } catch (e) {
                console.warn('runner preview failed', item.file, e);
            }
        }));
    }

    init();
})();
