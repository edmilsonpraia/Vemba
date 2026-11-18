// ============================================================================
// VPO · Vessel 3D — separador tri-fásico horizontal paramétrico
//
// Script REGULAR (não module) para funcionar directamente de file://
// Requer: window.THREE (UMD r147) e THREE.OrbitControls carregados antes.
//
// Construção procedural com Three.js, re-gerada a cada mudança de
// parâmetro (sidebar). Representa fisicamente:
//   • Shell cilíndrico (D, L calculados em calculateSeparatorDesign)
//   • Cabeçotes elípticos 2:1 (ASME UG-32) via LatheGeometry
//   • Fase de água (segmento circular inferior, altura = f(waterCut))
//   • Fase de óleo (segmento acima da água até ~55% liquid fill)
//   • Weir, mist extractor, 5 bocais, saddles, labels em sprites
//
// Exporta window.VPO3D = { init(container, specs), update(specs),
//                           dispose(), setView(view), snapshot() }
// ============================================================================

(function () {
'use strict';

if (typeof THREE === 'undefined') {
    console.error('[VPO3D] THREE global não encontrado. Carregue three.min.js antes de vessel3d.js.');
    window.VPO3D = { __err: 'THREE not loaded' };
    return;
}
const OrbitControls = THREE.OrbitControls;
if (!OrbitControls) {
    console.error('[VPO3D] THREE.OrbitControls não encontrado. Carregue examples/js/controls/OrbitControls.js.');
    window.VPO3D = { __err: 'OrbitControls not loaded' };
    return;
}

// Palette (coerente com tokens VPO)
const C = {
    shell:      0x64748b,  // slate 500
    shellSpec:  0x94a3b8,  // slate 400
    oil:        0xfb923c,  // orange 400
    water:      0x2563eb,  // blue 600
    gas:        0x67e8f9,  // cyan 300
    weir:       0x475569,  // slate 600
    mesh:       0xa78bfa,  // violet 400
    nozzle:     0x475569,
    skid:       0x334155,
    label:      '#f1f5f9',
    labelDim:   '#94a3b8',
    accent:     0x06b6d4
};

class Separator3D {
    constructor() {
        this.container = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.vesselGroup = null;      // root que é destruído e reconstruído a cada update
        this.animationId = null;
        this.resizeObserver = null;
        this.currentSpecs = null;
        // Animação
        this.clock = null;
        this.particles = [];           // sistemas de partículas activos
        this.paused = false;
    }

    // ------------------------------------------------------------------
    // Setup inicial — cena, câmara, luz, controles
    // ------------------------------------------------------------------
    init(container, specs) {
        this.container = container;
        if (!container) {
            console.error('[VPO3D] init() chamado sem container');
            return;
        }

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = null; // viewport gradient CSS

        // Dimensões — se o container estiver 0×0 (ex. tab recém-exibida), usa fallback
        const w = Math.max(320, container.clientWidth  || 960);
        const h = Math.max(240, container.clientHeight || 560);
        console.log('[VPO3D] init viewport dimensions', { w, h, specs });

        // Camera
        this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
        this.camera.position.set(8, 5, 8);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        try {
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                preserveDrawingBuffer: true
            });
        } catch (e) {
            console.error('[VPO3D] WebGL indisponível', e);
            throw new Error('WebGL não suportado neste browser');
        }
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        this.renderer.setClearColor(0x000000, 0);
        // Compatibilidade r147/r152+
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        // Qualidade cinemática (Blender-like)
        this.renderer.physicallyCorrectLights = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Environment map (RoomEnvironment pré-baked com PMREM) — essencial para
        // que materiais com transmission/metalness tenham reflexos realistas sem HDR externo.
        if (typeof THREE.RoomEnvironment === 'function') {
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            this.scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
        }

        // Iluminação cinemática (key + fill + rim + ambient hemisphere)
        const hemi = new THREE.HemisphereLight(0xeaf2ff, 0x0b1220, 0.35);
        this.scene.add(hemi);

        const key = new THREE.DirectionalLight(0xffffff, 3.0);
        key.position.set(6, 10, 5);
        key.castShadow = true;
        key.shadow.mapSize.width = 1024;
        key.shadow.mapSize.height = 1024;
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 30;
        key.shadow.camera.left = -8;
        key.shadow.camera.right = 8;
        key.shadow.camera.top = 8;
        key.shadow.camera.bottom = -8;
        key.shadow.bias = -0.0005;
        this.scene.add(key);

        const fill = new THREE.DirectionalLight(0x67e8f9, 1.2);
        fill.position.set(-7, 3, -4);
        this.scene.add(fill);

        const rim = new THREE.DirectionalLight(0xa78bfa, 0.8);
        rim.position.set(0, 2, -8);
        this.scene.add(rim);

        // Chão com sombra suave
        const floorGeo = new THREE.CircleGeometry(12, 48);
        const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1.5;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Grid (disposição industrial, mais sutil)
        const grid = new THREE.GridHelper(20, 20, 0x1f2a44, 0x162138);
        grid.position.y = -1.498;
        this.scene.add(grid);

        // Orbit controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.rotateSpeed = 0.6;
        this.controls.minDistance = 3;
        this.controls.maxDistance = 25;
        this.controls.maxPolarAngle = Math.PI * 0.95;
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        // Resize responsivo
        this.resizeObserver = new ResizeObserver(() => this._handleResize());
        this.resizeObserver.observe(container);

        // Clock para integração temporal das partículas
        this.clock = new THREE.Clock();

        // Construir geometria inicial
        this.update(specs);

        // Animation loop — pausa quando o container não está visível (tab inactiva)
        const loop = () => {
            this.animationId = requestAnimationFrame(loop);
            if (!this.container) return;
            if (this.container.clientWidth === 0 || this.container.clientHeight === 0) return;
            const dt = this.clock ? Math.min(0.05, this.clock.getDelta()) : 0.016;
            if (!this.paused) {
                for (const sys of this.particles) sys.tick(dt);
            }
            if (this.controls) this.controls.update();
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        };
        loop();
    }

    // Toggle animação (botão PAUSE)
    togglePause() {
        this.paused = !this.paused;
        return this.paused;
    }

    // Velocidade terminal real (chama o separatorModel do app se disponível)
    // devolve módulo em m/s (sentido definido pelo caller via sinal da Δρ)
    _modelTerminal(d, rho_p, rho_f, mu) {
        try {
            if (typeof window !== 'undefined' && window.separatorModel &&
                typeof window.separatorModel.terminalVelocity === 'function') {
                return window.separatorModel.terminalVelocity(d, rho_p, rho_f, mu);
            }
        } catch (_) { /* fallback */ }
        // Fallback: Stokes puro
        return (9.81 * d*d * (rho_p - rho_f)) / (18 * Math.max(1e-6, mu));
    }

    _handleResize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
    }

    // ------------------------------------------------------------------
    // Reconstrução total da geometria a partir dos specs
    // ------------------------------------------------------------------
    update(specs) {
        if (!this.scene) return;
        this.currentSpecs = specs;

        // Limpar grupo anterior
        if (this.vesselGroup) {
            this._disposeGroup(this.vesselGroup);
            this.scene.remove(this.vesselGroup);
        }

        const group = new THREE.Group();
        this.vesselGroup = group;

        // Specs saneados com defaults razoáveis caso faltem
        const D = specs?.D_final ?? 1.5;        // m
        const L = specs?.L_eff ?? 5.0;          // m
        const t_mm = specs?.t_total ?? 12;      // mm
        const waterCut = specs?.waterCut ?? 42; // %
        const isHorizontal = (specs?.type ?? '').toLowerCase().includes('horizontal') || !specs?.type;

        // Normalizar visualização para caber bem no viewport
        // (mantemos proporções reais entre L e D, mas escalonamos o conjunto)
        const scale = 1.0;  // 1 unidade Three.js = 1 metro
        const R = (D / 2) * scale;
        const halfL = (L / 2) * scale;

        // Fração de água (do volume líquido ocupado, ~55% do vaso é líquido)
        const liquidFillFrac = 0.55;
        const waterFrac_of_liquid = Math.max(0.05, Math.min(0.95, waterCut / 100));

        // Altura das interfaces (do fundo)
        // água vai de y = -R até h_water; óleo de h_water até h_oil; gás acima
        const liquidHeight = 2 * R * liquidFillFrac;                  // altura total da coluna de líquido
        const waterHeight  = liquidHeight * waterFrac_of_liquid;      // da base
        const oilHeightTop = liquidHeight;                            // topo do óleo (= topo do líquido)

        // Converter alturas (desde o fundo) em coordenadas y do vaso (centro em y=0)
        const yWaterLvl = -R + waterHeight;        // interface O/A
        const yOilLvl   = -R + oilHeightTop;       // interface L/G

        // POSIÇÃO DO WEIR (necessária desde cedo para cortar as fases nas câmaras)
        // weirX separa o vaso em: [-halfL, weirX] câmara de separação + [weirX, +halfL] bucket de óleo
        const weirX    = isHorizontal ? (halfL * 0.30) : (halfL * 2);
        const weirTopY = -R + (2 * R * 0.45);       // topo do weir (altura abaixo do topo do líquido)

        // ------------------------------------------------------------------
        // 1. Shell cilíndrico — AÇO ESCOVADO com inner view por transparência
        //    Duas camadas: exterior metálico sólido, interior em wireframe sutil
        // ------------------------------------------------------------------
        const shellGeo = new THREE.CylinderGeometry(R, R, 2 * halfL, 64, 1, true);
        const shellMat = new THREE.MeshPhysicalMaterial({
            color: 0x8a9bb0,
            metalness: 0.9,
            roughness: 0.28,
            clearcoat: 0.8,
            clearcoatRoughness: 0.15,
            transparent: true,
            opacity: 0.18,         // casco translúcido para ver o interior
            side: THREE.DoubleSide,
            envMapIntensity: 1.2
        });
        const shell = new THREE.Mesh(shellGeo, shellMat);
        shell.rotation.z = Math.PI / 2;
        shell.castShadow = true;
        shell.receiveShadow = true;
        group.add(shell);

        // Linhas de contorno do shell — dão forma ao vaso sem o fechar
        const shellEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(shellGeo, 20),
            new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.45 })
        );
        shellEdges.rotation.z = Math.PI / 2;
        group.add(shellEdges);

        // ------------------------------------------------------------------
        // 2. Cabeçotes 2:1 elípticos (LatheGeometry)
        // Perfil de uma semi-elipse de semi-eixos (R, R/2)
        // ------------------------------------------------------------------
        const headPoints = [];
        const N = 24;
        for (let i = 0; i <= N; i++) {
            const theta = (Math.PI / 2) * (i / N);
            const y = R * Math.cos(theta);
            const x = (R / 2) * Math.sin(theta);   // semi-eixo axial = R/2 (2:1)
            headPoints.push(new THREE.Vector2(y, x));
        }
        const headGeo = new THREE.LatheGeometry(headPoints, 48);
        const headMat = shellMat.clone();

        const headL = new THREE.Mesh(headGeo, headMat);
        headL.rotation.z = Math.PI / 2;
        headL.position.x = -halfL;
        headL.rotation.y = Math.PI;
        headL.castShadow = true;
        headL.receiveShadow = true;
        group.add(headL);

        const headR = new THREE.Mesh(headGeo, headMat);
        headR.rotation.z = -Math.PI / 2;
        headR.position.x = halfL;
        headR.castShadow = true;
        headR.receiveShadow = true;
        group.add(headR);

        // ------------------------------------------------------------------
        // 3. Fases fluidas — segmentos circulares extrudados ao longo do eixo
        //    Shape 2D no plano YZ (y vertical, z profundidade), extrudo em Z,
        //    roto Y 90° para alinhar com o eixo X do vaso.
        //    Algoritmo robusto: desenha um "pedaço de pizza" entre y=yBot e y=yTop
        //    por amostragem densa de pontos do círculo inteiro, filtrando os
        //    que caem dentro da faixa [yBot, yTop].
        // ------------------------------------------------------------------
        // yBottom/yTop definem a faixa vertical. xStart/xEnd (opcionais) permitem
        // criar um segmento axial parcial — essencial para o "oil bucket" após o
        // weir e para a água que só existe na câmara esquerda.
        const makePhaseMesh = (yBottom, yTop, color, opacity, xStart, xEnd) => {
            const yB = Math.max(-R, Math.min(R, yBottom));
            const yT = Math.max(-R, Math.min(R, yTop));
            if (yT - yB < 1e-3) return null;

            // Defaults para o vaso inteiro (comportamento legado)
            const xS = (xStart === undefined) ? -halfL * 0.98 : xStart;
            const xE = (xEnd === undefined)   ?  halfL * 0.98 : xEnd;
            const depth = xE - xS;
            if (depth <= 1e-3) return null;

            // Amostragem densa do círculo, filtra na faixa [yB, yT], ordena por ângulo
            const N = 96;
            const pts = [];
            for (let i = 0; i < N; i++) {
                const a = (i / N) * Math.PI * 2;
                const z = R * Math.cos(a);
                const y = R * Math.sin(a);
                if (y >= yB && y <= yT) pts.push({ z, y });
            }
            if (yT < R) {
                const zTop = Math.sqrt(Math.max(0, R*R - yT*yT));
                pts.push({ z:  zTop, y: yT });
                pts.push({ z: -zTop, y: yT });
            }
            if (yB > -R) {
                const zBot = Math.sqrt(Math.max(0, R*R - yB*yB));
                pts.push({ z:  zBot, y: yB });
                pts.push({ z: -zBot, y: yB });
            }
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
            pts.sort((a, b) => Math.atan2(a.y - cy, a.z - cz) - Math.atan2(b.y - cy, b.z - cz));

            if (pts.length < 3) return null;

            const shape = new THREE.Shape();
            shape.moveTo(pts[0].z, pts[0].y);
            for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].z, pts[i].y);
            shape.closePath();

            const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
            // Depois de rodar 90° em Y, o eixo Z do extrude passa a ser o eixo X do mundo.
            // A geometria é extrudada em +Z local a partir de 0; posicionamos o mesh
            // em x = xS para o inicio ficar na posição correcta.
            const mesh = new THREE.Mesh(geo, null);
            mesh.rotation.y = Math.PI / 2;
            mesh.position.x = xS;
            return mesh;
        };

        // Materiais LÍQUIDOS reais (PBR com índice de refracção físico)
        // ÁGUA: azul claro translúcido com refracção ior=1.33
        const waterMat = new THREE.MeshPhysicalMaterial({
            color: 0x2563eb,                 // blue-600 — água do mar / produção
            metalness: 0.0,
            roughness: 0.08,                  // superfície lisa
            transmission: 0.70,               // claramente translúcida
            thickness: 1.5,
            ior: 1.33,                        // IOR real da água
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false,
            envMapIntensity: 1.1,
            clearcoat: 0.6,                   // reflexo de superfície
            clearcoatRoughness: 0.08,
            attenuationColor: 0x1e40af,       // blue-800 (mais escuro em profundidade)
            attenuationDistance: 2.0
        });
        // ÓLEO: PETRÓLEO CRU PRETO — quase opaco, superfície viscosa brilhante
        const oilMat = new THREE.MeshPhysicalMaterial({
            color: 0x070708,                 // quase preto absoluto (crude)
            metalness: 0.0,
            roughness: 0.35,                  // superfície viscosa
            transmission: 0.03,               // quase opaco (crude não vê através)
            thickness: 2.5,
            ior: 1.47,                        // IOR real do óleo cru
            transparent: true,
            opacity: 0.98,
            side: THREE.DoubleSide,
            depthWrite: false,
            envMapIntensity: 1.0,
            clearcoat: 1.0,                   // SUPERFÍCIE MOLHADA / BRILHANTE
            clearcoatRoughness: 0.05,         // reflexos agudos (gloss alto)
            attenuationColor: 0x000000,
            attenuationDistance: 0.3
        });

        // -- ARQUITECTURA DE 2 CÂMARAS (weir divide em separação + bucket de óleo) --
        //
        //   Câmara esquerda [-halfL → weirX]       Câmara direita [weirX → +halfL]
        //   ┌────────────────────────────┬──────────────────────────────┐
        //   │  Gás                       ‖                              │
        //   │  Óleo (sobre água)         ‖   Óleo ocupa toda a altura   │
        //   │  Água ← retida pelo weir   ‖   (bucket — SEM água)        │
        //   └────────────────────────────┴──────────────────────────────┘

        // ÁGUA — só na câmara esquerda, do fundo até yWaterLvl
        const waterLeftXS = -halfL * 0.98;
        const waterLeftXE = isHorizontal ? weirX - 0.02 : halfL * 0.98;
        const waterMesh = makePhaseMesh(-R + 0.001, yWaterLvl, C.water, 0.88, waterLeftXS, waterLeftXE);
        if (waterMesh) { waterMesh.material = waterMat; group.add(waterMesh); }

        // ÓLEO ESQUERDA — flutua sobre a água, de yWaterLvl até yOilLvl
        const oilLeftMesh = makePhaseMesh(yWaterLvl, yOilLvl, C.oil, 0.92, -halfL * 0.98, waterLeftXE);
        if (oilLeftMesh) { oilLeftMesh.material = oilMat; group.add(oilLeftMesh); }

        // ÓLEO BUCKET (câmara direita) — enche toda a secção até yOilLvl, SEM água
        // (óleo transbordou o weir pelo topo e acumula-se neste compartimento)
        if (isHorizontal) {
            const oilBucketMesh = makePhaseMesh(-R + 0.001, yOilLvl, C.oil, 0.92, weirX + 0.02, halfL * 0.98);
            if (oilBucketMesh) { oilBucketMesh.material = oilMat; group.add(oilBucketMesh); }
        }

        // ------------------------------------------------------------------
        // 4. Interfaces (planos finos como marcadores)
        // ------------------------------------------------------------------
        const interfacePlane = (y, color) => {
            const g = new THREE.PlaneGeometry(2 * halfL * 0.96, 2 * Math.sqrt(Math.max(0, R*R - y*y)) * 0.98);
            const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(g, m);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = y;
            return mesh;
        };
        if (Math.abs(yWaterLvl) < R) group.add(interfacePlane(yWaterLvl, 0x0ea5e9));
        if (Math.abs(yOilLvl) < R)   group.add(interfacePlane(yOilLvl, 0xf59e0b));

        // ------------------------------------------------------------------
        // 5. Weir plate — divisor físico entre câmara de separação e oil bucket
        //    Usa o weirX já declarado no topo do update().
        // ------------------------------------------------------------------
        if (isHorizontal) {
            const weirHeight = weirTopY - (-R);   // do fundo até weirTopY
            const weirGeo = new THREE.BoxGeometry(0.05, weirHeight, 2 * R * 0.96);
            const weirMat = new THREE.MeshStandardMaterial({
                color: C.weir, metalness: 0.85, roughness: 0.25
            });
            const weir = new THREE.Mesh(weirGeo, weirMat);
            weir.position.set(weirX, -R + weirHeight / 2, 0);
            weir.castShadow = true;
            group.add(weir);
            // Reforço do topo do weir (aresta mais grossa — indicador visual do overflow)
            const weirCap = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.04, 2 * R * 0.96),
                new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 })
            );
            weirCap.position.set(weirX, weirTopY, 0);
            group.add(weirCap);
        }

        // ------------------------------------------------------------------
        // 5b. INLET DIVERTER (Absorvedor de Momento / Schoepentoeter)
        //     Baffle curvo logo após o inlet que intercepta o jacto axial
        //     e redirecciona o escoamento para baixo, promovendo separação
        //     primária gás-líquido.
        // ------------------------------------------------------------------
        if (isHorizontal) {
            const divX = -halfL + 0.28;     // perto do head esquerdo
            const divY = 0;                 // na linha de centro (a montante do inlet)
            // Placa curva: meia secção de cilindro (côncava virada para o inlet)
            const divGeo = new THREE.CylinderGeometry(R * 0.45, R * 0.45, 0.04, 20, 1, false,
                                                       Math.PI * 0.15, Math.PI * 0.70);
            const divMat = new THREE.MeshStandardMaterial({
                color: 0x475569, metalness: 0.85, roughness: 0.30, side: THREE.DoubleSide
            });
            const diverter = new THREE.Mesh(divGeo, divMat);
            diverter.rotation.z = Math.PI / 2;    // eixo do segmento ao longo de X (não vertical)
            diverter.rotation.x = -Math.PI / 2;   // vira a concavidade para -X (face ao inlet)
            diverter.position.set(divX, divY, 0);
            diverter.castShadow = true;
            group.add(diverter);
            // Base curta de ligação ao shell (haste)
            const strut = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.22, 10),
                divMat
            );
            strut.position.set(divX, R * 0.45, 0);
            group.add(strut);
        }

        // ------------------------------------------------------------------
        // 6. MIST EXTRACTOR VERTICAL — parede de wire mesh atravessando a
        //    secção do vaso, antes da saída de gás. É o que o gás atravessa
        //    para deixar as gotículas presas (coalescência por choque).
        // ------------------------------------------------------------------
        const mistX = (weirX + halfL) * 0.55;   // a meio do bucket, antes da saída de gás
        const mistGeo = new THREE.CircleGeometry(R * 0.96, 48);
        const mistMat = new THREE.MeshPhysicalMaterial({
            color: C.mesh, transparent: true, opacity: 0.18,
            side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5,
            depthWrite: false
        });
        const mistDisc = new THREE.Mesh(mistGeo, mistMat);
        mistDisc.rotation.y = Math.PI / 2;    // plano perpendicular ao eixo X
        mistDisc.position.set(mistX, 0, 0);
        group.add(mistDisc);
        // Grid de linhas ortogonais (visual de malha metálica)
        const meshLines = new THREE.Group();
        const gridN = 10;
        const gmat = new THREE.LineBasicMaterial({ color: C.mesh, transparent: true, opacity: 0.85 });
        for (let i = 0; i <= gridN; i++) {
            const u = (i / gridN - 0.5) * 2 * R * 0.96;
            const w = Math.sqrt(Math.max(0, (R * 0.96) ** 2 - u * u));
            // Linhas horizontais (y constante)
            const gh = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(mistX, u, -w), new THREE.Vector3(mistX, u, w)
            ]);
            meshLines.add(new THREE.Line(gh, gmat));
            // Linhas verticais (z constante)
            const gv = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(mistX, -w, u), new THREE.Vector3(mistX,  w, u)
            ]);
            meshLines.add(new THREE.Line(gv, gmat));
        }
        group.add(meshLines);
        // Moldura exterior (aro que segura a malha)
        const frameGeo = new THREE.TorusGeometry(R * 0.96, 0.025, 8, 48);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9, roughness: 0.2 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.rotation.y = Math.PI / 2;
        frame.position.set(mistX, 0, 0);
        group.add(frame);

        // ------------------------------------------------------------------
        // 7. Bocais (cilindros pequenos saindo do shell)
        // ------------------------------------------------------------------
        const addNozzle = (x, y, z, dir, length = 0.45, dia = 0.22, color = C.nozzle) => {
            const nGeo = new THREE.CylinderGeometry(dia, dia, length, 16);
            const nMat = new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.4 });
            const n = new THREE.Mesh(nGeo, nMat);
            n.position.set(x, y, z);
            if (dir === 'y') { /* já vertical */ }
            else if (dir === '-y') { n.rotation.x = Math.PI; }
            else if (dir === 'x')  { n.rotation.z = -Math.PI/2; }
            else if (dir === '-x') { n.rotation.z = Math.PI/2; }
            else if (dir === 'z')  { n.rotation.x = Math.PI/2; }
            // flange
            const fGeo = new THREE.CylinderGeometry(dia * 1.6, dia * 1.6, 0.05, 16);
            const fMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
            const flange = new THREE.Mesh(fGeo, fMat);
            flange.position.y = length / 2 + 0.03;
            n.add(flange);
            return n;
        };

        // Posições de centro das câmaras (para posicionar as saídas correctamente)
        const leftChamberCx  = (-halfL * 0.98 + weirX) / 2;      // câmara de separação
        const rightChamberCx = (weirX + halfL * 0.98) / 2;       // bucket de óleo
        const gasOutX = mistX + (halfL - mistX) * 0.4;           // depois do mist extractor

        // Inlet (esquerda, centrado no vaso axialmente)
        const inlet = addNozzle(-halfL - 0.15, 0, 0, '-x', 0.6, 0.26, C.accent);
        inlet.rotation.z = Math.PI / 2;
        group.add(inlet);
        // Gás outlet (TOPO, depois do mist extractor) — direcção vertical
        group.add(addNozzle(gasOutX, R + 0.22, 0, 'y', 0.5, 0.18));
        // PSV (topo da câmara esquerda — pressão de segurança)
        group.add(addNozzle(-halfL * 0.65, R + 0.2, 0, 'y', 0.4, 0.14, 0xef4444));
        // ÓLEO OUTLET — FUNDO-CENTRO da câmara direita (bucket), direcção DOWN
        group.add(addNozzle(rightChamberCx, -R - 0.22, 0, '-y', 0.5, 0.18));
        // ÁGUA OUTLET — FUNDO-CENTRO da câmara esquerda (separação), direcção DOWN
        group.add(addNozzle(leftChamberCx, -R - 0.22, 0, '-y', 0.5, 0.18));

        // ------------------------------------------------------------------
        // 8. Skids/pernas de suporte (horizontal → saddles)
        // ------------------------------------------------------------------
        if (isHorizontal) {
            const saddleGeo = new THREE.BoxGeometry(0.2, 0.3, 1.8);
            const saddleMat = new THREE.MeshStandardMaterial({ color: C.skid, metalness: 0.5, roughness: 0.6 });
            const saddleL = new THREE.Mesh(saddleGeo, saddleMat);
            saddleL.position.set(-halfL * 0.6, -R - 0.15, 0);
            group.add(saddleL);
            const saddleR = new THREE.Mesh(saddleGeo, saddleMat);
            saddleR.position.set(halfL * 0.6, -R - 0.15, 0);
            group.add(saddleR);
        }

        // ------------------------------------------------------------------
        // 9. Labels de dimensões (sprites de canvas)
        // ------------------------------------------------------------------
        const makeLabel = (text, color = C.label, size = 42) => {
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.font = `600 ${size}px Inter, -apple-system, Segoe UI, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(text, 256, 64);
            const tex = new THREE.CanvasTexture(canvas);
            // Compat: colorSpace (r152+) vs encoding (r147)
            if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
            else if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
            tex.anisotropy = 4;
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(1.8, 0.45, 1);
            return sprite;
        };

        const dimD = makeLabel(`D = ${D.toFixed(2)} m`, C.label, 44);
        dimD.position.set(0, R + 0.6, 0);
        group.add(dimD);
        const dimL = makeLabel(`L = ${L.toFixed(2)} m`, C.labelDim, 40);
        dimL.position.set(0, -R - 0.6, 0);
        group.add(dimL);
        const lblWater = makeLabel(`Água · ${waterCut.toFixed(0)}%`, '#60a5fa', 36);
        lblWater.position.set(-halfL - 1.2, yWaterLvl, 0);
        lblWater.scale.set(1.5, 0.38, 1);
        group.add(lblWater);
        const lblOil = makeLabel(`Óleo`, '#fb923c', 36);
        lblOil.position.set(-halfL - 1.2, (yWaterLvl + yOilLvl) / 2, 0);
        lblOil.scale.set(1.0, 0.30, 1);
        group.add(lblOil);
        const lblGas = makeLabel(`Gás`, '#67e8f9', 36);
        lblGas.position.set(-halfL - 1.2, (yOilLvl + R) / 2 + 0.1, 0);
        lblGas.scale.set(1.0, 0.30, 1);
        group.add(lblGas);

        // ==================================================================
        // 10. SIMULAÇÃO LAGRANGEANA DE SEPARAÇÃO GRAVITACIONAL
        //     Cada partícula é uma gota/bolha física com tipo (gás/óleo/água),
        //     diâmetro, e densidade. Entra misturada pelo bocal e separa-se
        //     por BUOYANCY (Stokes/Morsi-Alexander) enquanto atravessa o vaso.
        //
        //     Transporte:
        //       v_axial   = Q/A (plug flow)                        [eixo X]
        //       v_vertical = terminalVelocity local                 [eixo Y]
        //                   (sinal = sign(ρ_cont − ρ_particle))
        //       weir block: óleo que chega ao weir passa; água é retida
        //
        //     Saídas:
        //       gás   → bocal topo (acelera p/ cima ao chegar a espaço gasoso)
        //       óleo  → sobre weir → bocal lateral direito
        //       água → bocal fundo esquerdo
        //
        //     Resultado visível: dispersão caótica no inlet, estratificação
        //     evidente ao meio do vaso, 3 fases separadas à saída.
        // ==================================================================
        for (const sys of this.particles) sys.dispose();
        this.particles = [];

        // --- Propriedades físicas actuais (para a dinâmica real) ---
        const ptemp = specs?.temperature ?? 62;
        const pvisc = specs?.viscosity ?? 15;
        const prhoOil   = specs?.rhoOil   ?? 870;
        const prhoWater = specs?.rhoWater ?? 1020;
        const prhoGas   = (specs?.rhoGas ?? 1.2);
        const ppressure = specs?.pressure ?? 11.3;
        const pflow     = specs?.flowRate ?? 1250;
        const pgor      = specs?.gor ?? 95;
        const pwc       = waterCut;

        // Viscosidades (Pa·s): água ~0.001; óleo com Beggs-Robinson(T)
        const muWater = 0.001;
        const muOil   = Math.max(1e-4, pvisc * 1e-3 *
                        Math.exp(2500 * (1/(ptemp+273.15) - 1/(60+273.15))));

        // Geometria base partilhada
        const SPHERE_GEO = new THREE.IcosahedronGeometry(1, 2);

        const sampleInCircle = (yMin, yMax) => {
            for (let tries = 0; tries < 20; tries++) {
                const y = yMin + Math.random() * (yMax - yMin);
                const zMax = Math.sqrt(Math.max(0, R*R - y*y));
                const z = (Math.random() * 2 - 1) * zMax;
                if (y*y + z*z <= R*R) return { y, z };
            }
            return { y: (yMin + yMax) / 2, z: 0 };
        };

        // ------------------------------------------------------------------
        // Simulador lagrangeano unificado — UM InstancedMesh, N partículas,
        // cada uma com tipo (gás / óleo / água), diâmetro, cor própria.
        // ------------------------------------------------------------------
        const TYPE_GAS = 0, TYPE_OIL = 1, TYPE_WATER = 2;

        // População total e composição — proporcional aos parâmetros reais
        const TOTAL = Math.round(Math.min(900, 400 + pflow * 0.15));
        const gasFrac = pgor / (pgor + 1000);         // fracção molar gás no inlet
        const liqFrac = 1 - gasFrac;
        const oilFrac = liqFrac * (1 - pwc / 100);
        const waterFrac = liqFrac * (pwc / 100);

        // weirX e weirTopY já declarados no topo do método update().
        // Posições dos bocais de saída (matching com as nozzles correctamente posicionadas)
        const _leftChamberCx  = (-halfL * 0.98 + weirX) / 2;
        const _rightChamberCx = (weirX + halfL * 0.98) / 2;
        const gasOutXp   = mistX + (halfL - mistX) * 0.4;
        const oilOutXp   = _rightChamberCx;     // fundo-centro câmara direita
        const waterOutXp = _leftChamberCx;      // fundo-centro câmara esquerda

        // Factor de visibilidade: v real em m/s → unidades/s no viewport.
        // Escolhido para que uma gota de 300µm (~0,3 mm/s) demore ~5s a atravessar R,
        // tempo suficiente para o utilizador ver a trajectória.
        const VSCALE = 90;

        // Velocidade axial média (plug flow): v = Q / A
        const Q_m3s = pflow / 86400;
        const A_cross = Math.PI * R * R * 0.55; // 55% liquid fill
        const vAxReal = Q_m3s / Math.max(0.05, A_cross);   // m/s (típico 0,01-0,05 m/s)
        const vAxVis = Math.max(0.15, vAxReal * VSCALE * 2.5);

        // Cores e materiais por TIPO (gás=vermelho, óleo=preto crude, água=azul)
        const colorByType = [
            new THREE.Color(0xef4444),   // GÁS: vermelho (red-500) — visível em qualquer fase
            new THREE.Color(0x0b0b0e),   // ÓLEO: preto crude
            new THREE.Color(0x3b82f6)    // ÁGUA: azul (blue-500)
        ];

        // Material partilhado para OLEO/ÁGUA (droplets): PBR normal
        const sphereMat = new THREE.MeshPhysicalMaterial({
            metalness: 0.0, roughness: 0.25,
            transmission: 0.0,               // droplets opacos
            emissive: 0x000000, emissiveIntensity: 0.0,
            transparent: false, opacity: 1.0,
            envMapIntensity: 0.8,
            clearcoat: 0.5, clearcoatRoughness: 0.15,
            vertexColors: false
        });

        // 1 InstancedMesh para óleo+água (droplets) com cor por instância
        const inst = new THREE.InstancedMesh(SPHERE_GEO, sphereMat, TOTAL);
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        inst.castShadow = false;
        inst.receiveShadow = false;
        group.add(inst);

        // InstancedMesh SEPARADO para bolhas de gás (material emissivo vermelho vivo)
        const gasBubbleMat = new THREE.MeshPhysicalMaterial({
            color: 0xff5252,
            emissive: 0xef4444,
            emissiveIntensity: 1.6,          // BRILHO forte (sobressai no crude preto)
            roughness: 0.1,
            metalness: 0.0,
            transmission: 0.25,
            thickness: 0.4,
            ior: 1.0,                         // bolha de ar/gás
            transparent: true,
            opacity: 0.9,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
            envMapIntensity: 1.3
        });
        const gasInst = new THREE.InstancedMesh(SPHERE_GEO, gasBubbleMat, TOTAL);
        gasInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        gasInst.castShadow = false;
        group.add(gasInst);
        // bolhas "desligadas" ficam escondidas via escala 0
        const ZERO_SCALE = 1e-4;

        // Estado por partícula
        const types     = new Uint8Array(TOTAL);
        const px = new Float32Array(TOTAL);
        const py = new Float32Array(TOTAL);
        const pz = new Float32Array(TOTAL);
        const diam = new Float32Array(TOTAL);     // metros
        const size = new Float32Array(TOTAL);     // raio visual
        const phase = new Float32Array(TOTAL);    // para wobble
        const settled = new Uint8Array(TOTAL);    // 1 = na sua fase final

        // Diâmetros base por tipo (meters). Bolhas de gás variam com pressão.
        const dBase = (t) => {
            if (t === TYPE_GAS)   return (2e-3 * Math.cbrt(1.0 / Math.max(0.3, ppressure))) * (0.6 + Math.random() * 0.8);
            if (t === TYPE_OIL)   return 300e-6 * (0.5 + Math.random() * 1.2);
            return 400e-6 * (0.5 + Math.random() * 1.2);
        };
        // Tamanho visual (raio de desenho) = escala do diâmetro real
        const sizeVis = (t, d) => {
            if (t === TYPE_GAS) return Math.max(0.025, d * 50);
            return Math.max(0.018, d * 180);
        };

        // Amostra aleatória de tipo por proporções cumulativas
        const sampleType = () => {
            const r = Math.random();
            if (r < gasFrac) return TYPE_GAS;
            if (r < gasFrac + oilFrac) return TYPE_OIL;
            return TYPE_WATER;
        };

        // Fase destino (y ideal) por tipo
        const targetY = (t) => {
            if (t === TYPE_GAS)   return (yOilLvl + R) / 2;          // meio do espaço gasoso
            if (t === TYPE_OIL)   return (yWaterLvl + yOilLvl) / 2;  // meio do óleo
            return (-R + yWaterLvl) / 2;                             // meio da água
        };

        // Velocidade terminal real baseada na fase que envolve a partícula
        const terminalV = (t, d, y) => {
            // Determina fase contínua local
            let rhoC, muC;
            if (y > yOilLvl) { rhoC = prhoGas; muC = 1.8e-5; }       // gás
            else if (y > yWaterLvl) { rhoC = prhoOil; muC = muOil; } // óleo
            else { rhoC = prhoWater; muC = muWater; }                 // água

            let rhoP;
            if (t === TYPE_GAS)   rhoP = prhoGas;
            else if (t === TYPE_OIL) rhoP = prhoOil;
            else                   rhoP = prhoWater;

            // v_t > 0 se partícula menos densa que a contínua (sobe)
            // v_t < 0 se partícula mais densa (desce)
            // Se mesma fase: ~0 (neutro)
            const dRho = rhoC - rhoP;
            if (Math.abs(dRho) < 1) return 0;
            const sign = Math.sign(dRho);
            return sign * Math.abs(this._modelTerminal(d, Math.min(rhoP, rhoC), Math.max(rhoP, rhoC), muC));
        };

        const dummy = new THREE.Object3D();
        const tempColor = new THREE.Color();
        const inletX = -halfL + 0.08;

        // Helper: aplica matrices em ambos os meshes, com escala 0 no que não é dono
        const writeMatrices = (i) => {
            dummy.position.set(px[i], py[i], pz[i]);
            const isGas = types[i] === TYPE_GAS;
            dummy.scale.setScalar(isGas ? ZERO_SCALE : size[i]);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
            dummy.scale.setScalar(isGas ? size[i] : ZERO_SCALE);
            dummy.updateMatrix();
            gasInst.setMatrixAt(i, dummy.matrix);
        };

        // Inicializa todas as partículas: estado inicial = distribuídas pelo vaso
        for (let i = 0; i < TOTAL; i++) {
            types[i] = sampleType();
            diam[i] = dBase(types[i]);
            size[i] = sizeVis(types[i], diam[i]);
            phase[i] = Math.random() * Math.PI * 2;
            px[i] = (Math.random() * 2 - 1) * halfL * 0.90;
            const samp = sampleInCircle(-R + 0.05, R - 0.05);
            py[i] = samp.y;
            pz[i] = samp.z;
            settled[i] = 0;

            writeMatrices(i);
            // Cor por instância só para OIL/WATER (gás usa cor única do material emissivo)
            tempColor.copy(colorByType[types[i]]);
            inst.setColorAt(i, tempColor);
        }
        inst.instanceMatrix.needsUpdate = true;
        gasInst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

        // Função de respawn no inlet (partícula completa o ciclo)
        const respawnAtInlet = (i) => {
            types[i] = sampleType();
            diam[i] = dBase(types[i]);
            size[i] = sizeVis(types[i], diam[i]);
            px[i] = inletX + Math.random() * 0.15;
            py[i] = (Math.random() - 0.5) * (R * 0.6);     // injecção caótica
            pz[i] = (Math.random() - 0.5) * (R * 0.6);
            phase[i] = Math.random() * Math.PI * 2;
            settled[i] = 0;
            tempColor.copy(colorByType[types[i]]);
            inst.setColorAt(i, tempColor);
        };

        this.particles.push({
            mesh: inst, geo: null, mat: sphereMat, count: TOTAL,
            tick: (dt) => {
                let colorChanged = false;
                for (let i = 0; i < TOTAL; i++) {
                    const t = types[i];
                    phase[i] += dt * 1.5;

                    // Transporte axial (plug flow). No espaço gasoso e perto do inlet,
                    // o movimento axial é dominante. Em partículas settled, mais lento.
                    const inGasSpace = py[i] > yOilLvl;
                    const axialMul = settled[i] ? 0.35 : (inGasSpace ? 1.4 : 1.0);
                    px[i] += vAxVis * axialMul * dt;

                    // Gravidade/buoyancy
                    const vt = terminalV(t, diam[i], py[i]);
                    py[i] += vt * VSCALE * dt;

                    // Dispersão lateral turbulenta (decai à medida que se separa)
                    const turb = settled[i] ? 0.0 : 0.04;
                    pz[i] += (Math.sin(phase[i] * 1.7) * turb + (Math.random() - 0.5) * turb) * dt * 4;

                    // Contenção no cilindro
                    const r2 = py[i]*py[i] + pz[i]*pz[i];
                    if (r2 > R*R * 0.93) {
                        const s = (R * 0.93) / Math.sqrt(r2);
                        py[i] *= s; pz[i] *= s;
                    }

                    // Determinação da câmara actual (relevante para "settled")
                    const inRightChamber = isHorizontal && px[i] > weirX + 0.03;

                    // Clampar nas interfaces — regras por tipo e câmara
                    if (t === TYPE_WATER && py[i] < yWaterLvl - 0.03 && !inRightChamber) settled[i] = 1;
                    if (t === TYPE_OIL) {
                        if (inRightChamber && py[i] < yOilLvl - 0.02) settled[i] = 1;      // bucket cheio até ao topo
                        else if (!inRightChamber && py[i] > yWaterLvl + 0.03 && py[i] < yOilLvl - 0.02) settled[i] = 1;
                    }
                    if (t === TYPE_GAS && py[i] > yOilLvl + 0.03) settled[i] = 1;

                    // WEIR PLATE — barreira física real:
                    //   • Água: bloqueada (não passa). Se tenta atravessar, é empurrada de volta.
                    //   • Óleo: só passa POR CIMA (acima de weirTopY).
                    //   • Gás: passa livre acima do weir (weirTopY está bem abaixo do topo).
                    if (isHorizontal && px[i] > weirX - 0.04 && px[i] < weirX + 0.04) {
                        if (t === TYPE_WATER) {
                            // Água SEMPRE bloqueada (acima ou abaixo de weirTopY, não passa)
                            px[i] = weirX - 0.06;
                        } else if (t === TYPE_OIL && py[i] < weirTopY) {
                            // Óleo abaixo do topo do weir — tem de subir (ou bate na placa)
                            if (py[i] < weirTopY - 0.1) {
                                px[i] = weirX - 0.06;  // ainda longe do topo: recua
                            } else {
                                py[i] = weirTopY + 0.03; // perto do topo: galga
                            }
                        }
                    }

                    // Saídas pelos bocais correctos (ciclo contínuo)
                    let exited = false;
                    if (t === TYPE_GAS) {
                        // Topo direito do vaso, perto do gas outlet
                        if (py[i] > R - 0.05 && Math.abs(px[i] - gasOutXp) < R * 0.5) exited = true;
                        else if (px[i] > halfL * 0.95) exited = true;
                    } else if (t === TYPE_OIL) {
                        // Fundo-centro da câmara direita (bucket)
                        if (Math.abs(px[i] - oilOutXp) < R * 0.4 && py[i] < -R + 0.3) exited = true;
                        else if (px[i] > halfL * 0.98) exited = true;
                    } else { // WATER
                        // Fundo-centro da câmara esquerda
                        if (Math.abs(px[i] - waterOutXp) < R * 0.4 && py[i] < -R + 0.3) exited = true;
                    }

                    // Partículas que chegam a extremos axiais também reciclam (segurança)
                    if (px[i] > halfL * 1.02 || px[i] < -halfL * 1.1) exited = true;

                    if (exited) {
                        respawnAtInlet(i);
                        colorChanged = true;
                    }

                    writeMatrices(i);
                }
                inst.instanceMatrix.needsUpdate = true;
                gasInst.instanceMatrix.needsUpdate = true;
                if (colorChanged && inst.instanceColor) inst.instanceColor.needsUpdate = true;
            },
            dispose: () => {
                sphereMat.dispose();
                gasBubbleMat.dispose();
                group.remove(inst);
                group.remove(gasInst);
                inst.dispose && inst.dispose();
                gasInst.dispose && gasInst.dispose();
            }
        });

        // Ajustar câmara automaticamente para enquadrar
        const bbox = new THREE.Box3().setFromObject(group);
        const sphere = bbox.getBoundingSphere(new THREE.Sphere());
        const dist = sphere.radius / Math.sin((this.camera.fov / 2) * Math.PI / 180) * 1.1;
        // Não reposicionar se o utilizador já orbitou — só ajusta o target
        this.controls.target.copy(sphere.center);
        this.controls.minDistance = Math.max(2, sphere.radius * 0.8);
        this.controls.maxDistance = sphere.radius * 6;
        if (!this._cameraFramed) {
            const dir = new THREE.Vector3(1, 0.55, 1).normalize();
            this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
            this.camera.lookAt(sphere.center);
            this._cameraFramed = true;
        }

        this.scene.add(group);
    }

    // ------------------------------------------------------------------
    // Views pré-definidas (botões da HUD)
    // ------------------------------------------------------------------
    setView(view) {
        if (!this.camera || !this.controls || !this.vesselGroup) return;
        const bbox = new THREE.Box3().setFromObject(this.vesselGroup);
        const sphere = bbox.getBoundingSphere(new THREE.Sphere());
        const dist = sphere.radius / Math.sin((this.camera.fov / 2) * Math.PI / 180) * 1.1;
        const dirs = {
            iso:   new THREE.Vector3( 1, 0.55, 1).normalize(),
            front: new THREE.Vector3( 0, 0,   1),
            side:  new THREE.Vector3( 1, 0,   0),
            top:   new THREE.Vector3( 0.001, 1, 0.001).normalize()
        };
        const dir = dirs[view] || dirs.iso;
        this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
        this.controls.target.copy(sphere.center);
        this.controls.update();
    }

    // Exporta PNG do viewport
    snapshot() {
        if (!this.renderer) return null;
        return this.renderer.domElement.toDataURL('image/png');
    }

    // ------------------------------------------------------------------
    // Limpeza — chamar se trocar de tab e quiser libertar recursos
    // ------------------------------------------------------------------
    _disposeGroup(group) {
        group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
            if (obj.material?.map) obj.material.map.dispose();
        });
    }
    dispose() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        if (this.resizeObserver && this.container) this.resizeObserver.unobserve(this.container);
        if (this.controls) this.controls.dispose();
        if (this.vesselGroup) this._disposeGroup(this.vesselGroup);
        if (this.renderer) {
            this.renderer.dispose();
            if (this.container && this.renderer.domElement.parentNode === this.container) {
                this.container.removeChild(this.renderer.domElement);
            }
        }
        this.scene = this.camera = this.renderer = this.controls = this.vesselGroup = null;
        this.animationId = null;
    }
}

// Expõe singleton global
const vpo3d = new Separator3D();
window.VPO3D = vpo3d;
// Sinal visível no console para diagnóstico
try {
    console.log('%c[VPO3D] script regular carregado · Three.js', 'color:#06b6d4;font-weight:600',
                THREE.REVISION ? `r${THREE.REVISION}` : '');
} catch (_) { /* no-op */ }

})(); // fim do IIFE — isola THREE/OrbitControls do escopo global
