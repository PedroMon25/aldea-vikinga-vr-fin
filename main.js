import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** ========= CONFIGURACIÓN DEL VALLE VIKINGO (260x260m) ========= */
const WORLD_SIZE = 260;
const MAP_LIMIT = 118;
const PLAYER_EYE_HEIGHT = 1.65;
const PLAYER_RADIUS = 0.65;
const MELEE_RANGE = 2.8;
const VR_WALK_SPEED = 6.8;
const VR_RUN_SPEED = 12.2;
const VR_TURN_SPEED = 1.85;
const ARC_STEPS = 42;
const ARC_SPEED = 10.5;
const ARC_GRAVITY = 9.8;

/** ========= DOM & UI ========= */
const canvas = document.getElementById('scene');
const coverOverlay = document.getElementById('cover-overlay');
const wakeupCurtain = document.getElementById('wakeup-curtain');
const damageFlashEl = document.getElementById('damage-flash');
const btnStart = document.getElementById('btn-start');
const btnInfo = document.getElementById('btn-info');
const zoneNameEl = document.getElementById('zoneName');
const scoreCountEl = document.getElementById('scoreCount');
const destroyedCountEl = document.getElementById('destroyedCount');
const totalTargetsEl = document.getElementById('totalTargets');
const bossHudEl = document.getElementById('boss-hud');
const bossTitleTextEl = document.getElementById('bossTitleText');
const bossBarFillEl = document.getElementById('boss-bar-fill');
const heartsContainerEl = document.getElementById('heartsContainer');
const staminaBarFillEl = document.getElementById('stamina-bar-fill');
const ambientAudioEl = document.getElementById('ambient-audio');

function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader && loader.style.display !== 'none') {
        loader.style.opacity = '0';
        setTimeout(() => { loader.style.display = 'none'; }, 400);
    }
}
setTimeout(hideLoader, 3000);

/** ========= RENDERER / ESCENA / RIG VR ========= */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const skyColor = new THREE.Color(0x7cc4fa);
scene.background = skyColor;
scene.fog = new THREE.FogExp2(0x7cc4fa, 0.0055);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 480);
camera.rotation.order = 'YXZ'; // Orden natural para girar cámara con mouse (Yaw -> Pitch)

const playerRig = new THREE.Group();
playerRig.position.set(0, PLAYER_EYE_HEIGHT, 12);
playerRig.add(camera);
scene.add(playerRig);

/** ========= CARGADOR DE TEXTURAS HD REALES ========= */
const texLoader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 8;

function loadWorldTexture(path, repeatX = 1, repeatY = 1) {
    const tex = texLoader.load(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
}

const worldTextures = {
    ground: loadWorldTexture('assets/textures/suelo_diff.jpg', 74, 74),
    bark: loadWorldTexture('assets/textures/corteza.jpg', 2, 3),
    foliage: loadWorldTexture('assets/textures/follage.jpg', 2, 2),
    rock: loadWorldTexture('assets/textures/roca.jpg', 1, 1), // Escala 1:1 para proyección triplanar limpia
    lava: loadWorldTexture('assets/textures/lava.jpg', 2, 2)
};

/** ========= ESTADO DE SALUD, ESTAMINA Y DESPERTAR ========= */
let playerHearts = 3;
const MAX_HEARTS = 3;
let playerInvulnTimer = 0;

let playerStamina = 100;
const MAX_STAMINA = 100;
let staminaExhausted = false;

let verticalVelocity = 0;
let isGrounded = true;
let isRunning = false;
let bobTimer = 0;
let currentGroundY = 0;
let playerJumpOffset = 0;

let isWakingUp = false;
let wakeUpProgress = 0;

// Ángulo vertical de cámara en PC (Pitch)
let pcCameraPitch = 0;

function updateHeartsUI() {
    const heartSpans = heartsContainerEl.querySelectorAll('.heart');
    heartSpans.forEach((span, index) => {
        if (index < playerHearts) {
            span.classList.remove('lost');
            span.classList.add('active');
        } else {
            span.classList.remove('active');
            span.classList.add('lost');
        }
    });
}

function updateStaminaUI() {
    staminaBarFillEl.style.width = `${Math.max(0, playerStamina)}%`;
    if (staminaExhausted) {
        staminaBarFillEl.classList.add('exhausted');
    } else {
        staminaBarFillEl.classList.remove('exhausted');
    }
}

function triggerDamageFlash() {
    damageFlashEl.style.opacity = '1';
    setTimeout(() => { damageFlashEl.style.opacity = '0'; }, 280);
}

/** ========= AUDIO ========= */
const listener = new THREE.AudioListener();
camera.add(listener);
const audioLoader = new THREE.AudioLoader();

let breakBuffer = null;
audioLoader.load('assets/audio/romper.mp3', (buf) => { breakBuffer = buf; }, undefined, () => {});

function startExperienceAudio() {
    if (listener.context.state === 'suspended') listener.context.resume();
    if (ambientAudioEl) {
        ambientAudioEl.volume = 0.42;
        ambientAudioEl.play().catch(() => {});
    }
}

function playBreakSound() {
    if (!breakBuffer) return;
    const sfx = new THREE.Audio(listener);
    sfx.setBuffer(breakBuffer);
    sfx.setLoop(false);
    sfx.setVolume(0.95);
    sfx.play();
}

btnStart.addEventListener('click', () => {
    coverOverlay.classList.add('hidden');
    startExperienceAudio();
    if (!renderer.xr.isPresenting && canvas.requestPointerLock) {
        canvas.requestPointerLock();
    }
});
btnInfo.addEventListener('click', () => {
    if (document.pointerLockElement) document.exitPointerLock();
    coverOverlay.classList.remove('hidden');
});

/** ========= HDR + ESTRELLAS + CICLO DÍA/NOCHE ========= */
const rgbeLoader = new RGBELoader();
rgbeLoader.load(
    'assets/textures/entorno.hdr',
    (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = texture;
        scene.environmentIntensity = 0.75;
        hideLoader();
    },
    undefined,
    () => hideLoader()
);

const starCount = 3000;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    const r = 230 + Math.random() * 90;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random());
    starPositions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi) + 15;
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
scene.add(new THREE.Points(starGeo, starMat));

const sunOrb = new THREE.Mesh(new THREE.SphereGeometry(8, 24, 24), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
scene.add(sunOrb);

const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x3b3127, 1.1);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff5e4, 2.3);
sunLight.position.set(60, 95, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.bias = -0.0002;
sunLight.shadow.normalBias = 0.04;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 260;
const shadowBounds = 120;
sunLight.shadow.camera.left = -shadowBounds;
sunLight.shadow.camera.right = shadowBounds;
sunLight.shadow.camera.top = shadowBounds;
sunLight.shadow.camera.bottom = -shadowBounds;
scene.add(sunLight);

const torchLight = new THREE.PointLight(0xff6b1a, 11, 34);
torchLight.position.set(0, 2.4, 0);
scene.add(torchLight);

const forgeLight = new THREE.PointLight(0xff4500, 8, 20);
forgeLight.position.set(24, 2.0, -18);
scene.add(forgeLight);

const caveLight = new THREE.PointLight(0x38bdf8, 9, 26);
caveLight.position.set(0, 3.0, -94);
scene.add(caveLight);

const cDaySky = new THREE.Color(0x7cc4fa);
const cSunsetSky = new THREE.Color(0xe86a33);
const cNightSky = new THREE.Color(0x09111e);
const cSunDay = new THREE.Color(0xfff5e4);
const cSunSunset = new THREE.Color(0xff5e1a);
const cMoonNight = new THREE.Color(0x6488ea);

function updateDayNightCycle(elapsedTime) {
    const cycleAngle = elapsedTime * 0.055 + 0.85;
    const sunHeight = Math.sin(cycleAngle);
    const sunX = Math.cos(cycleAngle) * 170;
    const sunY = sunHeight * 150;
    const sunZ = -75;

    sunOrb.position.set(sunX, sunY, sunZ);
    sunLight.position.set(sunX * 0.6, Math.max(25, Math.abs(sunY) * 0.75), sunZ * 0.6);

    if (sunHeight > 0.25) {
        const t = Math.min((sunHeight - 0.25) / 0.75, 1);
        skyColor.lerpColors(cSunsetSky, cDaySky, t);
        sunLight.color.lerpColors(cSunSunset, cSunDay, t);
        sunLight.intensity = 1.5 + t * 0.9;
        hemiLight.intensity = 0.75 + t * 0.35;
        starMat.opacity = 0;
        sunOrb.material.color.setHex(0xfff3c4);
    } else if (sunHeight > -0.25) {
        const t = (sunHeight + 0.25) / 0.5;
        skyColor.lerpColors(cNightSky, cSunsetSky, t);
        sunLight.color.lerpColors(cMoonNight, cSunSunset, t);
        sunLight.intensity = 0.55 + t * 0.9;
        hemiLight.intensity = 0.35 + t * 0.35;
        starMat.opacity = (1 - t) * 0.85;
        sunOrb.material.color.setHex(0xff6b2b);
    } else {
        skyColor.copy(cNightSky);
        sunLight.color.copy(cMoonNight);
        sunLight.intensity = 0.5;
        hemiLight.intensity = 0.32;
        starMat.opacity = 0.95;
        sunOrb.material.color.setHex(0xcbd5e1);
    }

    scene.background.copy(skyColor);
    scene.fog.color.copy(skyColor);
}

/** ========= LISTAS GLOBALES ========= */
const staticObstacles = [];
const destructibleMeshes = [];
const targetBoards = [];
const debrisPieces = [];
const bossProjectiles = [];
const animatedAnimals = [];
const villageNPCs = [];
const npcMixers = [];
const fireParticles = [];
let riverWater = null;
let drakkarShip = null;

let totalTargets = 0;
let destroyedCount = 0;
let destroyedRocksCount = 0;
let destroyedTreesCount = 0;
let playerScore = 0;

/** ========= PRECARGA DE MODELOS 3D DE JEFES (GLB) ========= */
const gltfLoader = new GLTFLoader();
let preloadedGolemScene = null;
let preloadedTreantGltf = null;

gltfLoader.load('assets/models/stone_golem.glb', (gltf) => {
    preloadedGolemScene = gltf.scene;
}, undefined, (err) => console.warn('Aviso cargando stone_golem.glb:', err));

gltfLoader.load('assets/models/treant.glb', (gltf) => {
    preloadedTreantGltf = gltf;
}, undefined, (err) => console.warn('Aviso cargando treant.glb:', err));

/** ========= ALTURA DEL TERRENO, PUENTE, MUELLE Y BARCO CAMINABLES ========= */
function getGroundHeight(x, z) {
    // 1. Puente de madera sobre el lago
    if (Math.abs(x) <= 2.8 && z >= 41.5 && z <= 62.5) {
        if (z < 44.0) return ((z - 41.5) / 2.5) * 0.85;
        if (z > 60.0) return ((62.5 - z) / 2.5) * 0.85;
        return 0.85;
    }

    // 2. Muelle de madera (centro en X=28, Z=62; ancho 7m -> X=[24.5, 31.5], largo 14m -> Z=[55, 69])
    if (x >= 24.5 && x <= 31.5 && z >= 55.0 && z <= 69.0) {
        // Rampa suave en la entrada sur del muelle (Z entre 67 y 69)
        if (z > 67.0) return ((69.0 - z) / 2.0) * 0.65;
        return 0.65;
    }

    // 3. Cubierta del Barco Drakkar (centro en X=38, Z=53; rotado ~82°, abarca X=[30.2, 45.8], Z=[50.8, 55.2])
    if (x >= 30.2 && x <= 45.8 && z >= 50.8 && z <= 55.2) {
        // Puente de acceso desde el muelle (X entre 30.2 y 32.0)
        if (x < 32.0) return THREE.MathUtils.lerp(0.65, 1.85, (x - 30.2) / 1.8);
        return 1.85;
    }

    // 4. Lago / Río profundo
    if (z > 43 && z < 61) {
        const distFromCenter = Math.abs(z - 52);
        if (distFromCenter < 6.5) return -1.35;
        const t = (9.0 - distFromCenter) / 2.5;
        return -1.35 * THREE.MathUtils.clamp(t, 0, 1);
    }

    return 0;
}

/** ========= CONSTRUCCIÓN DE LAS 8 ZONAS CON TEXTURAS HD ESTABLES ========= */
function buildAllEightZones() {
    const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE + 60, WORLD_SIZE + 60, 140, 140);
    groundGeo.rotateX(-Math.PI / 2);
    const posAttr = groundGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
        const vz = posAttr.getZ(i);
        if (vz > 43 && vz < 61) {
            const distFromCenter = Math.abs(vz - 52);
            const depth = distFromCenter < 6.5 ? -1.45 : -1.45 * THREE.MathUtils.clamp((9.0 - distFromCenter) / 2.5, 0, 1);
            posAttr.setY(i, depth);
        }
    }
    posAttr.needsUpdate = true;
    groundGeo.computeVertexNormals();

    const ground = new THREE.Mesh(
        groundGeo,
        new THREE.MeshStandardMaterial({
            map: worldTextures.ground,
            roughness: 0.86,
            metalness: 0.04
        })
    );
    ground.receiveShadow = true;
    scene.add(ground);

    const pathTexNorth = loadWorldTexture('assets/textures/roca.jpg', 2, 32);
    const pathTexSouth = loadWorldTexture('assets/textures/roca.jpg', 2, 12);
    const pathTexEW = loadWorldTexture('assets/textures/roca.jpg', 34, 2);

    const makePathMat = (tex) => new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xc2b29b,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });

    const northRoad = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 130), makePathMat(pathTexNorth));
    northRoad.rotation.x = -Math.PI / 2;
    northRoad.position.set(0, 0.06, -23);
    northRoad.receiveShadow = true;
    scene.add(northRoad);

    const southRoad = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 45), makePathMat(pathTexSouth));
    southRoad.rotation.x = -Math.PI / 2;
    southRoad.position.set(0, 0.06, 85);
    southRoad.receiveShadow = true;
    scene.add(southRoad);

    const mainRoadEW = new THREE.Mesh(new THREE.PlaneGeometry(140, 4.2), makePathMat(pathTexEW));
    mainRoadEW.rotation.x = -Math.PI / 2;
    mainRoadEW.position.set(0, 0.06, -10);
    mainRoadEW.receiveShadow = true;
    scene.add(mainRoadEW);

    buildCentralPlaza();
    buildBlacksmithForge(24, -18);
    buildVikingTavern(-26, -18);
    buildTrainingGrounds(46, 14);
    buildRiverAndVikingPort();
    buildMountainsAndCave();

    const postGeo = new THREE.CylinderGeometry(0.26, 0.32, 3.0, 10);
    const postMat = new THREE.MeshStandardMaterial({
        map: worldTextures.bark,
        roughness: 0.85
    });
    const limit = MAP_LIMIT + 1.5;
    for (let i = -limit; i <= limit; i += 5.5) {
        [[i, -limit], [i, limit], [-limit, i], [limit, i]].forEach(([x, z]) => {
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(x, 1.5, z);
            scene.add(post);
        });
    }
}

