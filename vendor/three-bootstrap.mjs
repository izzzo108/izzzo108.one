import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

window.THREE = THREE;
window.GLTFLoader = GLTFLoader;
document.dispatchEvent(new Event('three-ready'));
