/**
 * Ramp hit — по силуэту модели Tramp.glb (высота поверхности вдоль X)
 */
(function (global) {
    const PROFILE_BUCKETS = 128;
    const SURFACE_LIFT = 0.04;
    const CONTACT_TOL = 0.48;
    const APPROACH_TOL = 0.22;

    function computeRampProfile(rampMesh) {
        const THREE = global.THREE;
        if (!THREE) return null;

        const rampX = rampMesh.position.x;
        const rampY = rampMesh.position.y;
        const samples = [];
        const v = new THREE.Vector3();

        rampMesh.updateMatrixWorld(true);
        rampMesh.traverse((child) => {
            if (!child.isMesh || !child.geometry?.attributes?.position) return;
            const pos = child.geometry.attributes.position;
            const mw = child.matrixWorld;
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(mw);
                samples.push({ x: v.x - rampX, y: v.y - rampY });
            }
        });

        if (!samples.length) return null;

        let minX = Infinity;
        let maxX = -Infinity;
        for (const s of samples) {
            minX = Math.min(minX, s.x);
            maxX = Math.max(maxX, s.x);
        }
        const span = Math.max(maxX - minX, 0.001);
        const buckets = Array.from({ length: PROFILE_BUCKETS }, () => ({ minY: Infinity, maxY: -Infinity, n: 0 }));

        for (const s of samples) {
            const t = (s.x - minX) / span;
            const idx = Math.min(PROFILE_BUCKETS - 1, Math.max(0, Math.floor(t * PROFILE_BUCKETS)));
            const b = buckets[idx];
            b.minY = Math.min(b.minY, s.y);
            b.maxY = Math.max(b.maxY, s.y);
            b.n++;
        }

        const heights = buckets.map((b) => (b.n ? b.maxY : null));

        for (let i = 0; i < heights.length; i++) {
            if (heights[i] !== null) continue;
            let lo = i - 1;
            let hi = i + 1;
            while (lo >= 0 && heights[lo] === null) lo--;
            while (hi < heights.length && heights[hi] === null) hi++;
            if (lo >= 0 && hi < heights.length) {
                const t = (i - lo) / (hi - lo);
                heights[i] = heights[lo] + (heights[hi] - heights[lo]) * t;
            } else if (lo >= 0) heights[i] = heights[lo];
            else if (hi < heights.length) heights[i] = heights[hi];
            else heights[i] = 0;
        }

        const smooth = heights.slice();
        for (let pass = 0; pass < 3; pass++) {
            for (let i = 1; i < smooth.length - 1; i++) {
                smooth[i] = smooth[i] * 0.55 + (smooth[i - 1] + smooth[i + 1]) * 0.225;
            }
        }

        return { minX, maxX, span, heights: smooth, lipY: Math.max(...smooth) };
    }

    function sampleProfile(profile, localX) {
        if (!profile || localX < profile.minX || localX > profile.maxX) return null;
        const t = (localX - profile.minX) / profile.span;
        const f = t * (PROFILE_BUCKETS - 1);
        const i0 = Math.floor(f);
        const i1 = Math.min(PROFILE_BUCKETS - 1, i0 + 1);
        const blend = f - i0;
        return profile.heights[i0] + (profile.heights[i1] - profile.heights[i0]) * blend;
    }

    function getRampSurfaceWorldY(rampEntry, worldX) {
        const localX = worldX - rampEntry.mesh.position.x;
        const localY = sampleProfile(rampEntry.profile, localX);
        if (localY === null) return null;
        return rampEntry.mesh.position.y + localY + SURFACE_LIFT;
    }

    function getCarBottomY(car) {
        const THREE = global.THREE;
        if (!car || !THREE) return 0;
        car.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(car);
        return box.min.y;
    }

    /** Точки вдоль длины машины (мировой X) */
    function getCarSampleXs(car) {
        car.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(car);
        const len = Math.max(box.max.x - box.min.x, 0.4);
        const inset = Math.min(len * 0.1, 0.15);
        return [
            box.min.x + inset,
            box.min.x + len * 0.28,
            (box.min.x + box.max.x) * 0.5,
            box.max.x - len * 0.28,
            box.max.x - inset
        ];
    }

    function isNearSurface(carBottomY, surfaceY) {
        return carBottomY >= surfaceY - CONTACT_TOL
            && carBottomY <= surfaceY + CONTACT_TOL + 0.7;
    }

    function isApproachingSurface(carBottomY, surfaceY) {
        return carBottomY < surfaceY + APPROACH_TOL && carBottomY > surfaceY - CONTACT_TOL;
    }

    /**
     * @returns {{ hit: boolean, surfaceY: number|null, onLip: boolean }}
     */
    function checkRampContact(rampEntry, car, carBottomY) {
        if (!rampEntry?.profile) {
            return { hit: false, surfaceY: null, onLip: false };
        }

        const xs = car ? getCarSampleXs(car) : [];
        let bestSurface = null;
        let hit = false;
        let onLip = false;
        const lipX = rampEntry.profile.maxX - rampEntry.profile.span * 0.2;

        for (const x of xs) {
            const surfaceY = getRampSurfaceWorldY(rampEntry, x);
            if (surfaceY === null) continue;

            const localX = x - rampEntry.mesh.position.x;
            const onSurface = isNearSurface(carBottomY, surfaceY);
            const approaching = isApproachingSurface(carBottomY, surfaceY);

            if (onSurface || approaching) {
                hit = true;
                bestSurface = bestSurface === null ? surfaceY : Math.max(bestSurface, surfaceY);
            }
            if ((onSurface || approaching) && localX >= lipX) {
                onLip = true;
            }
        }

        return { hit, surfaceY: bestSurface, onLip };
    }

    global.RampCollision = {
        computeRampProfile,
        sampleProfile,
        getRampSurfaceWorldY,
        getCarBottomY,
        getCarSampleXs,
        checkRampContact
    };
})(window);