function buildCentralPlaza() {
    const stoneMat = new THREE.MeshStandardMaterial({
        map: loadWorldTexture('assets/textures/roca.jpg', 1, 1),
        roughness: 0.85
    });
    const woodMat = new THREE.MeshStandardMaterial({
        map: worldTextures.bark,
        roughness: 0.82
    });

    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), stoneMat);
        stone.position.set(Math.cos(a) * 1.65, 0.22, Math.sin(a) * 1.65);
        stone.castShadow = true;
        scene.add(stone);
    }
    for (let i = 0; i < 5; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.2, 8), woodMat);
        log.position.set(0, 0.28, 0);
        log.rotation.z = Math.PI / 2.4;
        log.rotation.y = (i * Math.PI) / 5;
        scene.add(log);
    }
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8c1a });
    for (let i = 0; i < 20; i++) {
        const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), flameMat);
        flame.position.set(0, 0.4 + Math.random() * 1.1, 0);
        scene.add(flame);
        fireParticles.push({
            mesh: flame,
            baseX: 0,
            baseZ: 0,
            speed: 1.2 + Math.random() * 1.5,
            offset: Math.random() * Math.PI * 2
        });
    }

    const boardGroup = new THREE.Group();
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.4, 8), woodMat);
    postL.position.set(-1.3, 1.7, 0);
    const postR = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.4, 8), woodMat);
    postR.position.set(1.3, 1.7, 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.14), woodMat);
    panel.position.set(0, 2.1, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.2, 0.7), woodMat);
    roof.position.set(0, 3.3, 0);
    boardGroup.add(postL, postR, panel, roof);
    boardGroup.position.set(-6.5, 0, 5.5);
    boardGroup.rotation.y = Math.PI * 0.25;
    scene.add(boardGroup);
    staticObstacles.push({ group: boardGroup, radius: 1.5, indestructible: true });
}

function buildBlacksmithForge(x, z) {
    const forge = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ map: worldTextures.bark, roughness: 0.85 });
    const stoneMat = new THREE.MeshStandardMaterial({ map: loadWorldTexture('assets/textures/roca.jpg', 2, 2), roughness: 0.88 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.25 });

    [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]].forEach(([px, pz]) => {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 4.4, 10), woodMat);
        pillar.position.set(px, 2.2, pz);
        pillar.castShadow = true;
        forge.add(pillar);
    });

    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.5, 2.2, 4), stoneMat);
    roof.position.y = 5.3;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    forge.add(roof);

    const furnace = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.0), stoneMat);
    furnace.position.set(0, 0.9, -1.8);
    forge.add(furnace);

    const embers = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.0), new THREE.MeshBasicMaterial({ map: worldTextures.lava, color: 0xff5500 }));
    embers.position.set(0, 1.35, -1.3);
    forge.add(embers);

    const anvilBase = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.65, 10), woodMat);
    anvilBase.position.set(0, 0.325, 0.8);
    const anvilTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 0.42), ironMat);
    anvilTop.position.set(0, 0.82, 0.8);
    forge.add(anvilBase, anvilTop);

    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 0.25), woodMat);
    rack.position.set(-2.6, 0.9, 0.5);
    rack.rotation.y = Math.PI / 2;
    forge.add(rack);

    forge.position.set(x, 0, z);
    scene.add(forge);
    staticObstacles.push({ group: forge, radius: 3.4, indestructible: true });
}

function buildVikingTavern(x, z) {
    const tavern = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ map: worldTextures.bark, roughness: 0.82 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x331f11, roughness: 0.88 });
    const roofMat = new THREE.MeshStandardMaterial({ map: loadWorldTexture('assets/textures/roca.jpg', 3, 3), color: 0x64748b, roughness: 0.85 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 14.6), new THREE.MeshStandardMaterial({ map: loadWorldTexture('assets/textures/roca.jpg', 3, 3) }));
    base.position.y = 0.25;
    tavern.add(base);

    const body = new THREE.Mesh(new THREE.BoxGeometry(9.0, 3.4, 14.0), wallMat);
    body.position.y = 2.2;
    body.castShadow = true;
    body.receiveShadow = true;
    tavern.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 3.2, 4), roofMat);
    roof.position.y = 5.4;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.0, 1.0, 1.55);
    roof.castShadow = true;
    tavern.add(roof);

    const door = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.6, 0.2), trimMat);
    door.position.set(0, 1.8, 7.05);
    tavern.add(door);

    [-1.4, 1.4].forEach((lx) => {
        const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.32), new THREE.MeshBasicMaterial({ color: 0xffb703 }));
        lantern.position.set(lx, 2.7, 7.3);
        tavern.add(lantern);
    });

    tavern.position.set(x, 0, z);
    tavern.rotation.y = Math.PI * 0.25;
    scene.add(tavern);
    staticObstacles.push({ group: tavern, radius: 6.2, indestructible: true });
}

function buildTrainingGrounds(x, z) {
    const woodMat = new THREE.MeshStandardMaterial({ map: worldTextures.bark, roughness: 0.85 });
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xd4a359, roughness: 0.85 });

    for (let i = 0; i < 3; i++) {
        const dummy = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.1, 8), woodMat);
        post.position.y = 1.05;
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 1.0, 10), strawMat);
        torso.position.y = 1.35;
        const arms = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 0.16), woodMat);
        arms.position.y = 1.55;
        dummy.add(post, torso, arms);
        dummy.position.set(x - 4 + i * 4, 0, z - 6);
        scene.add(dummy);
        staticObstacles.push({ group: dummy, radius: 0.65, indestructible: true });
    }

    const targetsConfig = [
        { dx: -6, dz: 6, points: 10, color: 0x2563eb },
        { dx: 0, dz: 8, points: 25, color: 0xfacc15 },
        { dx: 6, dz: 10, points: 25, color: 0xfacc15 },
        { dx: 0, dz: 15, points: 50, color: 0xdc2626 }
    ];

    targetsConfig.forEach((cfg) => {
        const tGroup = new THREE.Group();
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2), woodMat);
        stand.position.y = 1.1;
        tGroup.add(stand);

        const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(0.9, 0.9, 0.16, 20),
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 })
        );
        disc.rotation.x = Math.PI / 2;
        disc.position.y = 1.75;
        tGroup.add(disc);

        const bullseye = new THREE.Mesh(
            new THREE.CylinderGeometry(0.52, 0.52, 0.19, 16),
            new THREE.MeshStandardMaterial({ color: cfg.color, emissive: cfg.color, emissiveIntensity: 0.5 })
        );
        bullseye.rotation.x = Math.PI / 2;
        bullseye.position.y = 1.75;
        tGroup.add(bullseye);

        tGroup.position.set(x + cfg.dx, 0, z + cfg.dz);
        scene.add(tGroup);

        disc.userData.boardData = { points: cfg.points, color: cfg.color };
        bullseye.userData.boardData = { points: cfg.points, color: cfg.color };
        targetBoards.push(disc, bullseye);
    });
}

