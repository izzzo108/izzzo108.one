/**
 * Shared Three.js bootstrap for all games.
 * Usage: <script src="../../shared/js/three-boot.js" data-vendor="../../vendor/"></script>
 */
(function () {
    const script = document.currentScript;
    const vendorRel = script?.getAttribute('data-vendor') || '../../vendor/';
    const vendorBase = new URL(vendorRel, document.baseURI).href;

    const el = document.createElement('script');
    el.type = 'importmap';
    el.textContent = JSON.stringify({
        imports: {
            three: vendorBase + 'three.module.min.js',
            'three/addons/': vendorBase + 'addons/'
        }
    });
    document.head.appendChild(el);

    const boot = document.createElement('script');
    boot.type = 'module';
    boot.textContent = `
        try {
            const THREE = await import('three');
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            window.THREE = THREE;
            window.GLTFLoader = GLTFLoader;
            document.dispatchEvent(new Event('three-ready'));
        } catch (err) {
            console.error('Three.js bootstrap failed:', err);
        }
    `;
    document.head.appendChild(boot);
})();
