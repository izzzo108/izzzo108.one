/**
 * Runner picker — tap a character to start (same flow as car-select).
 */
(function () {
    const MODELS_ROOT = 'assets/models/';
    const PERSON_DIR = 'person/';
    const STATE_SUFFIX_RX = /_(run|jump)$/i;

    const screen = document.getElementById('runner-select');
    const grid = document.getElementById('runnerGrid');
    const gameUi = document.getElementById('game-ui');
    const gameCanvas = document.getElementById('game-canvas');
    const gameLoading = document.getElementById('game-loading');

    if (!screen || !grid) {
        console.error('runner-select: missing DOM elements');
        return;
    }

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
        return (file.split('/').pop() || file)
            .replace(/\.glb$/i, '')
            .replace(/_/g, ' ');
    }

    async function loadRunnerFiles() {
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
        if (p.mixer) p.mixer.stopAllAction();
        if (p.renderer) p.renderer.dispose();
        if (p.model) {
            p.model.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m) => m.dispose());
                }
            });
        }
    }

    function startGame() {
        if (!selectedFile || gameStarted) return;
        gameStarted = true;

        window.RunnerRoad = window.RunnerRoad || {};
        window.RunnerRoad.selectedRunnerFile = selectedFile;

        previews.forEach(disposePreview);
        previews = [];

        screen.classList.add('is-hidden');
        screen.setAttribute('aria-hidden', 'true');
        if (gameLoading) {
            gameLoading.classList.remove('is-hidden');
            gameLoading.setAttribute('aria-busy', 'true');
        }

        window.dispatchEvent(new CustomEvent('runner-selected', { detail: { file: selectedFile } }));
    }

    function selectAndStart(file, cardEl) {
        if (gameStarted) return;
        selectedFile = file;
        grid.querySelectorAll('.runner-card').forEach((c) => c.classList.remove('is-selected'));
        if (cardEl) cardEl.classList.add('is-selected');
        startGame();
    }

    function createCard(file) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'runner-card';
        card.setAttribute('aria-label', 'Выбрать ' + displayName(file) + ' и начать');

        const canvas = document.createElement('canvas');
        canvas.className = 'runner-card__preview';
        canvas.width = 140;
        canvas.height = 140;

        const name = document.createElement('span');
        name.className = 'runner-card__name';
        name.textContent = displayName(file) || file;

        card.append(canvas, name);
        card.addEventListener('click', () => selectAndStart(file, card));

        return { card, canvas, file };
    }

    async function buildPreview(file, canvas) {
        const H = window.GltfHelpers;
        const THREE = window.THREE;
        if (!H?.loadGlb || !THREE) return null;

        const gltf = await H.loadGlb(assetUrl(MODELS_ROOT + file));
        const model = gltf.scene.clone();
        const clips = gltf.animations || [];
        H.prepareModelAsAuthored?.(model, { groundY: 0 });

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x5a8ab5);
        scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const key = new THREE.DirectionalLight(0xfff5e0, 0.9);
        key.position.set(2, 4, 3);
        scene.add(key);
        scene.add(model);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
        const size = canvas.clientWidth || 140;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        renderer.setSize(size, size, false);

        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
        camera.position.set(2.2, 1.1, 2.8);
        camera.lookAt(0, 0.1, 0);

        const mixer = clips.length ? new THREE.AnimationMixer(model) : null;
        if (mixer) {
            clips.forEach((clip) => {
                mixer.clipAction(clip).play();
            });
        }

        const state = { renderer, scene, camera, model, mixer, rafId: 0 };

        function tick() {
            if (gameStarted) return;
            if (mixer) mixer.update(1 / 60);
            model.rotation.y += 0.012;
            renderer.render(scene, camera);
            state.rafId = requestAnimationFrame(tick);
        }

        renderer.render(scene, camera);
        tick();

        return state;
    }

    async function initPicker() {
        grid.innerHTML = '<p class="runner-select__loading">Загрузка персонажей…</p>';

        const files = await loadRunnerFiles();
        grid.innerHTML = '';

        if (!files.length) {
            grid.innerHTML = '<p class="runner-select__error">Положи .glb в assets/models/person/ (например Enot.glb)</p>';
            return;
        }

        const cards = [];
        for (const file of files) {
            const item = createCard(file);
            grid.appendChild(item.card);
            cards.push(item);
        }

        const H = window.GltfHelpers;
        const ready = H ? await H.waitForThree() : false;
        if (!ready) {
            grid.insertAdjacentHTML('beforeend',
                '<p class="runner-select__hint">Превью 3D недоступно — нажмите на персонажа для старта</p>');
            return;
        }

        await Promise.all(cards.map(async (item) => {
            try {
                const preview = await buildPreview(item.file, item.canvas);
                if (preview) previews.push(preview);
            } catch (e) {
                console.warn('Preview failed:', item.file, e);
            }
        }));
    }

    if (gameUi) gameUi.classList.add('is-hidden');
    if (gameCanvas) gameCanvas.classList.add('is-hidden');

    screen.classList.remove('is-hidden');
    screen.setAttribute('aria-hidden', 'false');

    initPicker();
})();