function buildRiverAndVikingPort() {
    const waterMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x0369a1,
        emissiveIntensity: 0.32,
        bumpMap: loadWorldTexture('assets/textures/roca.jpg', 12, 3),
        bumpScale: 0.015,
        roughness: 0.08,
        metalness: 0.78,
        transparent: true,
        opacity: 0.78
    });
    riverWater = new THREE.Mesh(new THREE.PlaneGeometry(250, 18), waterMat);
    riverWater.rotation.x = -Math.PI / 2;
    riverWater.position.set(0, 0.02, 52);
    scene.add(riverWater);

    const waterfall = new THREE.Mesh(
        new THREE.BoxGeometry(4, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.78 })
    );
    waterfall.position.set(-108, 12, 52);
    scene.add(waterfall);

    const bridgeMat = new THREE.MeshStandardMaterial({ map: worldTextures.bark, roughness: 0.8 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x3e2612, roughness: 0.9 });
    const bridgeGroup = new THREE.Group();

    const mainDeck = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.26, 16.0), bridgeMat);
    mainDeck.position.set(0, 0.72, 52);
    mainDeck.castShadow = true;
    mainDeck.receiveShadow = true;
    bridgeGroup.add(mainDeck);

    const northRamp = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.26, 2.7), bridgeMat);
    northRamp.position.set(0, 0.32, 42.75);
    northRamp.rotation.x = -0.32;
    bridgeGroup.add(northRamp);

    const southRamp = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.26, 2.7), bridgeMat);
    southRamp.position.set(0, 0.32, 61.25);
    southRamp.rotation.x = 0.32;
    bridgeGroup.add(southRamp);

    [-2.5, 2.5].forEach((px) => {
        [45, 52, 59].forEach((pz) => {
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.6, 8), darkWoodMat);
            pillar.position.set(px, 0.3, pz);
            bridgeGroup.add(pillar);
        });
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.35, 17.5), bridgeMat);
        rail.position.set(px, 1.85, 52);
        bridgeGroup.add(rail);
    });

    scene.add(bridgeGroup);

    // Muelle caminable (superficie superior en Y = 0.65)
    const dockGroup = new THREE.Group();
    const dockPlatform = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.4, 14.0), bridgeMat);
    dockPlatform.position.set(28, -0.05, 62);
    dockPlatform.receiveShadow = true;
    dockGroup.add(dockPlatform);

    // Pilotes del muelle
    [[24.8, 55.5], [31.2, 55.5], [24.8, 62], [31.2, 62], [24.8, 68.5], [31.2, 68.5]].forEach(([px, pz]) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 2.6, 8), darkWoodMat);
        post.position.set(px, 0.2, pz);
        dockGroup.add(post);
    });

    // Pasarela de madera que conecta el muelle con el barco Drakkar
    const gangplank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 2.4), bridgeMat);
    gangplank.position.set(31.2, 1.25, 53.5);
    gangplank.rotation.z = 0.55;
    dockGroup.add(gangplank);
    scene.add(dockGroup);

    // Barco Drakkar caminable (cubierta en Y = 1.85, sin obstacle que bloquee subir)
    drakkarShip = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ map: worldTextures.bark, color: 0x8b5a2b, roughness: 0.78 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.7, 15.5), hullMat);
    hull.position.y = 0.85;
    hull.castShadow = true;
    hull.receiveShadow = true;
    drakkarShip.add(hull);

    // Bordes laterales bajos del barco
    [-1.95, 1.95].forEach((bx) => {
        const gunwale = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.45, 15.2), darkWoodMat);
        gunwale.position.set(bx, 1.9, 0);
        drakkarShip.add(gunwale);
    });

    const prow = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4.2, 6), hullMat);
    prow.position.set(0, 2.4, 8.2);
    prow.rotation.x = 0.35;
    drakkarShip.add(prow);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 9.5, 8), bridgeMat);
    mast.position.set(0, 5.2, 0);
    drakkarShip.add(mast);

    const sail = new THREE.Mesh(
        new THREE.BoxGeometry(6.2, 4.8, 0.12),
        new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.85 })
    );
    sail.position.set(0, 6.2, 0.2);
    drakkarShip.add(sail);

    const shieldMat = new THREE.MeshStandardMaterial({ color: 0xe5b84b, metalness: 0.65, roughness: 0.32 });
    for (let s = -4; s <= 4; s += 2) {
        [-2.1, 2.1].forEach((sx) => {
            const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 14), shieldMat);
            shield.rotation.z = Math.PI / 2;
            shield.position.set(sx, 1.5, s);
            drakkarShip.add(shield);
        });
    }

    drakkarShip.position.set(38, 0.15, 53);
    drakkarShip.rotation.y = Math.PI / 2; // Alineado con el muelle para caminar sobre su cubierta
    scene.add(drakkarShip);

    // Solo el mástil central del barco tiene colisión física para no atravesarlo
    const mastObstacle = new THREE.Object3D();
    mastObstacle.position.set(38, 0, 53);
    staticObstacles.push({ group: mastObstacle, radius: 0.45, indestructible: true });
}

/** ========= BOSQUE NÓRDICO (ÁRBOLES TALABLES + TEXTURAS HD) ========= */
function buildNordicForest() {
    const trunkMat = new THREE.MeshStandardMaterial({
        map: worldTextures.bark,
        roughness: 0.88
    });
    const leavesMat = new THREE.MeshStandardMaterial({
        map: worldTextures.foliage,
        roughness: 0.82
    });

    const totalTrees = 195;
    for (let i = 0; i < totalTrees; i++) {
        const isBorder = i >= 115;
        let tx, tz;
        if (isBorder) {
            const a = ((i - 115) / (totalTrees - 115)) * Math.PI * 2;
            const r = 112 + (i % 4) * 2.8;
            tx = Math.cos(a) * r;
            tz = Math.sin(a) * r;
        } else {
            const angle = i * 2.39996;
            const rad = 22 + Math.sqrt(i / 115) * 82;
            tx = Math.cos(angle) * rad - (i % 2 === 0 ? 12 : 0);
            tz = Math.sin(angle) * rad;

            if (Math.hypot(tx, tz) < 20) continue;
            if (Math.abs(tx) < 5.5) continue;
            if (Math.abs(tz + 10) < 5.0) continue;
            if (tz > 41 && tz < 63) continue;
            if (Math.hypot(tx - 24, tz + 18) < 9) continue;
            if (Math.hypot(tx + 26, tz + 18) < 12) continue;
            if (Math.hypot(tx - 46, tz - 14) < 14) continue;
            if (Math.hypot(tx, tz + 92) < 16) continue;
        }

        const scale = 1.05 + (i % 5) * 0.25;
        const treeGroup = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 2.9, 10), trunkMat);
        trunk.position.y = 1.45;
        trunk.castShadow = !isBorder && (i % 2 === 0);
        trunk.receiveShadow = true;
        treeGroup.add(trunk);

        const treeParts = [trunk];
        for (let lvl = 0; lvl < 3; lvl++) {
            const cone = new THREE.Mesh(new THREE.ConeGeometry(2.15 - lvl * 0.45, 2.85 - lvl * 0.3, 12), leavesMat);
            cone.position.y = 3.2 + lvl * 1.6;
            cone.castShadow = !isBorder && (i % 2 === 0);
            cone.receiveShadow = true;
            treeGroup.add(cone);
            treeParts.push(cone);
        }

        treeGroup.scale.setScalar(scale);
        treeGroup.position.set(tx, 0, tz);
        scene.add(treeGroup);

        if (isBorder) {
            staticObstacles.push({ group: treeGroup, radius: 0.7 * scale, indestructible: true });
        } else {
            const treeTarget = {
                group: treeGroup,
                radius: 0.72 * scale,
                color: 0x4d7c0f,
                points: 15,
                isRock: false,
                isTree: true,
                indestructible: false,
                destroyed: false
            };
            treeParts.forEach((part) => {
                part.userData.target = treeTarget;
                destructibleMeshes.push(part);
            });
            staticObstacles.push(treeTarget);
            totalTargets++;
        }
    }
}

/** ========= MONTAÑAS CON PROYECCIÓN UV TRIPLANAR (SIN DISTORSIÓN NI MOVIMIENTO) ========= */
function createTriplanarMountainGeometry(radius, height) {
    // Geometría no indexada para calcular proyección UV limpia por triángulo según su normal
    const baseGeo = new THREE.ConeGeometry(radius, height, 22, 8, false);
    const geo = baseGeo.toNonIndexed();
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const hRatio = (vy + height / 2) / height;

        const angle = Math.atan2(vz, vx);
        const ridge = Math.sin(angle * 5 + hRatio * 3.5) * 0.1 + Math.cos(angle * 3 - hRatio * 2.5) * 0.07;
        const factor = 1 + ridge * (1 - hRatio * 0.85);

        pos.setX(i, vx * factor);
        pos.setZ(i, vz * factor);
    }

    geo.computeVertexNormals();
    const norm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const texScale = 0.085; // Tamaño real en metros de cada repetición de roca.jpg

    for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const nx = Math.abs(norm.getX(i));
        const ny = Math.abs(norm.getY(i));
        const nz = Math.abs(norm.getZ(i));

        // Proyección triplanar: proyecta la textura en el plano dominante sin costuras ni estiramiento
        if (nx >= ny && nx >= nz) {
            uv.setXY(i, vz * texScale, vy * texScale);
        } else if (nz >= nx && nz >= ny) {
            uv.setXY(i, vx * texScale, vy * texScale);
        } else {
            uv.setXY(i, vx * texScale, vz * texScale);
        }
    }

    pos.needsUpdate = true;
    uv.needsUpdate = true;
    return geo;
}

function buildMountainsAndCave() {
    const rockMat = new THREE.MeshStandardMaterial({
        map: worldTextures.rock,
        roughness: 0.92,
        metalness: 0.04
    });
    const snowMat = new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.65,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });
    const mountainCount = 38;

    for (let i = 0; i < mountainCount; i++) {
        const angle = (i / mountainCount) * Math.PI * 2;
        const isInner = (i % 4 === 0);
        const dist = isInner ? 96 : 126 + (i % 3) * 8;
        const mx = Math.cos(angle) * dist;
        const mz = Math.sin(angle) * dist;

        if (Math.hypot(mx, mz + 94) < 18) continue;

        const height = isInner ? 26 + (i % 3) * 5 : 36 + (i % 4) * 8;
        const radius = isInner ? 14 : 19 + (i % 3) * 4;

        const mGroup = new THREE.Group();

        const baseMountain = new THREE.Mesh(createTriplanarMountainGeometry(radius, height), rockMat);
        baseMountain.position.y = height / 2;
        baseMountain.receiveShadow = true;
        mGroup.add(baseMountain);

        const snowHeight = height * 0.36;
        const snowRadius = radius * 0.41;
        const snowCap = new THREE.Mesh(createTriplanarMountainGeometry(snowRadius, snowHeight), snowMat);
        snowCap.position.y = height - snowHeight / 2 + 0.16;
        mGroup.add(snowCap);

        mGroup.position.set(mx, -0.5, mz);
        mGroup.rotation.y = i * 0.65;
        scene.add(mGroup);

        staticObstacles.push({ group: mGroup, radius: radius * 0.76, indestructible: true });
    }

    const caveGroup = new THREE.Group();
    const archLeft = new THREE.Mesh(new THREE.IcosahedronGeometry(6.5, 2), rockMat);
    archLeft.position.set(-7.5, 4.5, 0);
    const archRight = new THREE.Mesh(new THREE.IcosahedronGeometry(6.5, 2), rockMat);
    archRight.position.set(7.5, 4.5, 0);
    const archTop = new THREE.Mesh(new THREE.IcosahedronGeometry(7.5, 2), rockMat);
    archTop.scale.set(1.8, 0.8, 1.2);
    archTop.position.set(0, 9.5, 0);

    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.8 });
    [-4.2, 4.2].forEach((cx) => {
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), crystalMat);
        crystal.position.set(cx, 1.2, -2);
        caveGroup.add(crystal);
    });

    caveGroup.add(archLeft, archRight, archTop);
    caveGroup.position.set(0, 0, -92);
    scene.add(caveGroup);
}

