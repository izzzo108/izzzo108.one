/**
 * Shared GLB helpers (uses window.THREE + window.GLTFLoader after three-boot).
 */
(function (global) {
    function waitForThree(timeoutMs = 15000) {
        if (global.THREE && global.GLTFLoader) return Promise.resolve(true);
        return new Promise((resolve) => {
            const finish = () => resolve(Boolean(global.THREE && global.GLTFLoader));
            const timer = setTimeout(finish, timeoutMs);
            global.document.addEventListener('three-ready', () => {
                clearTimeout(timer);
                finish();
            }, { once: true });
        });
    }

    async function loadGlb(url) {
        const THREE = global.THREE;
        const GLTFLoader = global.GLTFLoader;
        if (!THREE || !GLTFLoader) throw new Error('Three.js not ready');
        const response = await fetch(url);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const buffer = await response.arrayBuffer();
        const loader = new GLTFLoader();
        return loader.parseAsync(buffer, url);
    }

    function normalizeScale(root, targetSize) {
        const THREE = global.THREE;
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        root.scale.setScalar(targetSize / maxDim);
    }

    function centerObject(root) {
        const THREE = global.THREE;
        const box = new THREE.Box3().setFromObject(root);
        const center = new THREE.Vector3();
        box.getCenter(center);
        root.position.sub(center);
    }

    function tintMeshes(root, hexColor, options = {}) {
        const THREE = global.THREE;
        const base = new THREE.Color(hexColor);
        const metal = options.metalness ?? 0.15;
        const rough = options.roughness ?? 0.45;
        root.traverse((child) => {
            if (!child.isMesh) return;
            const old = child.material;
            if (old) {
                const mats = Array.isArray(old) ? old : [old];
                mats.forEach((m) => m.dispose());
            }
            const tint = base.clone();
            if (options.hueJitter) tint.offsetHSL(0, 0, (Math.random() - 0.5) * options.hueJitter);
            child.material = new THREE.MeshStandardMaterial({
                color: tint,
                metalness: metal,
                roughness: rough,
                side: THREE.DoubleSide
            });
        });
    }

    function filterCarModels(files) {
        return files
            .filter((f) => /\.glb$/i.test(f))
            .filter((f) => /^Car/i.test(f.split('/').pop() || f))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function carDisplayName(file) {
        const base = file.split('/').pop().replace(/\.glb$/i, '');
        return base.replace(/^Car_?/i, '').replace(/_/g, ' ') || base;
    }

    function fixMaterialsForDisplay(root) {
        const THREE = global.THREE;
        root.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
                if (m.map && THREE.SRGBColorSpace) m.map.colorSpace = THREE.SRGBColorSpace;
                if (m.emissiveMap && THREE.SRGBColorSpace) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                m.needsUpdate = true;
            });
        });
    }

    function placeModelOnGround(root, groundY = 0) {
        const THREE = global.THREE;
        const box = new THREE.Box3().setFromObject(root);
        root.position.y += groundY - box.min.y;
    }

    /** GLB 1:1 — без масштаба и перекраски, текстуры из файла */
    function prepareModelAsAuthored(scene, options = {}) {
        if (options.center) centerObject(scene);
        fixMaterialsForDisplay(scene);
        if (options.groundY !== undefined) placeModelOnGround(scene, options.groundY);
        return scene;
    }

    function prepareCarScene(scene, options = {}) {
        if (options.keepTextures === false) {
            const size = options.size ?? 1.2;
            const color = options.color ?? '#fbbf24';
            normalizeScale(scene, size);
            centerObject(scene);
            tintMeshes(scene, color, { hueJitter: options.hueJitter ?? 0.02 });
            return scene;
        }
        return prepareModelAsAuthored(scene, {
            center: false,
            groundY: options.groundY
        });
    }

    function prepareRampScene(scene, options = {}) {
        prepareModelAsAuthored(scene, { center: false, groundY: options.groundY });
        if (options.flipY) scene.rotation.y += Math.PI;
        return scene;
    }

    const fixMaterialsForGLTF = fixMaterialsForDisplay;

    function pickModelFile(files, role) {
        const list = files.filter((f) => /\.glb$/i.test(f));
        if (role === 'car') {
            const cars = filterCarModels(files);
            if (cars.length) return cars[0];
            const hit = list.find((f) => /car|mashin|auto|vehicle/i.test(f));
            return hit || list[0] || null;
        }
        if (role === 'ramp') {
            const tramp = list.find((f) => /^Tramp/i.test(f.split('/').pop() || f));
            if (tramp) return tramp;
            return list.find((f) => /ramp|tramp|jump|springboard/i.test(f)) || null;
        }
        return list[0] || null;
    }

    async function loadModelsManifest(baseUrl) {
        try {
            const r = await fetch(baseUrl + 'models-manifest.json', { cache: 'no-store' });
            if (r.ok) {
                const data = await r.json();
                return data.models || [];
            }
        } catch (e) {
            console.warn('models-manifest missing', e);
        }
        return [];
    }

    global.GltfHelpers = {
        waitForThree,
        loadGlb,
        normalizeScale,
        centerObject,
        tintMeshes,
        fixMaterialsForDisplay,
        fixMaterialsForGLTF,
        placeModelOnGround,
        prepareModelAsAuthored,
        filterCarModels,
        listCarModels: filterCarModels,
        carDisplayName,
        prepareCarScene,
        prepareRampScene,
        pickModelFile,
        loadModelsManifest
    };
})(window);