/** ========= FAUNA: 12 CUERVOS Y 16 OVEJAS ========= */
function createWildlife() {
    const crowMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5 });
    for (let i = 0; i < 12; i++) {
        const crowGroup = new THREE.Group();
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.48, 5), crowMat);
        body.rotation.x = Math.PI / 2;
        const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.03, 0.18), crowMat);
        leftWing.position.set(-0.24, 0, 0);
        const rightWing = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.03, 0.18), crowMat);
        rightWing.position.set(0.24, 0, 0);
        crowGroup.add(body, leftWing, rightWing);
        scene.add(crowGroup);

        animatedAnimals.push({
            type: 'crow',
            group: crowGroup,
            leftWing,
            rightWing,
            angle: (i / 12) * Math.PI * 2,
            radius: 18 + i * 6.5,
            height: 12 + (i % 4) * 3.0,
            speed: 0.3 + (i % 3) * 0.08
        });
    }

    const woolColors = [0xe6e0d4, 0xf5f5f4, 0xd6d3d1, 0x44403c];
    const darkSkinMat = new THREE.MeshStandardMaterial({ color: 0x2b2623, roughness: 0.8 });
    const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.46, 6);

    const sheepLocations = [
        { x: -12, z: 16 }, { x: -15, z: 19 }, { x: -10, z: 21 },
        { x: -35, z: 12 }, { x: -48, z: 24 }, { x: -38, z: -32 },
        { x: 16, z: 18 },  { x: 21, z: 22 },  { x: 19, z: 14 },
        { x: 32, z: 32 },  { x: 58, z: -28 }, { x: 14, z: -36 },
        { x: -16, z: -42 },
        { x: -22, z: 75 }, { x: -18, z: 79 }, { x: 14, z: 76 }
    ];

    sheepLocations.forEach((loc, idx) => {
        const sheep = new THREE.Group();
        const woolMat = new THREE.MeshStandardMaterial({
            color: woolColors[idx % woolColors.length],
            roughness: 0.92
        });
        const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.58, 1), woolMat);
        body.scale.set(0.85, 0.85, 1.25);
        body.position.y = 0.7;
        body.castShadow = true;

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.44), darkSkinMat);
        head.position.set(0, 0.85, 0.7);
        sheep.add(body, head);

        [[-0.22, 0.35], [0.22, 0.35], [-0.22, -0.35], [0.22, -0.35]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(legGeo, darkSkinMat);
            leg.position.set(lx, 0.23, lz);
            sheep.add(leg);
        });

        const scale = 0.82 + (idx % 3) * 0.14;
        sheep.scale.setScalar(scale);
        sheep.position.set(loc.x, 0, loc.z);
        scene.add(sheep);

        animatedAnimals.push({
            type: 'sheep',
            group: sheep,
            head,
            originX: loc.x,
            originZ: loc.z,
            phase: idx * 1.45
        });
    });
}

/** ========= 10 NPCS VIKINGOS ANIMADOS ========= */
function loadVikingNPCs() {
    const loader = new FBXLoader();

    const npcConfigs = [
        { name: 'Ragnar', x: 3.6, z: -2.8, mode: 'talk', tint: 0xffffff },
        { name: 'Astrid', x: -4.2, z: 3.2, mode: 'patrol', tint: 0xfde68a },
        { name: 'Torvald', x: 5.8, z: 5.5, mode: 'patrol', tint: 0xd9f99d },
        { name: 'Sigurd', x: -7.2, z: -3.5, mode: 'talk', tint: 0xbae6fd },
        { name: 'Bjorn', x: 24.0, z: -16.2, mode: 'work', tint: 0xe2e8f0 },
        { name: 'Erik', x: -20.0, z: -11.0, mode: 'patrol', tint: 0xfed7aa },
        { name: 'Leif', x: 42.0, z: 12.0, mode: 'work', tint: 0xfecaca },
        { name: 'Olaf', x: 28.0, z: 62.0, mode: 'talk', tint: 0x99f6e4 },
        { name: 'Freya', x: -34.0, z: 18.0, mode: 'patrol', tint: 0xe9d5ff },
        { name: 'Hakon', x: 3.0, z: -84.0, mode: 'patrol', tint: 0xcbd5e1 }
    ];

    const setupNPCInstance = (model, cfg, idx, punchClip, walkClip) => {
        model.position.set(cfg.x, 0, cfg.z);
        model.visible = true;

        model.traverse((child) => {
            if (child.isMesh) {
                child.visible = true;
                child.frustumCulled = false;
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material = child.material.clone();
                    child.material.color.setHex(cfg.tint);
                }
            }
        });

        scene.add(model);

        const bones = {};
        model.traverse((obj) => {
            if (obj.isBone) {
                const n = obj.name.toLowerCase();
                if (n.includes('leftarm') && !n.includes('fore')) bones.leftArm = obj;
                if (n.includes('rightarm') && !n.includes('fore')) bones.rightArm = obj;
                if (n.includes('leftforearm')) bones.leftForeArm = obj;
                if (n.includes('rightforearm')) bones.rightForeArm = obj;
                if (n.includes('leftupleg')) bones.leftLeg = obj;
                if (n.includes('rightupleg')) bones.rightLeg = obj;
                if (n.includes('spine')) bones.spine = obj;
            }
        });

        const clip = (cfg.mode === 'work') ? punchClip : walkClip;
        let mixerValid = false;
        if (clip) {
            const mixer = new THREE.AnimationMixer(model);
            const action = mixer.clipAction(clip);
            action.setEffectiveTimeScale(cfg.mode === 'talk' ? 0.35 : 0.85);
            action.play();
            npcMixers.push(mixer);
            mixerValid = true;
        }

        villageNPCs.push({
            group: model,
            bones,
            mixerValid,
            mode: cfg.mode,
            dirAngle: idx * 1.15,
            speed: cfg.mode === 'patrol' ? 1.85 : 0,
            turnTimer: 2.5 + (idx % 4),
            phase: idx * 1.35
        });
    };

    loader.load('assets/models/vikingo.fbx', (baseFbx) => {
        const box = new THREE.Box3().setFromObject(baseFbx);
        const rawHeight = box.max.y - box.min.y;
        const autoScale = rawHeight > 0.01 ? (1.78 / rawHeight) : 0.0115;
        baseFbx.scale.setScalar(autoScale);

        let punchClip = baseFbx.animations?.[0] || null;
        let walkClip = baseFbx.animations?.[0] || null;

        const deployAll = () => {
            npcConfigs.forEach((cfg, idx) => {
                const instance = (idx === 0) ? baseFbx : SkeletonUtils.clone(baseFbx);
                setupNPCInstance(instance, cfg, idx, punchClip, walkClip);
            });
        };

        let doneCount = 0;
        const onClipAttempt = () => {
            doneCount++;
            if (doneCount === 2) deployAll();
        };

        loader.load('assets/models/Zombie Punching.fbx', (pFbx) => {
            if (pFbx.animations?.length) punchClip = pFbx.animations[0];
            onClipAttempt();
        }, undefined, onClipAttempt);

        loader.load('assets/models/Walking.fbx', (wFbx) => {
            if (wFbx.animations?.length) walkClip = wFbx.animations[0];
            onClipAttempt();
        }, undefined, onClipAttempt);
    });
}

/** ========= SISTEMA DE JEFES (COLOSO DE MAGMA GLB + GUARDIÁN DEL BOSQUE GLB) ========= */
let stoneGolem = null;
let forestTreant = null;

function createBossHpTexture(label, hp, maxHp, barColorHex) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(0, 0, 256, 48);
    ctx.strokeStyle = barColorHex;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 44);

    const ratio = Math.max(0, hp / maxHp);
    ctx.fillStyle = barColorHex;
    ctx.fillRect(8, 10, 240 * ratio, 28);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${label}: ${Math.max(0, hp)} / ${maxHp}`, 128, 30);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function normalizeBossGLB(rawScene, targetHeight, bossType, animations = []) {
    const container = new THREE.Group();
    const model = SkeletonUtils.clone(rawScene);

    const treantBarkMat = new THREE.MeshStandardMaterial({
        map: worldTextures.bark,
        bumpMap: worldTextures.bark,
        bumpScale: 0.08,
        color: 0x78553a,
        roughness: 0.9,
        metalness: 0.05
    });

    const treantLeafMat = new THREE.MeshStandardMaterial({
        map: worldTextures.foliage,
        color: 0x4d7c0f,
        roughness: 0.8
    });

    const golemRockMat = new THREE.MeshStandardMaterial({
        map: loadWorldTexture('assets/textures/roca.jpg', 2, 2),
        emissiveMap: worldTextures.lava,
        emissive: 0xff3300,
        emissiveIntensity: 1.1,
        roughness: 0.85
    });

    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;

            const mat = child.material;
            const hasTexture = Array.isArray(mat) ? mat.some(m => m.map) : (mat && mat.map);
            if (!hasTexture) {
                const nameLower = (child.name || '').toLowerCase();
                if (bossType === 'treant') {
                    const isLeaf = nameLower.includes('leaf') || nameLower.includes('leaves') || nameLower.includes('foliage') || nameLower.includes('crown');
                    child.material = isLeaf ? treantLeafMat : treantBarkMat;
                } else {
                    child.material = golemRockMat;
                }
            }
        }
    });

    let mixer = null;
    if (animations && animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const action = mixer.clipAction(animations[0]);
        action.play();
        mixer.update(0.01);
    }

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = size.y > 0.01 ? (targetHeight / size.y) : 1.0;
    model.scale.setScalar(scale);

    model.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);

    model.position.x = -center.x;
    model.position.z = -center.z;
    model.position.y = -scaledBox.min.y;

    container.add(model);
    return { container, model, mixer };
}

function buildFallbackGolem() {
    const g = new THREE.Group();
    const rockMat = new THREE.MeshStandardMaterial({
        map: loadWorldTexture('assets/textures/roca.jpg', 2, 2),
        emissiveMap: worldTextures.lava,
        emissive: 0xff3300,
        emissiveIntensity: 1.2,
        roughness: 0.8
    });
    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 2), rockMat);
    torso.position.y = 2.4;
    torso.castShadow = true;
    g.add(torso);
    return g;
}

function buildFallbackTreant() {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ map: worldTextures.bark, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ map: worldTextures.foliage, roughness: 0.8 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 7.6, 12), barkMat);
    trunk.position.y = 3.8;
    const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(3.5, 1), leafMat);
    crown.position.y = 7.8;
    g.add(trunk, crown);
    return g;
}

function spawnBossProjectile(originPos, targetPos, type) {
    const isLava = (type === 'lava');
    const geo = isLava ? new THREE.DodecahedronGeometry(0.48, 1) : new THREE.ConeGeometry(0.32, 1.3, 7);
    const mat = isLava
        ? new THREE.MeshStandardMaterial({ map: worldTextures.lava, emissive: 0xff3300, emissiveIntensity: 1.8 })
        : new THREE.MeshStandardMaterial({ map: worldTextures.bark, color: 0x3f6212, emissive: 0x1a2e05, emissiveIntensity: 0.6 });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(originPos);
    mesh.castShadow = true;
    scene.add(mesh);

    const flightTime = 1.05;
    const vx = (targetPos.x - originPos.x) / flightTime;
    const vz = (targetPos.z - originPos.z) / flightTime;
    const gravity = 12.0;
    const vy = ((targetPos.y - originPos.y) + 0.5 * gravity * flightTime * flightTime) / flightTime;

    bossProjectiles.push({
        mesh,
        velocity: new THREE.Vector3(vx, vy, vz),
        gravity,
        color: isLava ? 0xff4500 : 0x65a30d,
        life: 3.0
    });
}

/** --- JEFE 1: COLOSO DE ROCA Y MAGMA --- */
function spawnStoneGolem() {
    if (stoneGolem) return;

    const golemGroup = new THREE.Group();
    let visualBody;

    if (preloadedGolemScene) {
        const norm = normalizeBossGLB(preloadedGolemScene, 4.4, 'golem');
        visualBody = norm.container;
    } else {
        visualBody = buildFallbackGolem();
    }
    golemGroup.add(visualBody);

    const hitbox = new THREE.Mesh(
        new THREE.CylinderGeometry(1.75, 1.85, 4.4, 12),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    hitbox.position.y = 2.2;
    golemGroup.add(hitbox);

    const hpSpriteMat = new THREE.SpriteMaterial({ map: createBossHpTexture('COLOSO', 240, 240, '#dc2626'), transparent: true });
    const hpSprite = new THREE.Sprite(hpSpriteMat);
    hpSprite.scale.set(3.6, 0.68, 1);
    hpSprite.position.set(0, 5.1, 0);

    const golemLight = new THREE.PointLight(0xff2200, 9, 16);
    golemLight.position.set(0, 2.5, 1.5);
    golemGroup.add(hpSprite, golemLight);

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerRig.rotation.y);
    const spawnX = THREE.MathUtils.clamp(playerRig.position.x + forward.x * 16, -MAP_LIMIT + 15, MAP_LIMIT - 15);
    const spawnZ = THREE.MathUtils.clamp(playerRig.position.z + forward.z * 16, -MAP_LIMIT + 15, MAP_LIMIT - 15);
    golemGroup.position.set(spawnX, 0, spawnZ);
    scene.add(golemGroup);

    stoneGolem = {
        group: golemGroup,
        visualBody,
        hitboxes: [hitbox],
        hpSprite,
        hp: 240,
        maxHp: 240,
        alive: true,
        attackCooldown: 0,
        throwCooldown: 2.5
    };

    shatterObject(golemGroup.position, 0xdc2626, 32, 0.38);
    playBreakSound();
    updateBossHUD();
}

/** --- JEFE 2: GUARDIÁN ANCESTRAL DEL BOSQUE (+75% TAMAÑO -> 8.4m DE ALTURA) --- */
function spawnForestTreant() {
    if (forestTreant) return;

    const treantGroup = new THREE.Group();
    let visualBody;
    let mixer = null;

    if (preloadedTreantGltf) {
        const norm = normalizeBossGLB(preloadedTreantGltf.scene, 8.4, 'treant', preloadedTreantGltf.animations);
        visualBody = norm.container;
        mixer = norm.mixer;
    } else {
        visualBody = buildFallbackTreant();
    }
    treantGroup.add(visualBody);

    const hitbox = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 2.8, 8.4, 12),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    hitbox.position.y = 4.2;
    treantGroup.add(hitbox);

    const hpSpriteMat = new THREE.SpriteMaterial({ map: createBossHpTexture('GUARDIÁN', 260, 260, '#16a34a'), transparent: true });
    const hpSprite = new THREE.Sprite(hpSpriteMat);
    hpSprite.scale.set(5.2, 0.98, 1);
    hpSprite.position.set(0, 9.2, 0);

    const forestLight = new THREE.PointLight(0x84cc16, 10, 22);
    forestLight.position.set(0, 4.5, 2.0);
    treantGroup.add(hpSprite, forestLight);

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerRig.rotation.y);
    const spawnX = THREE.MathUtils.clamp(playerRig.position.x + forward.x * 18, -MAP_LIMIT + 15, MAP_LIMIT - 15);
    const spawnZ = THREE.MathUtils.clamp(playerRig.position.z + forward.z * 18, -MAP_LIMIT + 15, MAP_LIMIT - 15);
    treantGroup.position.set(spawnX, 0, spawnZ);
    scene.add(treantGroup);

    forestTreant = {
        group: treantGroup,
        visualBody,
        mixer,
        hitboxes: [hitbox],
        hpSprite,
        hp: 260,
        maxHp: 260,
        alive: true,
        attackCooldown: 0,
        throwCooldown: 3.0
    };

    shatterObject(treantGroup.position, 0x65a30d, 36, 0.45);
    playBreakSound();
    updateBossHUD();
}

function updateBossHUD() {
    const activeBoss = (stoneGolem && stoneGolem.alive) ? stoneGolem : ((forestTreant && forestTreant.alive) ? forestTreant : null);
    if (!activeBoss) {
        bossHudEl.classList.add('hidden');
        return;
    }

    bossHudEl.classList.remove('hidden');
    const isTreant = (activeBoss === forestTreant);

    if (isTreant) {
        bossHudEl.classList.add('forest-boss');
        bossTitleTextEl.innerHTML = `🌲 GUARDIÁN ANCESTRAL DEL BOSQUE: <span id="bossHpText">${Math.max(0, activeBoss.hp)} / ${activeBoss.maxHp}</span> HP`;
    } else {
        bossHudEl.classList.remove('forest-boss');
        bossTitleTextEl.innerHTML = `🔥 COLOSO DE ROCA Y MAGMA: <span id="bossHpText">${Math.max(0, activeBoss.hp)} / ${activeBoss.maxHp}</span> HP`;
    }
    bossBarFillEl.style.width = `${(Math.max(0, activeBoss.hp) / activeBoss.maxHp) * 100}%`;
}

function damageBoss(boss, hitPoint, isTreant) {
    if (!boss || !boss.alive) return;

    const dmg = 14 + Math.floor(Math.random() * 5);
    boss.hp = Math.max(0, boss.hp - dmg);

    playBreakSound();
    shatterObject(hitPoint || boss.group.position, isTreant ? 0x65a30d : 0xff2200, 14, 0.22);

    if (boss.hpSprite.material.map) boss.hpSprite.material.map.dispose();
    boss.hpSprite.material.map = createBossHpTexture(
        isTreant ? 'GUARDIÁN' : 'COLOSO',
        boss.hp,
        boss.maxHp,
        isTreant ? '#16a34a' : '#dc2626'
    );

    updateBossHUD();

    if (boss.hp <= 0) {
        boss.alive = false;
        playerScore += 500;
        scoreCountEl.textContent = String(playerScore);
        shatterObject(boss.group.position, isTreant ? 0x65a30d : 0xff2200, 48, 0.45);
        scene.remove(boss.group);
        if (isTreant) forestTreant = null;
        else stoneGolem = null;
        setTimeout(updateBossHUD, 1200);
    }
}

/** ========= DAÑO AL JUGADOR Y REINICIO CON DESPERTAR TIRADO EN EL SUELO ========= */
function damagePlayer() {
    if (playerInvulnTimer > 0 || isWakingUp) return;

    playerHearts = Math.max(0, playerHearts - 1);
    playerInvulnTimer = 1.65;
    updateHeartsUI();
    triggerDamageFlash();
    playBreakSound();

    if (playerHearts <= 0) {
        resetWorldAndWakeUpOnGround();
    }
}

function resetWorldAndWakeUpOnGround() {
    if (stoneGolem) {
        scene.remove(stoneGolem.group);
        stoneGolem = null;
    }
    if (forestTreant) {
        scene.remove(forestTreant.group);
        forestTreant = null;
    }
    for (let i = bossProjectiles.length - 1; i >= 0; i--) {
        scene.remove(bossProjectiles[i].mesh);
        bossProjectiles.splice(i, 1);
    }
    bossHudEl.classList.add('hidden');

    destructibleMeshes.length = 0;
    for (let i = staticObstacles.length - 1; i >= 0; i--) {
        if (!staticObstacles[i].indestructible) {
            scene.remove(staticObstacles[i].group);
            staticObstacles.splice(i, 1);
        }
    }
    totalTargets = 0;
    destroyedCount = 0;
    destroyedRocksCount = 0;
    destroyedTreesCount = 0;
    playerScore = 0;
    destroyedCountEl.textContent = '0';
    scoreCountEl.textContent = '0';

    buildNordicForest();
    createDestructibleTargets();

    playerHearts = MAX_HEARTS;
    playerStamina = MAX_STAMINA;
    staminaExhausted = false;
    updateHeartsUI();
    updateStaminaUI();

    recallThrownAxe();
    playerRig.position.set(0, 0.28, 12);
    playerRig.rotation.set(0, 0, 0);
    pcCameraPitch = 0;
    if (!renderer.xr.isPresenting) {
        camera.rotation.set(0.65, 0, 0.55);
    }
    currentGroundY = 0;
    playerJumpOffset = 0;
    verticalVelocity = 0;
    isGrounded = true;

    isWakingUp = true;
    wakeUpProgress = 0;
    if (wakeupCurtain) wakeupCurtain.style.opacity = '1';
}

/** ========= OBJETIVOS DESTRUCTIBLES EN EL VALLE Y LA CUEVA ========= */
function createDestructibleTargets() {
    // IcosahedronGeometry suavizada en lugar de Dodecahedron para evitar distorsión/parpadeo en las caras
    const rockMat = new THREE.MeshStandardMaterial({
        map: loadWorldTexture('assets/textures/roca.jpg', 1, 1),
        roughness: 0.88,
        metalness: 0.04
    });
    const runeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 1.5 });

    [
        { x: -12, z: 8, r: 1.4 },  { x: 12, z: -6, r: 1.5 },
        { x: -18, z: -12, r: 1.5 }, { x: 24, z: 22, r: 1.6 },
        { x: -45, z: 24, r: 1.8 }, { x: 52, z: -26, r: 1.7 }
    ].forEach((data) => {
        const rockGroup = new THREE.Group();
        const rockMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(data.r, 2), rockMat);
        rockMesh.castShadow = true;
        rockMesh.receiveShadow = true;
        const runeRing = new THREE.Mesh(new THREE.TorusGeometry(data.r * 0.92, 0.05, 8, 28), runeMat);
        runeRing.rotation.x = Math.PI / 2;
        rockGroup.add(rockMesh, runeRing);
        rockGroup.position.set(data.x, data.r * 0.75, data.z);
        scene.add(rockGroup);

        const targetData = { group: rockGroup, radius: data.r * 0.95, color: 0x38bdf8, points: 20, isRock: true, isTree: false, destroyed: false };
        rockMesh.userData.target = targetData;
        runeRing.userData.target = targetData;
        staticObstacles.push(targetData);
        destructibleMeshes.push(rockMesh, runeRing);
        totalTargets++;
    });

    const chestWoodMat = new THREE.MeshStandardMaterial({ map: worldTextures.bark, roughness: 0.55 });
    const chestGoldMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.65, metalness: 0.8 });

    [
        { x: 0, z: -96 },
        { x: -4.5, z: -98 },
        { x: 86, z: 10 },
        { x: -85, z: -12 },
        { x: 46, z: 72 }
    ].forEach((c) => {
        const chestGroup = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.85), chestWoodMat);
        box.position.y = 0.375;
        box.castShadow = true;
        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.35, 0.92), chestGoldMat);
        lock.position.y = 0.65;
        chestGroup.add(box, lock);
        chestGroup.position.set(c.x, 0, c.z);
        scene.add(chestGroup);

        const targetData = { group: chestGroup, radius: 0.9, color: 0xfacc15, points: 100, isRock: false, isTree: false, destroyed: false };
        box.userData.target = targetData;
        lock.userData.target = targetData;
        staticObstacles.push(targetData);
        destructibleMeshes.push(box, lock);
        totalTargets++;
    });

    totalTargetsEl.textContent = String(totalTargets);
}

/** ========= HACHA VIKINGA: GOLPE CUERPO A CUERPO + LANZAMIENTO ========= */
function buildAxeMesh() {
    const axe = new THREE.Group();
    const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.028, 0.72, 10),
        new THREE.MeshStandardMaterial({ map: worldTextures.bark, roughness: 0.75 })
    );
    handle.position.y = 0.25;
    const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.24, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.22 })
    );
    blade.position.set(0, 0.52, -0.11);
    const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.024, 0.26, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.8 })
    );
    edge.position.set(0, 0.52, -0.24);
    axe.add(handle, blade, edge);
    return axe;
}

const vikingAxe = buildAxeMesh();
const thrownAxe = buildAxeMesh();
thrownAxe.scale.setScalar(1.35);
thrownAxe.visible = false;
scene.add(thrownAxe);

let axeSwingProgress = 0;
let isSwingingAxe = false;

const thrownState = {
    active: false,
    velocity: new THREE.Vector3(),
    life: 0
};

function triggerAxeSwing() {
    isSwingingAxe = true;
    axeSwingProgress = 0;
}

function throwVikingAxe() {
    if (thrownState.active || isWakingUp || playerStamina < 15) return;

    playerStamina = Math.max(0, playerStamina - 15);
    if (playerStamina === 0) staminaExhausted = true;
    updateStaminaUI();

    thrownState.active = true;
    thrownState.life = 1.45;
    vikingAxe.visible = false;
    thrownAxe.visible = true;

    if (renderer.xr.isPresenting) {
        const origin = new THREE.Vector3().setFromMatrixPosition(controller1.matrixWorld);
        const rotMat = new THREE.Matrix4().identity().extractRotation(controller1.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(rotMat).normalize();
        thrownAxe.position.copy(origin);
        thrownState.velocity.copy(dir).multiplyScalar(28);
    } else {
        const origin = new THREE.Vector3();
        camera.getWorldPosition(origin);
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        thrownAxe.position.copy(origin).addScaledVector(dir, 0.8);
        thrownState.velocity.copy(dir).multiplyScalar(28);
        thrownState.velocity.y += 2.2;
    }
}

function recallThrownAxe() {
    thrownState.active = false;
    thrownAxe.visible = false;
    vikingAxe.visible = true;
}

/** ========= CONTROLADORES META QUEST 3 + GIRO CON JOYSTICK + TELEPORT ========= */
const vrBtn = VRButton.createButton(renderer);
vrBtn.classList.add('vr-button');
document.body.appendChild(vrBtn);

const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
playerRig.add(controller0, controller1);

const controllerModelFactory = new XRControllerModelFactory();
const grip0 = renderer.xr.getControllerGrip(0);
grip0.add(controllerModelFactory.createControllerModel(grip0));
playerRig.add(grip0);

const grip1 = renderer.xr.getControllerGrip(1);
grip1.add(controllerModelFactory.createControllerModel(grip1));
playerRig.add(grip1);

vikingAxe.position.set(0.38, -0.34, -0.55);
vikingAxe.rotation.set(0.25, -0.15, 0.1);
camera.add(vikingAxe);

function createLaserPointer(colorHex) {
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -2.5)]);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85 }));
}
controller0.add(createLaserPointer(0x38bdf8));
controller1.add(createLaserPointer(0xe5b84b));

const arcMatOK = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
const arcMatBAD = new THREE.LineBasicMaterial({ color: 0xef4444 });
const arcGeo = new THREE.BufferGeometry().setFromPoints(new Array(ARC_STEPS).fill(0).map(() => new THREE.Vector3()));
const arcLine = new THREE.Line(arcGeo, arcMatOK);
arcLine.visible = false;
scene.add(arcLine);

const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 32),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
);
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);

let teleportValid = false;
const teleportPoint = new THREE.Vector3();

controller0.addEventListener('selectstart', () => { if (!isWakingUp) { arcLine.visible = true; marker.visible = true; } });
controller0.addEventListener('selectend', () => {
    arcLine.visible = false;
    marker.visible = false;
    if (teleportValid && !isWakingUp) {
        playerRig.position.x = THREE.MathUtils.clamp(teleportPoint.x, -MAP_LIMIT, MAP_LIMIT);
        playerRig.position.z = THREE.MathUtils.clamp(teleportPoint.z, -MAP_LIMIT, MAP_LIMIT);
        currentGroundY = getGroundHeight(playerRig.position.x, playerRig.position.z);
        playerJumpOffset = 0;
        playerRig.position.y = currentGroundY + PLAYER_EYE_HEIGHT;
    }
});

const vrRaycaster = new THREE.Raycaster();
function applyDestroyTarget(t) {
    if (!t || t.destroyed) return;
    t.destroyed = true;
    destroyedCount++;
    playerScore += t.points || 20;
    destroyedCountEl.textContent = String(destroyedCount);
    scoreCountEl.textContent = String(playerScore);
    playBreakSound();

    const effectOrigin = t.group.position.clone();
    if (t.isTree) effectOrigin.y += 1.5;
    shatterObject(effectOrigin, t.color, t.isTree ? 26 : 20, 0.26);
    scene.remove(t.group);

    if (t.isRock) {
        destroyedRocksCount++;
        if (destroyedRocksCount === 3 && !stoneGolem) {
            spawnStoneGolem();
        }
    }

    if (t.isTree) {
        destroyedTreesCount++;
        if (destroyedTreesCount === 5 && !forestTreant) {
            spawnForestTreant();
        }
    }
}

function performMeleeAxeAttack(rayOriginController = null) {
    if (thrownState.active || isWakingUp || playerStamina < 8) return;

    playerStamina = Math.max(0, playerStamina - 8);
    if (playerStamina === 0) staminaExhausted = true;
    updateStaminaUI();

    triggerAxeSwing();

    if (rayOriginController) {
        const tempMatrix = new THREE.Matrix4().identity().extractRotation(rayOriginController.matrixWorld);
        vrRaycaster.ray.origin.setFromMatrixPosition(rayOriginController.matrixWorld);
        vrRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    } else {
        vrRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    }
    vrRaycaster.far = MELEE_RANGE;

    if (stoneGolem && stoneGolem.alive) {
        const golemHits = vrRaycaster.intersectObjects(stoneGolem.hitboxes, true);
        if (golemHits.length > 0) {
            damageBoss(stoneGolem, golemHits[0].point, false);
            return;
        }
    }

    if (forestTreant && forestTreant.alive) {
        const treantHits = vrRaycaster.intersectObjects(forestTreant.hitboxes, true);
        if (treantHits.length > 0) {
            damageBoss(forestTreant, treantHits[0].point, true);
            return;
        }
    }

    const hits = vrRaycaster.intersectObjects(destructibleMeshes, false);
    if (hits.length > 0) {
        applyDestroyTarget(hits[0].object.userData.target);
        return;
    }

    const boardHits = vrRaycaster.intersectObjects(targetBoards, false);
    if (boardHits.length > 0) {
        const bData = boardHits[0].object.userData.boardData || { points: 10, color: 0x2563eb };
        playerScore += bData.points;
        scoreCountEl.textContent = String(playerScore);
        playBreakSound();
        shatterObject(boardHits[0].point, bData.color, 14, 0.14);
    }
}

controller1.addEventListener('selectstart', () => performMeleeAxeAttack(controller1));
controller1.addEventListener('squeezestart', () => throwVikingAxe());

renderer.xr.addEventListener('sessionstart', () => {
    if (document.pointerLockElement) document.exitPointerLock();
    coverOverlay.classList.add('hidden');
    startExperienceAudio();
    camera.remove(vikingAxe);
    camera.rotation.set(0, 0, 0);
    vikingAxe.position.set(0, -0.02, -0.05);
    vikingAxe.rotation.set(-0.3, 0, 0);
    controller1.add(vikingAxe);
});

renderer.xr.addEventListener('sessionend', () => {
    controller1.remove(vikingAxe);
    vikingAxe.position.set(0.38, -0.34, -0.55);
    vikingAxe.rotation.set(0.25, -0.15, 0.1);
    camera.add(vikingAxe);
});

function shatterObject(origin, colorHex, count, size) {
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.4 });
    for (let i = 0; i < count; i++) {
        const piece = new THREE.Mesh(geo, mat);
        piece.position.set(origin.x + (Math.random() - 0.5) * 0.8, origin.y + 0.3, origin.z + (Math.random() - 0.5) * 0.8);
        scene.add(piece);
        debrisPieces.push({
            mesh: piece,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 9, 3.5 + Math.random() * 5, (Math.random() - 0.5) * 9),
            rotSpeed: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
            life: 1.6
        });
    }
}

/** ========= MOVIMIENTO VR, ESTAMINA, MOUSE LOOK Y PC ========= */
function triggerJump() {
    if (isGrounded && !isWakingUp && playerStamina >= 12) {
        playerStamina = Math.max(0, playerStamina - 12);
        updateStaminaUI();
        verticalVelocity = 7.2;
        isGrounded = false;
    }
}

function clampAndCollide(nextPos) {
    nextPos.x = THREE.MathUtils.clamp(nextPos.x, -MAP_LIMIT, MAP_LIMIT);
    nextPos.z = THREE.MathUtils.clamp(nextPos.z, -MAP_LIMIT, MAP_LIMIT);

    // Barandillas del puente
    if (playerRig.position.z >= 43.5 && playerRig.position.z <= 60.5 && Math.abs(playerRig.position.x) <= 2.8) {
        nextPos.x = THREE.MathUtils.clamp(nextPos.x, -2.15, 2.15);
    }

    for (const obs of staticObstacles) {
        if (obs.destroyed) continue;
        const obj3D = obs.group || obs.mesh;
        if (!obj3D) continue;

        const dx = nextPos.x - obj3D.position.x;
        const dz = nextPos.z - obj3D.position.z;
        const dist = Math.hypot(dx, dz);
        const minDist = PLAYER_RADIUS + obs.radius;
        if (dist < minDist && dist > 0.001) {
            const push = minDist - dist;
            nextPos.x += (dx / dist) * push;
            nextPos.z += (dz / dist) * push;
        }
    }
    return nextPos;
}

function updateCurrentZoneHUD() {
    const x = playerRig.position.x;
    const z = playerRig.position.z;
    let zone = 'Plaza Central';
    if (z < -72) zone = 'Cuevas de las Montañas';
    else if (x >= 30.2 && x <= 45.8 && z >= 50.8 && z <= 55.2) zone = 'Barco Drakkar Vikingo';
    else if (x >= 24.5 && x <= 31.5 && z >= 55.0 && z <= 69.0) zone = 'Muelle del Puerto';
    else if (z > 61) zone = 'Puerto Vikingo';
    else if (z >= 43 && z <= 61) {
        zone = Math.abs(x) <= 2.8 ? 'Puente de Madera' : 'Lago / Río Profundo';
    } else if (x > 30) zone = 'Campo de Entrenamiento';
    else if (x > 14 && z < -6) zone = 'Herrería – Forja';
    else if (x < -14 && z < -6) zone = 'Taberna de los Guerreros';
    else if (x < -28) zone = 'Bosque Nórdico';

    if (zoneNameEl.textContent !== zone) zoneNameEl.textContent = zone;
}

function vrGamepadMove(dt) {
    const session = renderer.xr.getSession();
    if (!session || isWakingUp) return false;

    let moving = false;
    let wantsSprint = false;

    for (const src of session.inputSources) {
        if (!src.gamepad) continue;
        const gp = src.gamepad;

        if ((gp.buttons[4]?.pressed || gp.buttons[5]?.pressed) && isGrounded) triggerJump();
        if (gp.buttons[3]?.pressed) wantsSprint = true;

        let stickX = gp.axes[2] ?? gp.axes[0] ?? 0;
        let stickY = gp.axes[3] ?? gp.axes[1] ?? 0;
        if (Math.abs(stickX) < 0.15) stickX = 0;
        if (Math.abs(stickY) < 0.15) stickY = 0;

        if (src.handedness === 'right') {
            if (stickX !== 0) {
                playerRig.rotation.y -= stickX * VR_TURN_SPEED * dt;
            }
            continue;
        }

        if (stickX === 0 && stickY === 0) continue;
        moving = true;
        isRunning = wantsSprint && !staminaExhausted && playerStamina > 2;
        const speed = isRunning ? VR_RUN_SPEED : VR_WALK_SPEED;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const next = playerRig.position.clone();
        next.addScaledVector(forward, -stickY * speed * dt);
        next.addScaledVector(right, stickX * speed * 0.85 * dt);
        const clamped = clampAndCollide(next);
        playerRig.position.x = clamped.x;
        playerRig.position.z = clamped.z;
    }
    return moving;
}

// Giro de cámara con el ratón en modo escritorio (PC)
window.addEventListener('mousemove', (e) => {
    if (renderer.xr.isPresenting || isWakingUp || !coverOverlay.classList.contains('hidden')) return;

    // Si PointerLock está activo usa movementX/Y; si no, permite arrastrar con clic sostenido
    if (document.pointerLockElement === canvas || (e.buttons & 1)) {
        const sensitivity = 0.0024;
        playerRig.rotation.y -= e.movementX * sensitivity;
        pcCameraPitch = THREE.MathUtils.clamp(
            pcCameraPitch - e.movementY * sensitivity,
            -Math.PI * 0.44,
            Math.PI * 0.44
        );
        camera.rotation.x = pcCameraPitch;
    }
});

const pcKeys = { w: false, s: false, a: false, d: false, shift: false };
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') pcKeys.w = true;
    if (k === 's' || e.key === 'ArrowDown') pcKeys.s = true;
    if (k === 'a' || e.key === 'ArrowLeft') pcKeys.a = true;
    if (k === 'd' || e.key === 'ArrowRight') pcKeys.d = true;
    if (e.key === 'Shift') pcKeys.shift = true;
    if (e.code === 'Space') triggerJump();
    if (k === 'e') throwVikingAxe();
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') pcKeys.w = false;
    if (k === 's' || e.key === 'ArrowDown') pcKeys.s = false;
    if (k === 'a' || e.key === 'ArrowLeft') pcKeys.a = false;
    if (k === 'd' || e.key === 'ArrowRight') pcKeys.d = false;
    if (e.key === 'Shift') pcKeys.shift = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
    if (renderer.xr.isPresenting || isWakingUp) return;

    // Activar bloqueo de ratón automáticamente al hacer clic dentro del juego
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock && coverOverlay.classList.contains('hidden')) {
        canvas.requestPointerLock();
    }

    if (e.button === 2) {
        throwVikingAxe();
    } else if (e.button === 0) {
        performMeleeAxeAttack(null);
    }
});

function desktopFallbackMove(dt) {
    if (renderer.xr.isPresenting || isWakingUp) return false;
    if (pcKeys.a) playerRig.rotation.y += 1.9 * dt;
    if (pcKeys.d) playerRig.rotation.y -= 1.9 * dt;

    const dir = (pcKeys.w ? 1 : 0) - (pcKeys.s ? 1 : 0);
    isRunning = pcKeys.shift && dir > 0 && !staminaExhausted && playerStamina > 2;

    if (dir !== 0) {
        const speed = isRunning ? VR_RUN_SPEED : VR_WALK_SPEED;
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerRig.rotation.y);
        const next = playerRig.position.clone().addScaledVector(forward, dir * speed * dt);
        const clamped = clampAndCollide(next);
        playerRig.position.x = clamped.x;
        playerRig.position.z = clamped.z;
        return true;
    }
    return false;
}

function updatePlayerAndAxe(dt, isMoving) {
    if (playerInvulnTimer > 0) playerInvulnTimer = Math.max(0, playerInvulnTimer - dt);

    if (isMoving && isRunning) {
        playerStamina = Math.max(0, playerStamina - 26 * dt);
        if (playerStamina === 0) staminaExhausted = true;
    } else {
        const regenRate = isMoving ? 14 : 24;
        playerStamina = Math.min(MAX_STAMINA, playerStamina + regenRate * dt);
        if (staminaExhausted && playerStamina >= 30) staminaExhausted = false;
    }
    updateStaminaUI();

    if (isWakingUp) {
        wakeUpProgress += dt * 0.34;
        const ease = 1 - Math.pow(1 - Math.min(1, wakeUpProgress), 3);

        playerRig.position.y = THREE.MathUtils.lerp(0.28, PLAYER_EYE_HEIGHT, ease);
        if (!renderer.xr.isPresenting) {
            camera.rotation.x = THREE.MathUtils.lerp(0.65, 0, ease);
            camera.rotation.z = THREE.MathUtils.lerp(0.55, 0, ease);
        }

        const blink = Math.sin(wakeUpProgress * Math.PI * 3) * 0.35 * (1 - ease);
        if (wakeupCurtain) {
            wakeupCurtain.style.opacity = String(THREE.MathUtils.clamp((1 - ease) + blink, 0, 1));
        }

        if (wakeUpProgress >= 1) {
            isWakingUp = false;
            if (wakeupCurtain) wakeupCurtain.style.opacity = '0';
            if (!renderer.xr.isPresenting) camera.rotation.set(0, 0, 0);
        }
        return;
    }

    const targetGround = getGroundHeight(playerRig.position.x, playerRig.position.z);
    currentGroundY = THREE.MathUtils.lerp(currentGroundY, targetGround, 14 * dt);

    if (!isGrounded) {
        playerJumpOffset += verticalVelocity * dt;
        verticalVelocity -= 18.0 * dt;
        if (playerJumpOffset <= 0) {
            playerJumpOffset = 0;
            verticalVelocity = 0;
            isGrounded = true;
        }
    }

    const targetFov = (isMoving && isRunning) ? 82 : 70;
    if (!renderer.xr.isPresenting && Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 8 * dt);
        camera.updateProjectionMatrix();
    }

    let bobOffset = 0;
    if (isMoving && isGrounded) {
        const bobFreq = isRunning ? 15.0 : 9.0;
        const bobAmp = isRunning ? 0.09 : 0.04;
        bobTimer += dt * bobFreq;
        bobOffset = Math.sin(bobTimer) * bobAmp;
    }

    playerRig.position.y = currentGroundY + PLAYER_EYE_HEIGHT + playerJumpOffset + bobOffset;

    if (isSwingingAxe) {
        axeSwingProgress += dt * 4.8;
        const swingAngle = Math.sin(axeSwingProgress * Math.PI) * 1.45;
        if (renderer.xr.isPresenting) {
            vikingAxe.rotation.x = -0.3 - swingAngle;
        } else {
            vikingAxe.rotation.x = 0.25 - swingAngle;
            vikingAxe.position.z = -0.55 - Math.sin(axeSwingProgress * Math.PI) * 0.25;
        }
        if (axeSwingProgress >= 1.0) {
            isSwingingAxe = false;
            vikingAxe.rotation.x = renderer.xr.isPresenting ? -0.3 : 0.25;
            if (!renderer.xr.isPresenting) vikingAxe.position.z = -0.55;
        }
    }

    if (thrownState.active) {
        thrownState.velocity.y -= 14.0 * dt;
        thrownAxe.position.addScaledVector(thrownState.velocity, dt);
        thrownAxe.rotation.x -= 18.0 * dt;
        thrownState.life -= dt;

        if (stoneGolem && stoneGolem.alive) {
            if (thrownAxe.position.distanceTo(stoneGolem.group.position.clone().add(new THREE.Vector3(0, 2.2, 0))) < 2.4) {
                damageBoss(stoneGolem, thrownAxe.position.clone(), false);
                recallThrownAxe();
                return;
            }
        }

        if (forestTreant && forestTreant.alive) {
            if (thrownAxe.position.distanceTo(forestTreant.group.position.clone().add(new THREE.Vector3(0, 4.2, 0))) < 3.4) {
                damageBoss(forestTreant, thrownAxe.position.clone(), true);
                recallThrownAxe();
                return;
            }
        }

        for (const board of targetBoards) {
            const worldPos = new THREE.Vector3();
            board.getWorldPosition(worldPos);
            if (thrownAxe.position.distanceTo(worldPos) < 1.15) {
                const bData = board.userData.boardData || { points: 10, color: 0x2563eb };
                playerScore += bData.points;
                scoreCountEl.textContent = String(playerScore);
                playBreakSound();
                shatterObject(worldPos, bData.color, 18, 0.16);
                recallThrownAxe();
                return;
            }
        }

        for (const obs of staticObstacles) {
            if (obs.destroyed || obs.indestructible) continue;
            const obj3D = obs.group || obs.mesh;
            if (obj3D) {
                const hitCenter = obj3D.position.clone();
                if (obs.isTree) hitCenter.y += 1.5;
                if (thrownAxe.position.distanceTo(hitCenter) < (obs.radius + 0.85)) {
                    applyDestroyTarget(obs);
                    recallThrownAxe();
                    return;
                }
            }
        }

        if (thrownState.life <= 0 || thrownAxe.position.y <= getGroundHeight(thrownAxe.position.x, thrownAxe.position.z)) {
            recallThrownAxe();
        }
    }
}

function updateBossesAndProjectiles(dt, elapsed) {
    // 1. Coloso de Magma
    if (stoneGolem && stoneGolem.alive) {
        if (stoneGolem.attackCooldown > 0) stoneGolem.attackCooldown = Math.max(0, stoneGolem.attackCooldown - dt);
        if (stoneGolem.throwCooldown > 0) stoneGolem.throwCooldown = Math.max(0, stoneGolem.throwCooldown - dt);

        const toPlayerX = playerRig.position.x - stoneGolem.group.position.x;
        const toPlayerZ = playerRig.position.z - stoneGolem.group.position.z;
        const dist = Math.hypot(toPlayerX, toPlayerZ);

        stoneGolem.group.rotation.y = Math.atan2(toPlayerX, toPlayerZ);
        stoneGolem.group.position.y = Math.max(0, getGroundHeight(stoneGolem.group.position.x, stoneGolem.group.position.z));

        if (dist > 2.8) {
            const moveSpeed = 4.9;
            stoneGolem.group.position.x += (toPlayerX / dist) * moveSpeed * dt;
            stoneGolem.group.position.z += (toPlayerZ / dist) * moveSpeed * dt;

            stoneGolem.visualBody.position.y = Math.abs(Math.sin(elapsed * 8.0)) * 0.22;
            stoneGolem.visualBody.rotation.z = Math.sin(elapsed * 4.0) * 0.08;
            stoneGolem.visualBody.rotation.x = 0.12;

            if (dist >= 7.0 && dist <= 28.0 && stoneGolem.throwCooldown <= 0 && !isWakingUp) {
                stoneGolem.throwCooldown = 3.2;
                const throwOrigin = stoneGolem.group.position.clone().add(new THREE.Vector3(0, 3.3, 0));
                const playerTarget = playerRig.position.clone().add(new THREE.Vector3(0, -0.4, 0));
                spawnBossProjectile(throwOrigin, playerTarget, 'lava');
            }
        } else {
            stoneGolem.visualBody.position.y = 0;
            stoneGolem.visualBody.rotation.x = Math.sin(elapsed * 10) * 0.25;
            if (stoneGolem.attackCooldown <= 0 && !isWakingUp) {
                stoneGolem.attackCooldown = 1.65;
                damagePlayer();
            }
        }
    }

    // 2. Guardián del Bosque (8.4m)
    if (forestTreant && forestTreant.alive) {
        if (forestTreant.mixer) forestTreant.mixer.update(dt);
        if (forestTreant.attackCooldown > 0) forestTreant.attackCooldown = Math.max(0, forestTreant.attackCooldown - dt);
        if (forestTreant.throwCooldown > 0) forestTreant.throwCooldown = Math.max(0, forestTreant.throwCooldown - dt);

        const toPlayerX = playerRig.position.x - forestTreant.group.position.x;
        const toPlayerZ = playerRig.position.z - forestTreant.group.position.z;
        const dist = Math.hypot(toPlayerX, toPlayerZ);

        forestTreant.group.rotation.y = Math.atan2(toPlayerX, toPlayerZ);
        forestTreant.group.position.y = Math.max(0, getGroundHeight(forestTreant.group.position.x, forestTreant.group.position.z));

        if (dist > 3.6) {
            const moveSpeed = 4.6;
            forestTreant.group.position.x += (toPlayerX / dist) * moveSpeed * dt;
            forestTreant.group.position.z += (toPlayerZ / dist) * moveSpeed * dt;

            if (dist >= 8.0 && dist <= 30.0 && forestTreant.throwCooldown <= 0 && !isWakingUp) {
                forestTreant.throwCooldown = 3.5;
                const throwOrigin = forestTreant.group.position.clone().add(new THREE.Vector3(0, 5.8, 0));
                const playerTarget = playerRig.position.clone().add(new THREE.Vector3(0, -0.4, 0));
                spawnBossProjectile(throwOrigin, playerTarget, 'root');
            }
        } else {
            if (forestTreant.attackCooldown <= 0 && !isWakingUp) {
                forestTreant.attackCooldown = 1.75;
                damagePlayer();
            }
        }
    }

    // 3. Proyectiles enemigos
    for (let i = bossProjectiles.length - 1; i >= 0; i--) {
        const proj = bossProjectiles[i];
        proj.velocity.y -= proj.gravity * dt;
        proj.mesh.position.addScaledVector(proj.velocity, dt);
        proj.mesh.rotation.x += 7.5 * dt;
        proj.mesh.rotation.z += 5.5 * dt;
        proj.life -= dt;

        const playerCenter = playerRig.position.clone().add(new THREE.Vector3(0, -0.5, 0));
        if (proj.mesh.position.distanceTo(playerCenter) < 1.05) {
            shatterObject(proj.mesh.position, proj.color, 16, 0.18);
            scene.remove(proj.mesh);
            bossProjectiles.splice(i, 1);
            damagePlayer();
            continue;
        }

        const groundY = getGroundHeight(proj.mesh.position.x, proj.mesh.position.z);
        if (proj.life <= 0 || proj.mesh.position.y <= groundY + 0.2) {
            shatterObject(proj.mesh.position, proj.color, 12, 0.15);
            playBreakSound();
            scene.remove(proj.mesh);
            bossProjectiles.splice(i, 1);
        }
    }
}

function updateNPCs(dt, elapsed) {
    villageNPCs.forEach((npc) => {
        const t = elapsed * 3.5 + npc.phase;

        if (npc.bones.leftArm) {
            npc.bones.leftArm.rotation.z = 1.25;
            npc.bones.leftArm.rotation.x = Math.sin(t) * (npc.mode === 'patrol' ? 0.45 : 0.12);
        }
        if (npc.bones.rightArm) {
            npc.bones.rightArm.rotation.z = -1.25;
            npc.bones.rightArm.rotation.x = npc.mode === 'work'
                ? -0.8 + Math.sin(t * 2) * 0.65
                : -Math.sin(t) * (npc.mode === 'patrol' ? 0.45 : 0.12);
        }
        if (npc.bones.leftForeArm) npc.bones.leftForeArm.rotation.y = -0.35;
        if (npc.bones.rightForeArm) npc.bones.rightForeArm.rotation.y = 0.35;

        if (!npc.mixerValid && npc.mode === 'patrol') {
            if (npc.bones.leftLeg) npc.bones.leftLeg.rotation.x = -Math.sin(t) * 0.45;
            if (npc.bones.rightLeg) npc.bones.rightLeg.rotation.x = Math.sin(t) * 0.45;
        }
        if (npc.bones.spine) {
            npc.bones.spine.rotation.x = Math.sin(t) * 0.06;
        }

        if (npc.mode === 'patrol') {
            npc.turnTimer -= dt;
            if (npc.turnTimer <= 0) {
                npc.dirAngle += (Math.random() - 0.5) * 2.2;
                npc.turnTimer = 2.8 + Math.random() * 3.0;
            }
            const nx = npc.group.position.x + Math.sin(npc.dirAngle) * npc.speed * dt;
            const nz = npc.group.position.z + Math.cos(npc.dirAngle) * npc.speed * dt;

            if (
                Math.abs(nx) > MAP_LIMIT - 12 ||
                Math.abs(nz) > MAP_LIMIT - 12 ||
                Math.hypot(nx, nz) < 4.5 ||
                (nz > 40 && nz < 64)
            ) {
                npc.dirAngle += Math.PI * 0.75;
            } else {
                npc.group.position.x = nx;
                npc.group.position.z = nz;
            }
            npc.group.rotation.y = npc.dirAngle;
        } else {
            npc.group.rotation.y = Math.atan2(-npc.group.position.x, -npc.group.position.z);
        }
    });
}

const arcPointsBuf = new Float32Array(ARC_STEPS * 3);
function updateTeleportArc() {
    if (!arcLine.visible) return;
    const origin = new THREE.Vector3().setFromMatrixPosition(controller0.matrixWorld);
    const rotMat = new THREE.Matrix4().identity().extractRotation(controller0.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(rotMat).normalize();

    const pts = [];
    let hitPoint = null;
    const v = dir.clone().multiplyScalar(ARC_SPEED);
    const g = new THREE.Vector3(0, -ARC_GRAVITY, 0);
    const p = origin.clone();

    for (let i = 0; i < ARC_STEPS; i++) {
        pts.push(p.clone());
        v.addScaledVector(g, 1 / 60);
        const np = p.clone().addScaledVector(v, 1 / 60);
        const groundY = getGroundHeight(np.x, np.z);
        if (np.y <= groundY) {
            hitPoint = new THREE.Vector3(np.x, groundY, np.z);
            pts.push(hitPoint.clone());
            break;
        }
        p.copy(np);
    }

    for (let i = 0; i < ARC_STEPS; i++) {
        const P = pts[Math.min(i, pts.length - 1)];
        arcPointsBuf[i * 3 + 0] = P.x;
        arcPointsBuf[i * 3 + 1] = P.y;
        arcPointsBuf[i * 3 + 2] = P.z;
    }
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPointsBuf, 3));
    arcGeo.attributes.position.needsUpdate = true;

    if (hitPoint) {
        teleportValid = Math.abs(hitPoint.x) <= MAP_LIMIT && Math.abs(hitPoint.z) <= MAP_LIMIT;
        arcLine.material = teleportValid ? arcMatOK : arcMatBAD;
        marker.material.color.set(teleportValid ? 0x38bdf8 : 0xef4444);
        marker.position.set(hitPoint.x, hitPoint.y + 0.04, hitPoint.z);
        teleportPoint.copy(hitPoint);
    } else {
        teleportValid = false;
    }
}

/** ========= INICIALIZACIÓN Y BUCLE PRINCIPAL ========= */
buildAllEightZones();
buildNordicForest();
createWildlife();
createDestructibleTargets();
loadVikingNPCs();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    npcMixers.forEach((m) => m.update(dt));
    updateDayNightCycle(elapsed);

    const isMoving = renderer.xr.isPresenting ? vrGamepadMove(dt) : desktopFallbackMove(dt);
    updatePlayerAndAxe(dt, isMoving);
    updateCurrentZoneHUD();
    if (renderer.xr.isPresenting) updateTeleportArc();

    updateBossesAndProjectiles(dt, elapsed);
    updateNPCs(dt, elapsed);

    if (riverWater && riverWater.material.bumpMap) {
        riverWater.material.bumpMap.offset.x = elapsed * 0.06;
        riverWater.material.bumpMap.offset.y = elapsed * 0.03;
    }

    if (drakkarShip) {
        drakkarShip.position.y = 0.15 + Math.sin(elapsed * 1.8) * 0.08;
        drakkarShip.rotation.z = Math.sin(elapsed * 1.4) * 0.03;
    }

    if (torchLight) torchLight.intensity = 9.0 + Math.sin(elapsed * 14) * 2.0;
    fireParticles.forEach((fp) => {
        const cycle = (elapsed * fp.speed + fp.offset) % 1;
        fp.mesh.position.y = 0.3 + cycle * 1.5;
        fp.mesh.position.x = fp.baseX + Math.sin(elapsed * 6 + fp.offset) * 0.2 * (1 - cycle);
        fp.mesh.position.z = fp.baseZ + Math.cos(elapsed * 6 + fp.offset) * 0.2 * (1 - cycle);
        fp.mesh.scale.setScalar(1 - cycle * 0.7);
    });

    animatedAnimals.forEach((animal) => {
        if (animal.type === 'crow') {
            animal.angle += animal.speed * dt;
            animal.group.position.set(
                Math.cos(animal.angle) * animal.radius,
                animal.height + Math.sin(elapsed * 2 + animal.angle) * 0.6,
                Math.sin(animal.angle) * animal.radius
            );
            animal.group.rotation.y = -animal.angle;
            const flap = Math.sin(elapsed * 11 + animal.angle) * 0.55;
            animal.leftWing.rotation.z = flap;
            animal.rightWing.rotation.z = -flap;
        } else if (animal.type === 'sheep') {
            const t = elapsed * 0.35 + animal.phase;
            animal.group.position.x = animal.originX + Math.cos(t) * 2.2;
            animal.group.position.z = animal.originZ + Math.sin(t) * 2.2;
            animal.group.rotation.y = -t;
            animal.head.rotation.x = Math.max(0, Math.sin(elapsed * 2.2 + animal.phase)) * 0.45;
        }
    });

    for (let i = debrisPieces.length - 1; i >= 0; i--) {
        const p = debrisPieces[i]; 
        p.velocity.y -= 16 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.rotation.x += p.rotSpeed.x * dt;
        p.mesh.rotation.y += p.rotSpeed.y * dt;

        if (p.mesh.position.y < 0.15) {
            p.mesh.position.y = 0.15;
            p.velocity.y *= -0.4;
            p.velocity.x *= 0.7;
            p.velocity.z *= 0.7;
        }

        p.life -= dt;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            debrisPieces.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});