// ============================================================================
// VPO — Vemba Process Optimizer · JavaScript engine
// ============================================================================

// ----------------------------------------------------------------------------
// TEMA GLOBAL DE GRÁFICOS (Plotly dark industrial)
// Aplica paleta, grid sutil e fundos transparentes em TODOS os gráficos
// sem precisar editar cada call site.
// ----------------------------------------------------------------------------
const VPO_PLOT = {
    palette: ['#06b6d4', '#a78bfa', '#f59e0b', '#10b981', '#f472b6', '#60a5fa', '#fb923c', '#2dd4bf'],
    font:    { family: "Inter, -apple-system, Segoe UI, sans-serif", size: 12, color: '#cbd5e1' },
    titleFn: 'Inter, -apple-system, Segoe UI, sans-serif',
    axis: {
        gridcolor: 'rgba(148,163,184,0.12)',
        zerolinecolor: 'rgba(148,163,184,0.25)',
        linecolor: 'rgba(148,163,184,0.25)',
        tickcolor: 'rgba(148,163,184,0.4)',
        tickfont: { color: '#94a3b8', size: 11 },
        titlefont: { color: '#cbd5e1', size: 12 }
    },
    paper: 'rgba(0,0,0,0)',
    plot:  'rgba(0,0,0,0)'
};

function vpoApplyTheme(layout = {}) {
    const L = { ...layout };
    L.paper_bgcolor = L.paper_bgcolor ?? VPO_PLOT.paper;
    L.plot_bgcolor  = L.plot_bgcolor  ?? VPO_PLOT.plot;
    L.font = { ...VPO_PLOT.font, ...(L.font || {}) };
    L.colorway = L.colorway || VPO_PLOT.palette;
    L.margin = L.margin || { t: 48, r: 24, b: 48, l: 56 };
    if (typeof L.title === 'string') {
        L.title = { text: L.title, font: { family: VPO_PLOT.titleFn, size: 14, color: '#f1f5f9' }, x: 0.02, xanchor: 'left' };
    } else if (L.title && typeof L.title === 'object') {
        L.title = { x: 0.02, xanchor: 'left', ...L.title, font: { family: VPO_PLOT.titleFn, size: 14, color: '#f1f5f9', ...(L.title.font || {}) } };
    }
    // merge para eixos
    ['xaxis','yaxis','xaxis2','yaxis2','xaxis3','yaxis3'].forEach(k => {
        if (L[k] !== undefined) L[k] = { ...VPO_PLOT.axis, ...L[k] };
    });
    // Radar (polar)
    if (L.polar) {
        L.polar = {
            bgcolor: 'rgba(0,0,0,0)',
            radialaxis: { gridcolor: 'rgba(148,163,184,0.15)', tickfont: { color: '#94a3b8', size: 10 }, linecolor: 'rgba(148,163,184,0.3)' },
            angularaxis: { gridcolor: 'rgba(148,163,184,0.15)', tickfont: { color: '#cbd5e1', size: 11 }, linecolor: 'rgba(148,163,184,0.3)' },
            ...L.polar
        };
    }
    // Legenda
    L.legend = { orientation: 'h', y: -0.18, x: 0, bgcolor: 'rgba(0,0,0,0)', font: { color: '#cbd5e1', size: 11 }, ...(L.legend || {}) };
    // Hover
    L.hoverlabel = { bgcolor: '#111a2c', bordercolor: '#2a3756', font: { color: '#f1f5f9', family: VPO_PLOT.font.family, size: 12 }, ...(L.hoverlabel || {}) };
    return L;
}

// Monkey-patch Plotly: todos os gráficos herdam o tema VPO automaticamente.
if (typeof Plotly !== 'undefined' && !Plotly.__vpoPatched) {
    const _newPlot = Plotly.newPlot.bind(Plotly);
    const _react   = Plotly.react  ? Plotly.react.bind(Plotly)  : null;
    Plotly.newPlot = (gd, data, layout, config) =>
        _newPlot(gd, data, vpoApplyTheme(layout || {}), { responsive: true, displaylogo: false, ...(config || {}) });
    if (_react) Plotly.react = (gd, data, layout, config) =>
        _react(gd, data, vpoApplyTheme(layout || {}), { responsive: true, displaylogo: false, ...(config || {}) });
    Plotly.__vpoPatched = true;
}

// ============================================================================
// SeparatorModel — física do separador tri-fásico
// Referências:
//  · Morsi & Alexander (1972) J. Fluid Mech. 55, 193  — Cd piecewise
//  · Clift, Grace & Weber (1978) "Bubbles, Drops, and Particles"
//  · GPSA Engineering Data Book (SI) §7 — K-factor tabulado
//  · Fabian et al. (1993) Hydrocarbon Processing — correção wire mesh
//  · Hinze (1955) AIChE J. 1, 289 — critério Weber crítico (We_c ≈ 12)
//  · Redlich & Kwong (1949) Chem. Rev. 44, 233 — EoS cúbica para Z-factor
//  · Beggs & Robinson (1975) JPT — viscosidade por temperatura
// ============================================================================
class SeparatorModel {
    constructor() {
        this.g = 9.81;      // aceleração da gravidade (m/s²)
        this.pi = Math.PI;
        this.R = 8.314;     // J/(mol·K)
    }

    // ------------------------------------------------------------------
    // 1. ARRASTE — Cd de Morsi-Alexander piecewise (válido 0 < Re < 5·10⁴)
    // ------------------------------------------------------------------
    cdMorsiAlexander(Re) {
        if (!Number.isFinite(Re) || Re <= 0) return 24;            // trata degenerado como Stokes alto
        if (Re < 0.1)    return 24 / Re;                           // Stokes puro
        if (Re < 1)      return 22.73/Re + 0.0903/(Re*Re) + 3.69;
        if (Re < 10)     return 29.1667/Re - 3.8889/(Re*Re) + 1.222;
        if (Re < 100)    return 46.5/Re - 116.67/(Re*Re) + 0.6167;
        if (Re < 1000)   return 98.33/Re - 2778/(Re*Re) + 0.3644;
        if (Re < 5000)   return 148.62/Re - 47500/(Re*Re) + 0.357;
        if (Re < 10000)  return -490.546/Re + 578700/(Re*Re) + 0.46;
        return 0.44;                                               // regime de Newton
    }

    // Velocidade terminal real, iterativa, válida em qualquer regime.
    // μ em Pa·s · d em m · ρ em kg/m³ → retorna v em m/s
    terminalVelocity(d, rho_p, rho_f, mu, { maxIter = 50, tol = 1e-6 } = {}) {
        const dRho = rho_p - rho_f;
        if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(mu) || mu <= 0 || dRho === 0) return 0;
        // Chute inicial por Stokes
        let v = (this.g * d*d * dRho) / (18 * mu);
        for (let i = 0; i < maxIter; i++) {
            const Re = Math.abs(rho_f * v * d / mu);
            if (Re < 1e-8) break;
            const Cd = this.cdMorsiAlexander(Re);
            const vNew = Math.sign(dRho) * Math.sqrt(Math.abs(4 * this.g * d * dRho / (3 * rho_f * Cd)));
            if (Math.abs(vNew - v) < tol) { v = vNew; break; }
            v = vNew;
        }
        return v;
    }

    // Regime diagnóstico (para UI): "stokes" | "intermediate" | "newton"
    particleRegime(d, rho_p, rho_f, mu) {
        const v = this.terminalVelocity(d, rho_p, rho_f, mu);
        const Re = Math.abs(rho_f * v * d / mu);
        if (Re < 1) return 'stokes';
        if (Re < 1000) return 'intermediate';
        return 'newton';
    }

    // Wrapper legado (Lei de Stokes pura — só usar para Re<1).
    // Mantido para backwards-compat; recomendado: terminalVelocity().
    stokesVelocity(radius, rho_p, rho_f, mu) {
        return (2 * this.g * Math.pow(radius, 2) * (rho_p - rho_f)) / (9 * mu);
    }

    // ------------------------------------------------------------------
    // 2. SOUDERS-BROWN — K tabelado (GPSA) + correção de demister
    // ------------------------------------------------------------------
    // K em m/s a aplicar em v_g = K·√((ρl−ρg)/ρg). Base: wire-mesh horizontal.
    // Curva GPSA (adaptada): K cai de 0.107 @ atm até ≈0.055 @ 60 bar.
    soudersBrownK(pressure_bar, demisterType = 'mesh') {
        const P_kPa = Math.max(0, pressure_bar) * 100;
        let K;
        if (P_kPa < 700)        K = 0.107;
        else if (P_kPa < 2000)  K = 0.107 - 1.5e-5 * (P_kPa - 700);
        else if (P_kPa < 6000)  K = 0.088 - 1.0e-5 * (P_kPa - 2000);
        else                    K = 0.055;

        // Multiplicadores por tipo de demister (Fabian 1993, Stewart-Arnold)
        const mult = {
            mesh:    1.00,    // wire mesh padrão (baseline FEED)
            vane:    2.00,    // vane pack — maior capacidade
            cyclone: 2.50,    // separador ciclónico
            none:    0.50     // vaso sem demister — conservador
        }[demisterType] ?? 1.0;
        return K * mult;
    }

    // vg = K·√((ρl−ρg)/ρg) — assinatura legada compatível
    soudersBrownVelocity(rho_l, rho_g, K) {
        // Se K não vier explicitamente, usa curva GPSA @ 10 bar (compat).
        const Keff = (K === undefined) ? this.soudersBrownK(10, 'mesh') : K;
        if (!(rho_g > 0) || !(rho_l > rho_g)) return 0;
        return Keff * Math.sqrt((rho_l - rho_g) / rho_g);
    }

    // ------------------------------------------------------------------
    // 3. REDLICH-KWONG EoS — Z e densidade reais do gás
    // ------------------------------------------------------------------
    // Resolve a forma cúbica adimensional: Z³ − Z² + Z(A−B−B²) − AB = 0
    // Default Tc/Pc: gás natural ~85% CH4 (Tc≈190K, Pc≈46 bar).
    zFactorRK(P_bar, T_K, { Tc = 190.6, Pc_bar = 46.0 } = {}) {
        if (!(P_bar > 0) || !(T_K > 0)) return 1.0;
        const Tr = T_K / Tc;
        // a, b na forma reduzida adimensional (A, B):
        // A = 0.42748·P_r/T_r^2.5   B = 0.08664·P_r/T_r
        const Pr = P_bar / Pc_bar;
        const A = 0.42748 * Pr / Math.pow(Tr, 2.5);
        const B = 0.08664 * Pr / Tr;
        // Newton no ramo gasoso (Z≈1)
        let Z = 1.0;
        for (let i = 0; i < 40; i++) {
            const f  = Z*Z*Z - Z*Z + Z*(A - B - B*B) - A*B;
            const df = 3*Z*Z - 2*Z + (A - B - B*B);
            if (Math.abs(df) < 1e-14) break;
            const Zn = Z - f/df;
            if (!Number.isFinite(Zn)) break;
            if (Math.abs(Zn - Z) < 1e-8) { Z = Zn; break; }
            Z = Math.max(0.05, Zn);
        }
        // clamps físicos sãos
        return Math.max(0.10, Math.min(1.20, Z));
    }

    // ρ_gás [kg/m³] por RK: ρ = P·Mw / (Z·R·T)
    gasDensityRK(P_bar, T_K, Mw_g_per_mol = 18.0) {
        const Z = this.zFactorRK(P_bar, T_K);
        const P_Pa = P_bar * 1e5;
        const rho = P_Pa * (Mw_g_per_mol / 1000.0) / (Z * this.R * T_K);
        return Number.isFinite(rho) && rho > 0 ? rho : 1.0;
    }

    // ------------------------------------------------------------------
    // 4. WEBER CRÍTICO — diâmetro máximo estável de gota
    // We = ρ_c·v²·d/σ > We_c ⇒ gota fragmenta
    // ------------------------------------------------------------------
    maxStableDroplet(velocity, rho_c, { sigma = 0.025, We_c = 12 } = {}) {
        if (!(velocity > 0) || !(rho_c > 0)) return Infinity;
        return (sigma * We_c) / (rho_c * velocity * velocity);
    }

    // ------------------------------------------------------------------
    // 5. EFICIÊNCIA G-L — Souders-Brown GPSA + tempo de residência
    // ------------------------------------------------------------------
    separationEfficiencyGL(flowRate, pressure, temperature, gor) {
        // guards de validade
        if (!(flowRate > 0) || !(pressure > 0) || !Number.isFinite(temperature)) return 0;

        const T_K = temperature + 273.15;
        // ρ_gás real via Redlich-Kwong (substitui Z=0.85 fixo)
        const rhoGasOp = this.gasDensityRK(pressure, T_K);
        const rhoLiq = 870.0;

        // Souders-Brown com K tabelado GPSA (wire mesh)
        const vCritical = this.soudersBrownVelocity(rhoLiq, rhoGasOp, this.soudersBrownK(pressure, 'mesh'));

        // Velocidade superficial do gás no vaso (área ~1.13 m²)
        const areaSep = 1.13;
        const gasFlowRate = flowRate * (gor / 1000.0) / 86400.0;
        const vGas = gasFlowRate / areaSep;

        // Razão v_g/v_crítica (should < 1 para boa separação)
        const velocityRatio = vCritical > 0 ? vGas / vCritical : 1.0;
        const effVelocity = 1.0 / (1.0 + Math.exp(8.0 * (velocityRatio - 0.7)));

        // Tempo de residência (volume ~15 m³)
        const volumeSep = 15.0;
        const residenceTime = volumeSep / (flowRate / 86400.0);
        const effResidence = 1.0 - Math.exp(-(residenceTime / 60.0) / 3.0);

        // Fator temperatura (Beggs-Robinson suave)
        const effTemp = 1.0 + 0.005 * (temperature - 50.0) / 10.0;

        const efficiency = 0.99 * effVelocity * effResidence * Math.min(effTemp, 1.02);
        return Math.max(0.70, Math.min(0.995, efficiency));
    }

    // ------------------------------------------------------------------
    // 6. EFICIÊNCIA O-A — velocidade terminal real + Weber critico
    // ------------------------------------------------------------------
    separationEfficiencyOA(flowRate, temperature, waterCut, viscosity) {
        if (!(flowRate > 0) || !(viscosity > 0) || !Number.isFinite(temperature)) return 0;

        // Beggs-Robinson: μ(T) em cP → Pa·s
        const TRef = 60.0;
        const BVisc = 2500.0;
        const muEff_cP = viscosity * Math.exp(BVisc * (1.0/(temperature+273.15) - 1.0/(TRef+273.15)));
        const muEff_Pa_s = muEff_cP * 1e-3;

        const rhoWater = 1020.0;
        const rhoOil = 870.0;

        // Diâmetro-alvo de gota d50 (nominal), mas limitado pelo Weber crítico
        // calculado com a velocidade superficial da fase contínua no vaso.
        const areaOA = 1.13;
        const vSup = (flowRate / 86400.0) / areaOA; // m/s
        const dMax = this.maxStableDroplet(vSup, rhoOil, { sigma: 0.025, We_c: 12 });
        const dDrop = Math.min(500e-6, dMax); // se o escoamento quebra gotas, d cai

        // Velocidade terminal REAL (Morsi-Alexander, não só Stokes)
        const vTerm = this.terminalVelocity(dDrop, rhoWater, rhoOil, muEff_Pa_s);

        // Tempo de residência na secção O-A (50% do volume)
        const volumeOA = 7.5;
        const tResidence = volumeOA / (flowRate / 86400.0);

        // Distância efectiva de sedimentação (coalescedor de placas)
        const hEmulsion = 0.15;
        const tSettling = vTerm > 0 ? hEmulsion / vTerm : 1e6;
        const settlingRatio = tResidence / tSettling;
        const effSettling = 1.0 - Math.exp(-0.8 * settlingRatio);

        // Penalidade de emulsão (faixa crítica 30-60% BSW)
        const wcFrac = waterCut / 100.0;
        const emulsionPenalty = 1.0 - 0.06 * Math.exp(-Math.pow((wcFrac - 0.45) / 0.15, 2));

        const efficiency = 0.96 * effSettling * emulsionPenalty;
        return Math.max(0.60, Math.min(0.96, efficiency));
    }

    // Consumo energético (MWh/1000m³)
    // 4 componentes reais: bombeamento + aquecimento + compressão + auxiliares
    // Ref: SPE-187412
    energyConsumption(flowRate, pressure, temperature) {
        const deltaPBar = 3.0;
        const etaBomba = 0.70;
        const qM3s = flowRate / 86400.0;
        const rhoFluid = 900.0;

        // 1. Bombeamento
        const pBomba = (qM3s * deltaPBar * 1e5) / (etaBomba * 1e6);
        const eBomba = flowRate > 0 ? pBomba * 24.0 / (flowRate / 1000.0) : 0;

        // 2. Aquecimento (delta T max 12°C, recuperação de calor 50%)
        const cpFluid = 2100.0;
        const tInlet = Math.max(40.0, temperature - 12.0);
        const deltaT = Math.max(0, temperature - tInlet);
        const massFlow = rhoFluid * qM3s;
        const heatRecovery = 0.5;
        const pAquec = (massFlow * cpFluid * deltaT * (1.0 - heatRecovery)) / (0.85 * 1e6);
        const eAquec = flowRate > 0 ? pAquec * 24.0 / (flowRate / 1000.0) : 0;

        // 3. Compressão de gás (isentrópica, k=1.3, eta=75%)
        const pExport = 25.0;
        const ratioComp = pressure > 0 ? pExport / pressure : 2.0;
        const kGas = 1.3;
        let eComp = 0;
        if (ratioComp > 1) {
            const compWorkFactor = (kGas / (kGas - 1)) * (Math.pow(ratioComp, (kGas - 1) / kGas) - 1) / 0.75;
            eComp = 0.15 * compWorkFactor;
        }

        // 4. Auxiliares (instrumentação, iluminação)
        const eAux = 0.08;

        return Math.max(0.5, eBomba + eAquec + eComp + eAux);
    }

    // Número de Reynolds: Re = ρvD/μ
    reynoldsNumber(velocity, diameter, density, viscosity) {
        return (density * velocity * diameter) / viscosity;
    }

    // Número de Weber: We = ρv²L/σ
    weberNumber(velocity, length, density, surfaceTension) {
        return (density * Math.pow(velocity, 2) * length) / surfaceTension;
    }

    // Número de Bond: Bo = Δρ·g·L²/σ
    bondNumber(densityDiff, length, surfaceTension) {
        return (densityDiff * this.g * Math.pow(length, 2)) / surfaceTension;
    }

    // Número Capilar: Ca = μv/σ
    capillaryNumber(velocity, viscosity, surfaceTension) {
        return (viscosity * velocity) / surfaceTension;
    }
}

// Classe para algoritmos de otimização
class OptimizationAlgorithms {
    constructor() {
        this.separatorModel = new SeparatorModel();
    }

    // NSGA-II completo - Deb et al. (2002)
    // SBX crossover + mutação polinomial + crowding distance
    nsgaIIOptimization(bounds, popSize = 50, generations = 100, mutationRate = 0.1, crossoverRate = 0.9) {
        let population = this.generateRandomPopulation(popSize, bounds);
        const bestSolutions = [];

        for (let gen = 0; gen < generations; gen++) {
            let objectives = population.map(ind => this.evaluateObjectives(ind));

            // Gerar filhos via SBX + mutação polinomial
            const offspring = this.createOffspring(population, objectives, bounds, crossoverRate, mutationRate);
            const offspringObj = offspring.map(ind => this.evaluateObjectives(ind));

            // Combinar pais + filhos
            const combinedPop = [...population, ...offspring];
            const combinedObj = [...objectives, ...offspringObj];

            // Classificação não-dominada com crowding distance
            const fronts = this.fastNonDominatedSortFull(combinedObj);

            // Selecionar próxima geração
            const newIndices = [];
            for (const front of fronts) {
                if (newIndices.length + front.length <= popSize) {
                    newIndices.push(...front);
                } else {
                    const remaining = popSize - newIndices.length;
                    const distances = this.crowdingDistance(combinedObj, front);
                    const sorted = front.map((idx, i) => ({ idx, dist: distances[i] }))
                        .sort((a, b) => b.dist - a.dist);
                    for (let k = 0; k < remaining; k++) newIndices.push(sorted[k].idx);
                    break;
                }
            }

            population = newIndices.map(i => [...combinedPop[i]]);
            objectives = newIndices.map(i => [...combinedObj[i]]);

            const bestIdx = objectives.reduce((bi, o, i) => o[0] < objectives[bi][0] ? i : bi, 0);
            bestSolutions.push({
                generation: gen,
                solution: [...population[bestIdx]],
                objectives: [...objectives[bestIdx]]
            });
        }

        return bestSolutions;
    }

    generateRandomPopulation(size, bounds) {
        return Array.from({ length: size }, () =>
            bounds.map(b => Math.random() * (b[1] - b[0]) + b[0])
        );
    }

    evaluateObjectives(solution) {
        try {
            let [flowRate, pressure, temperature, waterCut] = solution;
            flowRate = Math.max(150, Math.min(2400, flowRate));
            pressure = Math.max(8.5, Math.min(15.2, pressure));
            temperature = Math.max(45, Math.min(85, temperature));
            waterCut = Math.max(15, Math.min(78, waterCut));

            const effGL = this.separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, 100);
            const effOA = this.separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, 15);
            const efficiencyObj = -(effGL + effOA) / 2;
            const energyObj = this.separatorModel.energyConsumption(flowRate, pressure, temperature);
            const emissionsObj = energyObj * 0.5 + 0.1 * pressure;
            return [efficiencyObj, energyObj, emissionsObj];
        } catch (e) {
            return [0.0, 10.0, 10.0];
        }
    }

    fastNonDominatedSortFull(objectives) {
        const n = objectives.length;
        const dominatedCount = new Array(n).fill(0);
        const dominatedSolutions = Array.from({ length: n }, () => []);
        const fronts = [[]];

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (this.dominates(objectives[i], objectives[j])) {
                    dominatedSolutions[i].push(j);
                    dominatedCount[j]++;
                } else if (this.dominates(objectives[j], objectives[i])) {
                    dominatedSolutions[j].push(i);
                    dominatedCount[i]++;
                }
            }
            if (dominatedCount[i] === 0) fronts[0].push(i);
        }

        if (fronts[0].length === 0) { fronts[0] = Array.from({ length: n }, (_, i) => i); return fronts; }

        let currentFront = 0;
        while (fronts[currentFront] && fronts[currentFront].length > 0) {
            const nextFront = [];
            for (const i of fronts[currentFront]) {
                for (const j of dominatedSolutions[i]) {
                    dominatedCount[j]--;
                    if (dominatedCount[j] === 0) nextFront.push(j);
                }
            }
            currentFront++;
            if (nextFront.length > 0) fronts.push(nextFront);
            else break;
        }
        return fronts;
    }

    dominates(obj1, obj2) {
        let allLeq = true, anyLess = false;
        for (let i = 0; i < obj1.length; i++) {
            if (obj1[i] > obj2[i]) { allLeq = false; break; }
            if (obj1[i] < obj2[i]) anyLess = true;
        }
        return allLeq && anyLess;
    }

    crowdingDistance(objectives, frontIndices) {
        const n = frontIndices.length;
        if (n <= 2) return new Array(n).fill(Infinity);
        const nObj = objectives[0].length;
        const distances = new Array(n).fill(0);

        for (let m = 0; m < nObj; m++) {
            const sorted = frontIndices.map((idx, i) => ({ i, val: objectives[idx][m] }))
                .sort((a, b) => a.val - b.val);
            const range = sorted[n - 1].val - sorted[0].val;
            distances[sorted[0].i] = Infinity;
            distances[sorted[n - 1].i] = Infinity;
            if (range > 0) {
                for (let k = 1; k < n - 1; k++) {
                    distances[sorted[k].i] += (sorted[k + 1].val - sorted[k - 1].val) / range;
                }
            }
        }
        return distances;
    }

    tournamentSelection(objectives, rank, crowdingDist) {
        const n = objectives.length;
        const i = Math.floor(Math.random() * n);
        const j = Math.floor(Math.random() * n);
        if (rank[i] < rank[j]) return i;
        if (rank[i] > rank[j]) return j;
        return crowdingDist[i] > crowdingDist[j] ? i : j;
    }

    sbxCrossover(p1, p2, bounds, etaC = 20) {
        const c1 = [...p1], c2 = [...p2];
        for (let i = 0; i < p1.length; i++) {
            if (Math.random() < 0.5 && Math.abs(p1[i] - p2[i]) > 1e-14) {
                const [x1, x2] = p1[i] < p2[i] ? [p1[i], p2[i]] : [p2[i], p1[i]];
                const rand = Math.random();
                const beta = 1.0 + (2.0 * (x1 - bounds[i][0]) / (x2 - x1));
                const alpha = 2.0 - Math.pow(beta, -(etaC + 1));
                const betaq = rand <= 1.0 / alpha
                    ? Math.pow(rand * alpha, 1.0 / (etaC + 1))
                    : Math.pow(1.0 / (2.0 - rand * alpha), 1.0 / (etaC + 1));
                c1[i] = Math.max(bounds[i][0], Math.min(bounds[i][1], 0.5 * ((x1 + x2) - betaq * (x2 - x1))));
                c2[i] = Math.max(bounds[i][0], Math.min(bounds[i][1], 0.5 * ((x1 + x2) + betaq * (x2 - x1))));
            }
        }
        return [c1, c2];
    }

    polynomialMutation(individual, bounds, mutationRate, etaM = 20) {
        const mutant = [...individual];
        for (let i = 0; i < individual.length; i++) {
            if (Math.random() < mutationRate) {
                const deltaMax = bounds[i][1] - bounds[i][0];
                if (deltaMax <= 0) continue;
                const rand = Math.random();
                const deltaq = rand < 0.5
                    ? Math.pow(2.0 * rand, 1.0 / (etaM + 1)) - 1.0
                    : 1.0 - Math.pow(2.0 * (1.0 - rand), 1.0 / (etaM + 1));
                mutant[i] = Math.max(bounds[i][0], Math.min(bounds[i][1], individual[i] + deltaq * deltaMax));
            }
        }
        return mutant;
    }

    createOffspring(population, objectives, bounds, crossoverRate, mutationRate) {
        const popSize = population.length;
        const fronts = this.fastNonDominatedSortFull(objectives);
        const rank = new Array(popSize).fill(0);
        for (let fi = 0; fi < fronts.length; fi++) {
            for (const idx of fronts[fi]) { if (idx < popSize) rank[idx] = fi; }
        }
        const allDist = new Array(popSize).fill(0);
        for (const front of fronts) {
            const valid = front.filter(i => i < popSize);
            if (valid.length > 0) {
                const dists = this.crowdingDistance(objectives, valid);
                valid.forEach((idx, i) => { allDist[idx] = dists[i]; });
            }
        }

        const offspring = [];
        for (let i = 0; i < popSize; i += 2) {
            const p1 = this.tournamentSelection(objectives, rank, allDist);
            const p2 = this.tournamentSelection(objectives, rank, allDist);
            let [c1, c2] = Math.random() < crossoverRate
                ? this.sbxCrossover(population[p1], population[p2], bounds)
                : [[...population[p1]], [...population[p2]]];
            c1 = this.polynomialMutation(c1, bounds, mutationRate);
            c2 = this.polynomialMutation(c2, bounds, mutationRate);
            offspring.push(c1);
            if (i + 1 < popSize) offspring.push(c2);
        }
        return offspring;
    }

    randomNormal(mean, stdDev) {
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return z0 * stdDev + mean;
    }
}

// Classe para Rede Neural com TensorFlow.js
class NeuralNetworkPredictor {
    constructor() {
        this.model = null;
        this.isTrained = false;
        this.separatorModel = new SeparatorModel();
        this.trainingHistory = null;
        this.scaler = { mean: null, std: null };
    }

    // Gerar dados de treinamento com ruído de medição realista
    // NOTA: dados sintéticos - para uso real, substituir por dados SCADA/PIMS
    generateTrainingData(nSamples = 2000) {
        const data = { inputs: [], outputs: [] };
        const optAlg = new OptimizationAlgorithms();

        for (let i = 0; i < nSamples; i++) {
            const flowRate = 150 + Math.random() * (2400 - 150);
            const pressure = 8.5 + Math.random() * (15.2 - 8.5);
            const temperature = 45 + Math.random() * (85 - 45);
            const waterCut = 15 + Math.random() * (78 - 15);
            const gor = 45 + Math.random() * (180 - 45);
            const viscosity = 10 + Math.random() * (30 - 10);

            let effGL = this.separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor);
            let effOA = this.separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity);
            let energy = this.separatorModel.energyConsumption(flowRate, pressure, temperature);

            // Adicionar ruído de medição (simula incertezas instrumentais)
            effGL = Math.max(0.60, Math.min(0.995, effGL + optAlg.randomNormal(0, 0.02 * effGL)));
            effOA = Math.max(0.50, Math.min(0.96, effOA + optAlg.randomNormal(0, 0.02 * effOA)));
            energy = Math.max(0.3, energy + optAlg.randomNormal(0, 0.05 * energy));

            data.inputs.push([flowRate, pressure, temperature, waterCut, gor, viscosity]);
            data.outputs.push([effGL, effOA, energy]);
        }

        return data;
    }

    // Normalizar dados
    normalize(data) {
        const tensor = tf.tensor2d(data);
        const mean = tensor.mean(0);
        const std = tf.moments(tensor, 0).variance.sqrt();

        const normalized = tensor.sub(mean).div(std.add(1e-7));

        return {
            normalized: normalized,
            mean: mean,
            std: std
        };
    }

    // Criar modelo
    createModel() {
        const model = tf.sequential({
            layers: [
                tf.layers.dense({ inputShape: [6], units: 64, activation: 'relu' }),
                tf.layers.dropout({ rate: 0.2 }),
                tf.layers.dense({ units: 32, activation: 'relu' }),
                tf.layers.dropout({ rate: 0.2 }),
                tf.layers.dense({ units: 16, activation: 'relu' }),
                tf.layers.dense({ units: 3, activation: 'linear' })
            ]
        });

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError',
            metrics: ['mse', 'mae']
        });

        return model;
    }

    // Treinar modelo
    async train(onEpochEnd = null) {
        // Gerar dados
        const data = this.generateTrainingData(1000);

        // Normalizar inputs
        const normalizedInputs = this.normalize(data.inputs);
        this.scaler.mean = await normalizedInputs.mean.array();
        this.scaler.std = await normalizedInputs.std.array();

        const xTrain = normalizedInputs.normalized;
        const yTrain = tf.tensor2d(data.outputs);

        // Criar modelo
        this.model = this.createModel();

        // Treinar
        const history = await this.model.fit(xTrain, yTrain, {
            epochs: 50,
            batchSize: 32,
            validationSplit: 0.2,
            shuffle: true,
            callbacks: {
                onEpochEnd: async (epoch, logs) => {
                    if (onEpochEnd) {
                        onEpochEnd(epoch, logs);
                    }
                }
            }
        });

        this.trainingHistory = history;
        this.isTrained = true;

        // Limpar tensores
        xTrain.dispose();
        yTrain.dispose();
        normalizedInputs.normalized.dispose();
        normalizedInputs.mean.dispose();
        normalizedInputs.std.dispose();

        return history;
    }

    // Fazer predição
    async predict(features) {
        if (!this.isTrained || !this.model) {
            // Se não treinado, usar modelo físico
            const [flowRate, pressure, temperature, waterCut, gor, viscosity] = features;
            const effGL = this.separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor);
            const effOA = this.separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity);
            const energy = this.separatorModel.energyConsumption(flowRate, pressure, temperature);
            return [effGL, effOA, energy];
        }

        // Normalizar input
        const inputTensor = tf.tensor2d([features]);
        const meanTensor = tf.tensor1d(this.scaler.mean);
        const stdTensor = tf.tensor1d(this.scaler.std);

        const normalizedInput = inputTensor.sub(meanTensor).div(stdTensor.add(1e-7));

        // Predição
        const prediction = this.model.predict(normalizedInput);
        const result = await prediction.array();

        // Limpar
        inputTensor.dispose();
        meanTensor.dispose();
        stdTensor.dispose();
        normalizedInput.dispose();
        prediction.dispose();

        return result[0];
    }

    // Obter arquitetura do modelo
    getArchitecture() {
        if (!this.model) return null;

        return this.model.layers.map(layer => ({
            name: layer.name,
            type: layer.getClassName(),
            units: layer.units || null,
            activation: layer.activation ? layer.activation.name : null
        }));
    }
}

// Classe para controle fuzzy
class FuzzyController {
    constructor() {
        this.rules = this.defineFuzzyRules();
    }

    // Funções de pertinência
    triangularMembership(x, a, b, c) {
        if (x <= a || x >= c) return 0;
        if (a < x && x <= b) return (x - a) / (b - a);
        return (c - x) / (c - b);
    }

    trapezoidalMembership(x, a, b, c, d) {
        if (x <= a || x >= d) return 0;
        if (b <= x && x <= c) return 1;
        if (a < x && x < b) return (x - a) / (b - a);
        return (d - x) / (d - c);
    }

    gaussianMembership(x, center, sigma) {
        return Math.exp(-0.5 * Math.pow((x - center) / sigma, 2));
    }

    bellMembership(x, a, b, c) {
        return 1 / (1 + Math.pow(Math.abs((x - c) / a), 2 * b));
    }

    // Definir regras fuzzy expandidas
    defineFuzzyRules() {
        return [
            // Regras de Eficiência
            {
                id: 1,
                condition: { efficiency: 'low', waterCut: 'high' },
                action: 'increase_temperature',
                description: "SE eficiência BAIXA E corte de água ALTO ENTÃO aumentar temperatura",
                priority: 1
            },
            {
                id: 2,
                condition: { efficiency: 'low', temperature: 'low' },
                action: 'increase_heating',
                description: "SE eficiência BAIXA E temperatura BAIXA ENTÃO aumentar aquecimento",
                priority: 1
            },
            {
                id: 3,
                condition: { efficiency: 'medium', energy: 'high' },
                action: 'optimize_pressure',
                description: "SE eficiência MÉDIA E energia ALTA ENTÃO otimizar pressão",
                priority: 2
            },
            {
                id: 4,
                condition: { efficiency: 'high', energy: 'high' },
                action: 'reduce_pressure',
                description: "SE eficiência ALTA E energia ALTA ENTÃO reduzir pressão",
                priority: 2
            },
            {
                id: 5,
                condition: { efficiency: 'high', energy: 'low' },
                action: 'maintain',
                description: "SE eficiência ALTA E energia BAIXA ENTÃO manter parâmetros",
                priority: 3
            },
            // Regras de Água
            {
                id: 6,
                condition: { waterCut: 'high', temperature: 'low' },
                action: 'increase_temperature',
                description: "SE corte de água ALTO E temperatura BAIXA ENTÃO aumentar temperatura",
                priority: 1
            },
            {
                id: 7,
                condition: { waterCut: 'high', flowRate: 'high' },
                action: 'reduce_flow',
                description: "SE corte de água ALTO E vazão ALTA ENTÃO reduzir vazão",
                priority: 2
            },
            // Regras de Energia
            {
                id: 8,
                condition: { energy: 'high', flowRate: 'normal' },
                action: 'optimize_process',
                description: "SE energia ALTA E vazão NORMAL ENTÃO otimizar processo",
                priority: 2
            },
            {
                id: 9,
                condition: { pressure: 'high', efficiency: 'medium' },
                action: 'reduce_pressure',
                description: "SE pressão ALTA E eficiência MÉDIA ENTÃO reduzir pressão",
                priority: 2
            },
            // Regra de segurança
            {
                id: 10,
                condition: { pressure: 'very_high', temperature: 'very_high' },
                action: 'emergency_shutdown',
                description: "SE pressão MUITO ALTA E temperatura MUITO ALTA ENTÃO desligamento emergencial",
                priority: 0
            }
        ];
    }

    // Fuzzificação de variáveis
    fuzzifyEfficiency(efficiency) {
        return {
            very_low: this.trapezoidalMembership(efficiency, 0.7, 0.75, 0.8, 0.82),
            low: this.triangularMembership(efficiency, 0.8, 0.85, 0.9),
            medium: this.triangularMembership(efficiency, 0.85, 0.9, 0.95),
            high: this.triangularMembership(efficiency, 0.9, 0.95, 0.98),
            very_high: this.trapezoidalMembership(efficiency, 0.96, 0.98, 1.0, 1.0)
        };
    }

    fuzzifyWaterCut(waterCut) {
        return {
            low: this.triangularMembership(waterCut, 0, 20, 35),
            medium: this.triangularMembership(waterCut, 30, 45, 60),
            high: this.triangularMembership(waterCut, 55, 70, 85),
            very_high: this.trapezoidalMembership(waterCut, 75, 85, 100, 100)
        };
    }

    fuzzifyTemperature(temperature) {
        return {
            very_low: this.trapezoidalMembership(temperature, 30, 40, 50, 55),
            low: this.triangularMembership(temperature, 50, 58, 65),
            normal: this.triangularMembership(temperature, 60, 70, 78),
            high: this.triangularMembership(temperature, 75, 82, 88),
            very_high: this.trapezoidalMembership(temperature, 85, 90, 100, 100)
        };
    }

    fuzzifyPressure(pressure) {
        return {
            low: this.triangularMembership(pressure, 7, 9, 10.5),
            normal: this.triangularMembership(pressure, 10, 11.5, 13),
            high: this.triangularMembership(pressure, 12.5, 14, 15.5),
            very_high: this.trapezoidalMembership(pressure, 14.5, 15.5, 17, 17)
        };
    }

    fuzzifyEnergy(energy) {
        return {
            very_low: this.trapezoidalMembership(energy, 1, 1.5, 1.8, 2),
            low: this.triangularMembership(energy, 1.8, 2.2, 2.6),
            normal: this.triangularMembership(energy, 2.4, 2.8, 3.2),
            high: this.triangularMembership(energy, 3, 3.5, 4),
            very_high: this.trapezoidalMembership(energy, 3.8, 4.2, 5, 5)
        };
    }

    fuzzifyFlowRate(flowRate) {
        return {
            very_low: this.trapezoidalMembership(flowRate, 0, 200, 500, 700),
            low: this.triangularMembership(flowRate, 600, 900, 1200),
            normal: this.triangularMembership(flowRate, 1100, 1500, 1900),
            high: this.triangularMembership(flowRate, 1800, 2100, 2400),
            very_high: this.trapezoidalMembership(flowRate, 2300, 2500, 3000, 3000)
        };
    }

    // Inferência Fuzzy
    evaluateRules(params) {
        const { efficiency, waterCut, temperature, pressure, energy, flowRate } = params;

        const fuzzyEff = this.fuzzifyEfficiency(efficiency);
        const fuzzyWater = this.fuzzifyWaterCut(waterCut);
        const fuzzyTemp = this.fuzzifyTemperature(temperature);
        const fuzzyPress = this.fuzzifyPressure(pressure);
        const fuzzyEnergy = this.fuzzifyEnergy(energy);
        const fuzzyFlow = this.fuzzifyFlowRate(flowRate);

        const activatedRules = [];

        this.rules.forEach(rule => {
            let activation = 1.0;
            let satisfied = true;

            // Avaliar condições
            if (rule.condition.efficiency) {
                const value = fuzzyEff[rule.condition.efficiency];
                if (value === 0) satisfied = false;
                activation = Math.min(activation, value || 0);
            }
            if (rule.condition.waterCut) {
                const value = fuzzyWater[rule.condition.waterCut];
                if (value === 0) satisfied = false;
                activation = Math.min(activation, value || 0);
            }
            if (rule.condition.temperature) {
                const value = fuzzyTemp[rule.condition.temperature];
                if (value === 0) satisfied = false;
                activation = Math.min(activation, value || 0);
            }
            if (rule.condition.pressure) {
                const value = fuzzyPress[rule.condition.pressure];
                if (value === 0) satisfied = false;
                activation = Math.min(activation, value || 0);
            }
            if (rule.condition.energy) {
                const value = fuzzyEnergy[rule.condition.energy];
                if (value === 0) satisfied = false;
                activation = Math.min(activation, value || 0);
            }
            if (rule.condition.flowRate) {
                const value = fuzzyFlow[rule.condition.flowRate];
                if (value === 0) satisfied = false;
                activation = Math.min(activation, value || 0);
            }

            if (satisfied && activation > 0.1) {
                activatedRules.push({
                    ...rule,
                    activation: activation
                });
            }
        });

        return activatedRules;
    }

    // Defuzzificação Sugeno de ordem zero (singleton):
    // Para saídas CATEGÓRICAS (ações), a COA clássica não se aplica — o correto
    // é AGREGAR a força de activação de cada ação por soma ponderada pela
    // prioridade (peso = 1/priority ⇒ priority=1 pesa 1.0, priority=2 pesa 0.5…),
    // devolvendo a acção com maior massa de evidência. A confiança é
    //      conf = Σ(w·μ)_vencedor / Σ(w·μ)_total   ∈ [0,1]
    // Isto é o Weighted Average Sugeno singleton (Takagi-Sugeno 1985).
    defuzzify(activatedRules) {
        if (!activatedRules || activatedRules.length === 0) {
            return {
                action: 'maintain',
                confidence: 0,
                description: 'Manter parâmetros atuais',
                rule: '—',
                allRules: [],
                aggregated: []
            };
        }

        // Peso por prioridade (prioridade mais baixa = mais importante)
        const weightOf = (r) => 1.0 / Math.max(1, (r.priority ?? 1));

        // Agregar strength por action
        const massByAction = new Map(); // action -> { mass, rules: [] }
        let totalMass = 0;
        activatedRules.forEach(r => {
            const w = weightOf(r);
            const m = w * r.activation;
            totalMass += m;
            const entry = massByAction.get(r.action) || { mass: 0, rules: [] };
            entry.mass += m;
            entry.rules.push(r);
            massByAction.set(r.action, entry);
        });

        // Ordenar ações por massa de evidência agregada (descendente)
        const aggregated = [...massByAction.entries()]
            .map(([action, { mass, rules }]) => ({
                action,
                mass,
                confidence: totalMass > 0 ? mass / totalMass : 0,
                rules: rules.sort((a, b) => b.activation - a.activation)
            }))
            .sort((a, b) => b.mass - a.mass);

        const winner = aggregated[0];
        const topRule = winner.rules[0];

        return {
            action: winner.action,
            confidence: winner.confidence,
            description: this.getActionDescription(winner.action),
            rule: topRule?.description || '—',
            // allRules: retrocompatibilidade com UI antiga (lista crua ordenada)
            allRules: [...activatedRules].sort((a, b) => b.activation - a.activation),
            // Nova estrutura: ranking de acções com massa agregada
            aggregated
        };
    }

    // Descrição das ações
    getActionDescription(action) {
        const actions = {
            'increase_temperature': 'Aumentar temperatura em 5°C',
            'increase_heating': 'Intensificar aquecimento',
            'reduce_pressure': 'Reduzir pressão em 0.5 bar',
            'optimize_pressure': 'Otimizar pressão de operação',
            'reduce_flow': 'Reduzir vazão de entrada',
            'optimize_process': 'Otimizar parâmetros do processo',
            'maintain': 'Manter parâmetros atuais',
            'emergency_shutdown': 'DESLIGAMENTO DE EMERGÊNCIA',
            'add_antifoam': 'Adicionar antiespumante',
            'increase_residence_time': 'Aumentar tempo de residência'
        };

        return actions[action] || '❓ Ação desconhecida';
    }

    // Controle completo
    getControlAction(params) {
        const activatedRules = this.evaluateRules(params);
        const decision = this.defuzzify(activatedRules);

        return decision;
    }

    // Gerar superfície de controle
    generateControlSurface(var1Name, var1Range, var2Name, var2Range, fixedParams) {
        const surface = [];
        const steps = 20;

        for (let i = 0; i <= steps; i++) {
            const row = [];
            const var1 = var1Range[0] + (i / steps) * (var1Range[1] - var1Range[0]);

            for (let j = 0; j <= steps; j++) {
                const var2 = var2Range[0] + (j / steps) * (var2Range[1] - var2Range[0]);

                const params = {
                    ...fixedParams,
                    [var1Name]: var1,
                    [var2Name]: var2
                };

                const decision = this.getControlAction(params);
                row.push(decision.confidence);
            }

            surface.push(row);
        }

        return surface;
    }
}

// ============================================================================
// GERENCIAMENTO DE ESTADO E UI
// ============================================================================

let currentParams = {
    flowRate: 1250,
    pressure: 11.3,
    temperature: 62,
    waterCut: 42,
    gor: 95,
    viscosity: 15,
    rhoOil: 870,
    rhoWater: 1020,
    rhoGas: 1.2
};

const separatorModel = new SeparatorModel();
const optimizer = new OptimizationAlgorithms();
const nnPredictor = new NeuralNetworkPredictor();
const fuzzyController = new FuzzyController();
// Expor o modelo para o módulo 3D usar velocidades terminais reais
try { if (typeof window !== 'undefined') window.separatorModel = separatorModel; } catch (_) {}

// ----------------------------------------------------------------------------
// VALIDAÇÃO DE PARÂMETROS — invariantes físicos de domínio
// ----------------------------------------------------------------------------
function validateParams(p) {
    const errors = [];
    const finite = (v) => Number.isFinite(v);

    if (!finite(p.flowRate)    || p.flowRate <= 0)                  errors.push('Vazão deve ser finita e > 0');
    if (!finite(p.pressure)    || p.pressure <= 0)                  errors.push('Pressão deve ser finita e > 0');
    if (!finite(p.temperature) || p.temperature <= -273.15)         errors.push('Temperatura abaixo do zero absoluto');
    if (!finite(p.waterCut)    || p.waterCut < 0 || p.waterCut > 100) errors.push('Corte de água deve estar em [0, 100] %');
    if (!finite(p.gor)         || p.gor < 0)                        errors.push('GOR não pode ser negativo');
    if (!finite(p.viscosity)   || p.viscosity <= 0)                 errors.push('Viscosidade deve ser > 0');

    if (!finite(p.rhoOil)   || p.rhoOil   <= 0) errors.push('ρ_óleo deve ser > 0');
    if (!finite(p.rhoWater) || p.rhoWater <= 0) errors.push('ρ_água deve ser > 0');
    if (!finite(p.rhoGas)   || p.rhoGas   <= 0) errors.push('ρ_gás deve ser > 0');

    // Invariantes físicos cruzados
    if (finite(p.rhoOil) && finite(p.rhoWater) && p.rhoOil >= p.rhoWater)
        errors.push('ρ_óleo deve ser < ρ_água (caso contrário O-A inverte)');
    if (finite(p.rhoGas) && finite(p.rhoOil) && p.rhoGas >= p.rhoOil)
        errors.push('ρ_gás deve ser < ρ_óleo');

    return errors;
}

// Exibe/esconde banner de validação no topo do dashboard
function renderValidationBanner(errors) {
    let banner = document.getElementById('validationBanner');
    if (errors.length === 0) {
        if (banner) banner.remove();
        return;
    }
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'validationBanner';
        banner.className = 'validation-banner';
        const main = document.querySelector('.main-content');
        if (main) main.prepend(banner);
    }
    banner.innerHTML = `
        <div class="validation-banner-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 9v4"/><path d="M12 17h.01"/>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            </svg>
        </div>
        <div class="validation-banner-body">
            <strong>Parâmetros fisicamente inconsistentes — resultados podem ser inválidos</strong>
            <ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>
    `;
}

// Função para trocar de aba
function switchTab(tabName) {
    // Desativar todas as abas
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => tab.classList.remove('active'));
    contents.forEach(content => content.classList.remove('active'));

    // Ativar aba selecionada
    document.querySelector(`button[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');

    // Fechar sidebar em mobile
    if (window.innerWidth <= 768) {
        toggleSidebar();
    }

    // Renderizar conteúdo da aba
    renderTabContent(tabName);
}

// Função para toggle do sidebar (mobile)
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

// ----------------------------------------------------------------------------
// SIDEBAR · Parâmetros, cenários, deltas, zonas de saúde, click-to-edit, rail
// ----------------------------------------------------------------------------

// Formatação numérica consistente com locale PT
const NUM_FMT_INT = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const NUM_FMT_1D  = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Quantas casas decimais para cada parâmetro na UI
const PARAM_DECIMALS = { pressure: 1, rhoGas: 1 };

function formatParamValue(id, raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return String(raw);
    const d = PARAM_DECIMALS[id] ?? 0;
    const fmt = d > 0
        ? new Intl.NumberFormat('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d })
        : NUM_FMT_INT;
    return fmt.format(v);
}
function formatDelta(id, raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return String(raw);
    const sign = v > 0 ? '+' : (v < 0 ? '−' : '±');
    const d = PARAM_DECIMALS[id] ?? 0;
    const mag = d > 0 ? Math.abs(v).toFixed(d) : Math.round(Math.abs(v));
    return v === 0 ? '±0' : `${sign}${mag}`;
}

// Debounce simples para evitar re-render do Plotly a cada tick
function debounce(fn, wait = 120) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
const debouncedUpdate = debounce(updateDashboard, 150);

// Pinta o progresso visual do range (variável CSS --pct)
function paintRange(slider) {
    const min = parseFloat(slider.min), max = parseFloat(slider.max);
    const v = parseFloat(slider.value);
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 50;
    slider.style.setProperty('--pct', pct + '%');
}

// Atualizar valor do slider sem apagar a sub-tag .unit
function writeSliderValue(id, raw) {
    const el = document.getElementById(id + 'Value');
    if (!el) return;
    const unit = el.querySelector('.unit');
    el.textContent = formatParamValue(id, raw);
    if (unit) el.appendChild(unit);
}

// Valores de base (usados pelo Reset e pelo delta vs baseline)
const BASELINE_PARAMS = {
    flowRate: 1250, pressure: 11.3, temperature: 62,
    waterCut: 42, gor: 95, viscosity: 15,
    rhoOil: 870, rhoWater: 1020, rhoGas: 1.2
};

// Cenários operacionais pré-definidos
const SCENARIOS = {
    baseline:    { ...BASELINE_PARAMS },
    highFlow:    { ...BASELINE_PARAMS, flowRate: 2000, pressure: 12.5, gor: 120 },
    lowPressure: { ...BASELINE_PARAMS, pressure: 9.2, temperature: 58 },
    highWaterCut:{ ...BASELINE_PARAMS, waterCut: 70, viscosity: 20, flowRate: 1500 }
};

// Zonas operacionais de saúde (ok / warn / crit)
// Fora do range crítico → "crit"; dentro de "warn" bands → "warn"; dentro de "ok" band → "ok"
const HEALTH_ZONES = {
    flowRate:    { ok: [800, 1700],   warn: [400, 2100]  },
    pressure:    { ok: [10.0, 13.0],  warn: [9.0, 14.2]  },
    temperature: { ok: [55, 72],      warn: [48, 80]     },
    waterCut:    { ok: [20, 55],      warn: [15, 68]     },
    gor:         { ok: [70, 130],     warn: [50, 160]    },
    viscosity:   { ok: [12, 20],      warn: [10, 26]     },
    rhoOil:      { ok: [840, 900],    warn: [820, 930]   },
    rhoWater:    { ok: [1005, 1050],  warn: [1000, 1080] },
    rhoGas:      { ok: [1.0, 1.5],    warn: [0.8, 1.8]   }
};

function healthClass(id, v) {
    const z = HEALTH_ZONES[id];
    if (!z) return 'ok';
    if (v >= z.ok[0]   && v <= z.ok[1])   return 'ok';
    if (v >= z.warn[0] && v <= z.warn[1]) return 'warn';
    return 'crit';
}

// Mapas id → elemento dot/delta (cache pequeno)
function _hEl(id) { return document.getElementById('h' + id.charAt(0).toUpperCase() + id.slice(1)); }
function _dEl(id) { return document.getElementById('d' + id.charAt(0).toUpperCase() + id.slice(1)); }

function updateHealthDot(id, v) {
    const el = _hEl(id);
    if (!el) return;
    el.classList.remove('ok','warn','crit');
    el.classList.add(healthClass(id, v));
}

function updateDeltaChip(id, v) {
    const el = _dEl(id);
    if (!el) return;
    const base = BASELINE_PARAMS[id];
    const d = v - base;
    el.textContent = formatDelta(id, d);
    el.classList.toggle('changed', Math.abs(d) > 1e-9);
}

// Contadores de secção (quantos alterados)
const SECTION_PARAMS = {
    process: ['flowRate','pressure','temperature','waterCut','gor','viscosity'],
    fluids:  ['rhoOil','rhoWater','rhoGas']
};
function refreshSectionCounters() {
    Object.entries(SECTION_PARAMS).forEach(([section, ids]) => {
        const changed = ids.filter(id => Math.abs(currentParams[id] - BASELINE_PARAMS[id]) > 1e-9).length;
        const node = document.querySelector(`[data-counter="${section}"]`);
        if (node) node.textContent = changed ? `${ids.length} · ${changed} alterados` : `${ids.length}`;
        const sec = node ? node.closest('.sidebar-section') : null;
        if (sec) sec.classList.toggle('has-mods', changed > 0);
    });
}

// Detectar se os params atuais batem num preset conhecido e selecionar no dropdown
function syncScenarioSelector() {
    const sel = document.getElementById('scenarioSelect');
    if (!sel) return;
    const match = Object.entries(SCENARIOS).find(([, preset]) =>
        Object.keys(preset).every(k => Math.abs(currentParams[k] - preset[k]) < 1e-6));
    sel.value = match ? match[0] : 'custom';
    // reativar "Personalizado" só quando aplicável
    const customOpt = sel.querySelector('option[value="custom"]');
    if (customOpt) customOpt.disabled = !!match;
}

// Aplicar um cenário inteiro
function applyScenario(name) {
    const preset = SCENARIOS[name];
    if (!preset) return;
    Object.entries(preset).forEach(([k, v]) => setParamValue(k, v, { silent: true }));
    updateDashboard();
    refreshSectionCounters();
    syncScenarioSelector();
}

// Define o valor de um parâmetro em todos os lados (slider, chip, delta, health)
function setParamValue(id, v, { silent = false } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    v = clampToSlider(el, v);
    el.value = v;
    currentParams[id] = v;
    if (el.type === 'range') {
        paintRange(el);
        writeSliderValue(id, v);
    }
    updateHealthDot(id, v);
    updateDeltaChip(id, v);
    if (!silent) {
        refreshSectionCounters();
        syncScenarioSelector();
    }
}

function clampToSlider(el, v) {
    const min = parseFloat(el.min), max = parseFloat(el.max);
    if (Number.isFinite(min) && v < min) v = min;
    if (Number.isFinite(max) && v > max) v = max;
    return v;
}

const ALL_PARAMS = ['flowRate','pressure','temperature','waterCut','gor','viscosity','rhoOil','rhoWater','rhoGas'];

function setupSliders() {
    ALL_PARAMS.forEach(id => {
        const slider = document.getElementById(id);
        if (!slider) return;
        // Estado inicial
        paintRange(slider);
        writeSliderValue(id, slider.value);
        updateHealthDot(id, parseFloat(slider.value));
        updateDeltaChip(id, parseFloat(slider.value));

        slider.addEventListener('input', function() {
            const v = parseFloat(this.value);
            if (!Number.isFinite(v)) return;
            currentParams[id] = v;
            paintRange(this);
            writeSliderValue(id, v);
            updateHealthDot(id, v);
            updateDeltaChip(id, v);
            refreshSectionCounters();
            syncScenarioSelector();
            debouncedUpdate();
        });

        // Click-to-edit: duplo-clique no valor abre um input editável
        const valueEl = document.getElementById(id + 'Value');
        if (valueEl) valueEl.addEventListener('dblclick', (e) => openInlineEditor(id, e));
    });

    refreshSectionCounters();
    syncScenarioSelector();
}

// Editor inline (duplo-clique no valor)
function openInlineEditor(id, evt) {
    evt.stopPropagation();
    const slider = document.getElementById(id);
    const valueEl = document.getElementById(id + 'Value');
    if (!slider || !valueEl) return;
    const current = parseFloat(slider.value);
    const step = parseFloat(slider.step) || 1;
    const original = valueEl.innerHTML;

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input-edit';
    input.min = slider.min;
    input.max = slider.max;
    input.step = step;
    input.value = current;
    valueEl.replaceChildren(input);
    input.focus();
    input.select();

    const commit = () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) {
            setParamValue(id, v);
            updateDashboard();
        } else {
            valueEl.innerHTML = original;
        }
    };
    const cancel = () => { valueEl.innerHTML = original; };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.removeEventListener('blur', commit); cancel(); }
    });
}

// Repor todos os parâmetros aos valores de base
function resetAllParams() {
    applyScenario('baseline');
}

// Colapsar/expandir sidebar inteira para rail estreito
function toggleRail() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('rail');
}

// Atualizar carimbo do status bar
function stampStatusCalc() {
    const el = document.getElementById('statusLastCalc');
    if (!el) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    el.innerHTML = `Último cálculo · <strong>${hh}:${mm}:${ss}</strong>`;
}

// Atualizar dashboard
function updateDashboard() {
    // Validação física antes de calcular — avisa o utilizador se os parâmetros
    // violam invariantes de domínio (ρ_óleo<ρ_água, P>0, etc.).
    const errs = validateParams(currentParams);
    renderValidationBanner(errs);

    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
        const tabName = activeTab.textContent.includes('Dashboard') ? 'dashboard' :
                       activeTab.textContent.includes('Modelagem') ? 'modeling' :
                       activeTab.textContent.includes('Redes') ? 'neural' :
                       activeTab.textContent.includes('Otimização') ? 'optimization' :
                       activeTab.textContent.includes('Fuzzy') ? 'fuzzy' :
                       activeTab.textContent.includes('Econômica') ? 'economic' :
                       activeTab.textContent.includes('Comparação') ? 'comparison' :
                       activeTab.textContent.includes('Assistente') ? 'assistant' : 'calculator';

        renderTabContent(tabName);
        stampStatusCalc();
    }
}

// Renderizar conteúdo das abas
function renderTabContent(tabName) {
    switch(tabName) {
        case 'dashboard':
            renderDashboard();
            break;
        case 'modeling':
            renderModeling();
            break;
        case 'vessel3d':
            renderVessel3D();
            break;
        case 'neural':
            renderNeural();
            break;
        case 'optimization':
            renderOptimization();
            break;
        case 'fuzzy':
            renderFuzzy();
            break;
        case 'economic':
            renderEconomic();
            break;
        case 'calculator':
            renderCalculator();
            break;
        case 'comparison':
            renderComparison();
            break;
        case 'assistant':
            renderAssistant();
            break;
    }
}

// Renderizar Dashboard Principal
function renderDashboard() {
    const { flowRate, pressure, temperature, waterCut, gor, viscosity } = currentParams;

    // Calcular métricas
    const effGL = separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor);
    const effOA = separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity);
    const energy = separatorModel.energyConsumption(flowRate, pressure, temperature);

    const baselineRevenue = 180000;
    const efficiencyGain = ((effGL + effOA) / 2 - 0.92) * baselineRevenue;

    const deltaGL = ((effGL - 0.95) * 100);
    const deltaOA = ((effOA - 0.89) * 100);
    const deltaEnergy = (energy - 2.4);

    const fmtMoney = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(Math.abs(efficiencyGain));
    const html = `
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Eficiência G-L <span class="metric-ref">vs 95% meta</span></div>
                <div class="metric-value">${(effGL * 100).toFixed(1)}<span class="metric-unit">%</span></div>
                <div class="metric-delta ${deltaGL >= 0 ? 'positive' : 'negative'}">
                    <span class="arrow">${deltaGL >= 0 ? '▲' : '▼'}</span> ${Math.abs(deltaGL).toFixed(1)} pp
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Eficiência O-A <span class="metric-ref">vs 89% meta</span></div>
                <div class="metric-value">${(effOA * 100).toFixed(1)}<span class="metric-unit">%</span></div>
                <div class="metric-delta ${deltaOA >= 0 ? 'positive' : 'negative'}">
                    <span class="arrow">${deltaOA >= 0 ? '▲' : '▼'}</span> ${Math.abs(deltaOA).toFixed(1)} pp
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Consumo específico <span class="metric-ref">vs 2.40 base</span></div>
                <div class="metric-value">${energy.toFixed(2)}<span class="metric-unit">MWh/1000 m³</span></div>
                <div class="metric-delta ${deltaEnergy <= 0 ? 'positive' : 'negative'}">
                    <span class="arrow">${deltaEnergy <= 0 ? '▼' : '▲'}</span> ${Math.abs(deltaEnergy).toFixed(2)} MWh
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Impacto anual <span class="metric-ref">vs receita base</span></div>
                <div class="metric-value">${efficiencyGain < 0 ? '−' : ''}${fmtMoney}<span class="metric-unit">USD/ano</span></div>
                <div class="metric-delta ${efficiencyGain >= 0 ? 'positive' : 'negative'}">
                    <span class="arrow">${efficiencyGain >= 0 ? '▲' : '▼'}</span> ${(Math.abs(efficiencyGain)/baselineRevenue*100).toFixed(1)}% a.a.
                </div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="card">
                <div id="efficiencyTrendChart"></div>
            </div>
            <div class="card">
                <div id="performanceRadarChart"></div>
            </div>
        </div>

        <div class="card">
            <h4>Status Operacional</h4>
            <div class="status-grid">
                <div class="status-item">
                    <strong>Separação G-L</strong>
                    ${effGL > 0.93 ? '🟢' : effGL > 0.90 ? '🟡' : '🔴'} ${(effGL * 100).toFixed(1)}%
                </div>
                <div class="status-item">
                    <strong>Separação O-A</strong>
                    ${effOA > 0.87 ? '🟢' : effOA > 0.84 ? '🟡' : '🔴'} ${(effOA * 100).toFixed(1)}%
                </div>
                <div class="status-item">
                    <strong>Energia</strong>
                    ${energy < 2.5 ? '🟢' : energy < 3.0 ? '🟡' : '🔴'} ${energy.toFixed(2)} MWh
                </div>
                <div class="status-item">
                    <strong>Status Geral</strong>
                    ${effGL > 0.93 && effOA > 0.87 ? '🟢 ÓTIMO' :
                      effGL > 0.90 && effOA > 0.84 ? '🟡 BOM' : '🔴 CRÍTICO'}
                </div>
            </div>
        </div>
    `;

    document.getElementById('dashboard').innerHTML = html;

    // Renderizar gráficos
    renderEfficiencyTrendChart();
    renderPerformanceRadarChart(effGL, effOA, energy);
}

// Gráfico de tendência de eficiência
function renderEfficiencyTrendChart() {
    const { flowRate, pressure, temperature, waterCut, gor, viscosity } = currentParams;
    const days = 100;
    const dates = [];
    const efficiencyData = [];
    const upperBound = [];
    const lowerBound = [];

    const startDate = new Date('2024-01-01');

    // Simular variação diária dos parâmetros em torno dos valores actuais
    // com drift operacional e ruído do processo
    for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        dates.push(date.toISOString().split('T')[0]);

        // Variações diárias realistas dos parâmetros
        const dayFlowRate = flowRate + flowRate * 0.05 * Math.sin(i * 0.08) + (Math.random() - 0.5) * 50;
        const dayPressure = pressure + 0.3 * Math.sin(i * 0.12) + (Math.random() - 0.5) * 0.2;
        const dayTemp = temperature + 2 * Math.sin(i * 0.06) + (Math.random() - 0.5) * 1;
        const dayGor = gor + 5 * Math.sin(i * 0.15) + (Math.random() - 0.5) * 3;
        const dayVisc = viscosity + 1 * Math.cos(i * 0.1) + (Math.random() - 0.5) * 0.5;
        const dayWaterCut = waterCut + 2 * Math.sin(i * 0.05) + (Math.random() - 0.5) * 1;

        // Calcular eficiência real com os modelos
        const effGL = separatorModel.separationEfficiencyGL(dayFlowRate, dayPressure, dayTemp, dayGor);
        const effOA = separatorModel.separationEfficiencyOA(dayFlowRate, dayTemp, dayWaterCut, dayVisc);
        const eff = (effGL + effOA) / 2;

        efficiencyData.push(eff);
        upperBound.push(eff + 0.015);
        lowerBound.push(eff - 0.015);
    }

    const trace1 = {
        x: dates, y: efficiencyData, mode: 'lines',
        name: 'Eficiência total',
        line: { color: '#06b6d4', width: 2.2, shape: 'spline', smoothing: 0.6 },
        hovertemplate: '<b>%{x}</b><br>Eficiência: %{y:.1%}<extra></extra>'
    };
    const trace2 = { x: dates, y: upperBound, mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' };
    const trace3 = {
        x: dates, y: lowerBound, mode: 'lines', line: { width: 0 },
        fill: 'tonexty', fillcolor: 'rgba(6,182,212,0.14)',
        name: 'Banda de confiança (±2%)', hoverinfo: 'skip'
    };

    const layout = {
        title: 'Tendência de eficiência',
        xaxis: { title: '' },
        yaxis: { title: 'Eficiência', tickformat: '.0%', range: [0.85, 1.0] },
        height: 360,
        margin: { t: 48, r: 24, b: 56, l: 56 },
        shapes: [{
            type: 'line', x0: dates[0], x1: dates[dates.length - 1],
            y0: 0.95, y1: 0.95,
            line: { color: '#f59e0b', width: 1.5, dash: 'dash' }
        }],
        annotations: [{
            x: dates[dates.length - 1], y: 0.95,
            text: 'Meta 95%', showarrow: false, xanchor: 'left', yanchor: 'bottom',
            font: { color: '#f59e0b', size: 11 }
        }]
    };

    Plotly.newPlot('efficiencyTrendChart', [trace1, trace2, trace3], layout);
}

// Gráfico radar de performance
function renderPerformanceRadarChart(effGL, effOA, energy) {
    const categories = ['Eficiência G-L', 'Eficiência O-A', 'Economia Energia', 'Estabilidade', 'Qualidade'];
    // Economia: normalizar energia para escala 0-100 (referência: 1-5 MWh -> 100-0)
    const energyScore = Math.max(0, Math.min(100, (5 - energy) / 4 * 100));
    // Estabilidade: baseada na proximidade dos parâmetros ao ponto ótimo
    const flowDev = Math.abs(currentParams.flowRate - 1000) / 1400;
    const pressDev = Math.abs(currentParams.pressure - 11) / 4;
    const tempDev = Math.abs(currentParams.temperature - 65) / 20;
    const stabilityScore = Math.max(0, (1 - (flowDev + pressDev + tempDev) / 3) * 100);
    // Qualidade: média ponderada das eficiências com penalidade por energia alta
    const qualityScore = Math.max(0, Math.min(100, (effGL * 0.4 + effOA * 0.4) * 100 + 20 - energy * 2));
    const currentValues = [effGL * 100, effOA * 100, energyScore, stabilityScore, qualityScore];
    const benchmarkValues = [97, 92, 75, 90, 95];
    const targetValues = [99, 96, 90, 95, 98];

    const trace1 = {
        type: 'scatterpolar',
        r: currentValues,
        theta: categories,
        fill: 'toself',
        name: 'Atual',
        line:     { color: '#06b6d4', width: 2 },
        fillcolor: 'rgba(6,182,212,0.22)',
        marker:   { size: 6, color: '#06b6d4' }
    };

    const trace2 = {
        type: 'scatterpolar',
        r: benchmarkValues,
        theta: categories,
        name: 'Benchmark',
        line:     { color: '#a78bfa', width: 1.5 },
        marker:   { size: 5, color: '#a78bfa' }
    };

    const trace3 = {
        type: 'scatterpolar',
        r: targetValues,
        theta: categories,
        name: 'Meta',
        line:     { color: '#f59e0b', width: 1.5, dash: 'dash' },
        marker:   { size: 4, color: '#f59e0b' }
    };

    const layout = {
        title: 'Performance vs Benchmark vs Meta',
        polar: {
            radialaxis: { visible: true, range: [0, 100], tickvals: [25, 50, 75, 100], ticksuffix: '' },
            angularaxis: { rotation: 90, direction: 'clockwise' }
        },
        margin: { t: 48, r: 48, b: 60, l: 48 },
        height: 380
    };

    Plotly.newPlot('performanceRadarChart', [trace1, trace2, trace3], layout);
}

// Renderizar Modelagem Matemática
function renderModeling() {
    const p = currentParams;
    const T_K = p.temperature + 273.15;

    // ---- Evaluations ao vivo com params actuais -----------------------
    // (1) Arraste
    const muOil_Pa_s = p.viscosity * 1e-3;
    const d50 = 500e-6; // gota padrão O-A
    const vTerm = separatorModel.terminalVelocity(d50, p.rhoWater, p.rhoOil, muOil_Pa_s);
    const Re_d = Math.abs(p.rhoOil * vTerm * d50 / muOil_Pa_s);
    const Cd = separatorModel.cdMorsiAlexander(Re_d);
    const regime = separatorModel.particleRegime(d50, p.rhoWater, p.rhoOil, muOil_Pa_s);
    const regimeLabel = { stokes: 'Stokes · Re<1', intermediate: 'Intermediário · 1<Re<10³', newton: 'Newton · Re>10³' }[regime];
    const regimeBadge = regime === 'stokes' ? 'ok' : (regime === 'intermediate' ? 'info' : 'warn');

    // (2) Souders-Brown
    const K_act = separatorModel.soudersBrownK(p.pressure, 'mesh');
    const rhoGas_real = separatorModel.gasDensityRK(p.pressure, T_K);
    const vCrit = separatorModel.soudersBrownVelocity(p.rhoOil, rhoGas_real, K_act);

    // (3) EoS Redlich-Kwong
    const Z = separatorModel.zFactorRK(p.pressure, T_K);

    // (4) Weber crítico
    const areaOA = 1.13;
    const vSup = (p.flowRate / 86400) / areaOA;
    const dMax = separatorModel.maxStableDroplet(vSup, p.rhoOil);

    // ---- Helpers HTML -----------------------------------------------
    const fmt = (v, d = 2) => Number.isFinite(v) ? Number(v).toLocaleString('pt-PT', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—';
    const expo = (v, d = 2) => Number.isFinite(v) ? Number(v).toExponential(d) : '—';
    const html = `
        <header class="page-head">
            <div>
                <h2>Modelagem matemática</h2>
                <p>Equações físicas que governam o separador tri-fásico. Cada modelo mostra a equação, a legenda de variáveis, o intervalo de validade e o valor avaliado com os parâmetros operacionais actuais.</p>
            </div>
            <div class="page-meta">
                <span>4 modelos · 9 variáveis</span>
                <strong>${fmt(Re_d, 2)}</strong>
                <span>Re da gota (actual)</span>
            </div>
        </header>

        <!-- SECÇÃO 1 · ARRASTE -->
        <section class="section">
            <div class="section-head">
                <span class="section-num">01</span>
                <h3>Arraste gravitacional de partículas</h3>
                <span class="section-caption">sedimentação de gotas em meio contínuo</span>
            </div>
            <div class="cards-row">

                <article class="model-card">
                    <div class="model-card__head">
                        <div class="model-card__title">Lei de Stokes
                            <small>Velocidade terminal em regime laminar</small>
                        </div>
                        <span class="model-card__badge ${Re_d < 1 ? 'ok' : 'warn'}">${Re_d < 1 ? 'válida' : 'fora do regime'}</span>
                    </div>
                    <div class="model-card__eq">v<span class="sub">t</span> = (2 g r<span class="sup">2</span> · Δρ) / (9 μ)</div>
                    <div class="legend">
                        <span class="sym">v<sub>t</sub></span><span>velocidade terminal da gota</span><span class="unit">m/s</span>
                        <span class="sym">g</span><span>gravidade</span><span class="unit">9,81 m/s²</span>
                        <span class="sym">r</span><span>raio da gota</span><span class="unit">m</span>
                        <span class="sym">Δρ</span><span>diferença de densidades (dispersa − contínua)</span><span class="unit">kg/m³</span>
                        <span class="sym">μ</span><span>viscosidade dinâmica da fase contínua</span><span class="unit">Pa·s</span>
                    </div>
                    <div class="live-out">
                        <span class="live-label">v<sub>t</sub> · d=500 μm, actual</span>
                        <span class="live-value">${fmt(vTerm * 1000, 3)}<small>mm/s</small></span>
                    </div>
                    <div class="model-card__foot">
                        <span>Validade: Re &lt; 1 · esferas rígidas</span>
                        <span class="ref">Stokes 1851</span>
                    </div>
                </article>

                <article class="model-card">
                    <div class="model-card__head">
                        <div class="model-card__title">Coef. arraste · Morsi-Alexander
                            <small>C<sub>D</sub>(Re) piecewise para qualquer regime</small>
                        </div>
                        <span class="model-card__badge ${regimeBadge}">${regimeLabel}</span>
                    </div>
                    <div class="model-card__eq">C<span class="sub">D</span>(Re) = a/Re + b/Re<span class="sup">2</span> + c</div>
                    <div class="legend">
                        <span class="sym">Re</span><span>Reynolds da partícula ρ·v·d/μ</span><span class="unit">—</span>
                        <span class="sym">a, b, c</span><span>coeficientes por faixa de Re (7 faixas)</span><span class="unit">—</span>
                    </div>
                    <div class="live-grid">
                        <div class="live-out"><span class="live-label">Re</span><span class="live-value">${fmt(Re_d, 2)}</span></div>
                        <div class="live-out"><span class="live-label">C<sub>D</sub></span><span class="live-value">${fmt(Cd, 2)}</span></div>
                    </div>
                    <div class="model-card__foot">
                        <span>Validade: 0 &lt; Re &lt; 5·10⁴</span>
                        <span class="ref">Morsi &amp; Alexander 1972</span>
                    </div>
                </article>

            </div>
        </section>

        <!-- SECÇÃO 2 · CAPACIDADE DE GÁS -->
        <section class="section">
            <div class="section-head">
                <span class="section-num">02</span>
                <h3>Capacidade de separação gás-líquido</h3>
                <span class="section-caption">velocidade crítica antes de arraste de gotas</span>
            </div>
            <div class="cards-row">

                <article class="model-card">
                    <div class="model-card__head">
                        <div class="model-card__title">Souders-Brown
                            <small>Velocidade crítica do gás (anti-arraste)</small>
                        </div>
                        <span class="model-card__badge info">GPSA</span>
                    </div>
                    <div class="model-card__eq">v<span class="sub">g,crit</span> = K · √((ρ<span class="sub">l</span> − ρ<span class="sub">g</span>) / ρ<span class="sub">g</span>)</div>
                    <div class="legend">
                        <span class="sym">K</span><span>factor tabelado GPSA, varia com P e tipo de demister</span><span class="unit">m/s</span>
                        <span class="sym">ρ<sub>l</sub>, ρ<sub>g</sub></span><span>densidade do líquido e do gás nas condições de operação</span><span class="unit">kg/m³</span>
                    </div>
                    <div class="live-grid">
                        <div class="live-out"><span class="live-label">K @ ${fmt(p.pressure,1)} bar</span><span class="live-value">${fmt(K_act, 3)}</span></div>
                        <div class="live-out"><span class="live-label">v<sub>g,crit</sub></span><span class="live-value">${fmt(vCrit, 2)}<small>m/s</small></span></div>
                    </div>
                    <div class="model-card__foot">
                        <span>Demister: wire mesh (default)</span>
                        <span class="ref">GPSA EDB §7</span>
                    </div>
                </article>

            </div>
        </section>

        <!-- SECÇÃO 3 · PROPRIEDADES TERMODINÂMICAS -->
        <section class="section">
            <div class="section-head">
                <span class="section-num">03</span>
                <h3>Equação de estado do gás</h3>
                <span class="section-caption">ρ-gás real para condições de pressão/temperatura</span>
            </div>
            <div class="cards-row">

                <article class="model-card">
                    <div class="model-card__head">
                        <div class="model-card__title">Redlich-Kwong
                            <small>EoS cúbica · desvio da idealidade (Z)</small>
                        </div>
                        <span class="model-card__badge ${Z > 0.9 ? 'ok' : 'info'}">Z = ${fmt(Z, 3)}</span>
                    </div>
                    <div class="model-card__eq">P = RT/(v−b) − a / (T<span class="sup">0,5</span> · v(v+b))</div>
                    <div class="legend">
                        <span class="sym">Z</span><span>factor de compressibilidade (1 = gás ideal)</span><span class="unit">—</span>
                        <span class="sym">a, b</span><span>parâmetros derivados de T<sub>c</sub>, P<sub>c</sub></span><span class="unit">—</span>
                        <span class="sym">T<sub>c</sub>, P<sub>c</sub></span><span>temperatura e pressão críticas do gás</span><span class="unit">K, bar</span>
                    </div>
                    <div class="live-grid">
                        <div class="live-out"><span class="live-label">Z</span><span class="live-value">${fmt(Z, 3)}</span></div>
                        <div class="live-out"><span class="live-label">ρ<sub>g</sub> real</span><span class="live-value">${fmt(rhoGas_real, 2)}<small>kg/m³</small></span></div>
                    </div>
                    <div class="model-card__foot">
                        <span>T<sub>c</sub>=190,6 K · P<sub>c</sub>=46 bar (CH₄-rich)</span>
                        <span class="ref">Redlich &amp; Kwong 1949</span>
                    </div>
                </article>

            </div>
        </section>

        <!-- SECÇÃO 4 · INSTABILIDADES -->
        <section class="section">
            <div class="section-head">
                <span class="section-num">04</span>
                <h3>Instabilidades e fragmentação</h3>
                <span class="section-caption">critério Weber para quebra de gotas</span>
            </div>
            <div class="cards-row">

                <article class="model-card">
                    <div class="model-card__head">
                        <div class="model-card__title">Weber crítico (Hinze)
                            <small>Diâmetro máximo estável sob cisalhamento</small>
                        </div>
                        <span class="model-card__badge info">We<sub>c</sub> ≈ 12</span>
                    </div>
                    <div class="model-card__eq">d<span class="sub">max</span> = σ · We<span class="sub">c</span> / (ρ<span class="sub">c</span> · v<span class="sup">2</span>)</div>
                    <div class="legend">
                        <span class="sym">σ</span><span>tensão interfacial</span><span class="unit">N/m</span>
                        <span class="sym">v</span><span>velocidade superficial da fase contínua</span><span class="unit">m/s</span>
                        <span class="sym">ρ<sub>c</sub></span><span>densidade da fase contínua</span><span class="unit">kg/m³</span>
                    </div>
                    <div class="live-grid">
                        <div class="live-out"><span class="live-label">v<sub>sup</sub></span><span class="live-value">${fmt(vSup, 4)}<small>m/s</small></span></div>
                        <div class="live-out"><span class="live-label">d<sub>max</sub></span><span class="live-value">${Number.isFinite(dMax) && dMax < 0.01 ? fmt(dMax * 1e6, 0) : '—'}<small>μm</small></span></div>
                    </div>
                    <div class="model-card__foot">
                        <span>σ assumida: 0,025 N/m (óleo-água)</span>
                        <span class="ref">Hinze 1955</span>
                    </div>
                </article>

            </div>
        </section>

        <!-- SECÇÃO 5 · GRÁFICO -->
        <section class="section">
            <div class="section-head">
                <span class="section-num">05</span>
                <h3>Velocidade terminal vs tamanho de gota</h3>
                <span class="section-caption">comparação Stokes puro × solver iterativo Morsi-Alexander</span>
            </div>
            <div class="card" style="padding: 12px;">
                <div id="stokesChart" style="min-height: 380px;"></div>
            </div>
        </section>
    `;

    document.getElementById('modeling').innerHTML = html;
    renderStokesChart();
}

function calculateStokes() {
    const radius = parseFloat(document.getElementById('dropRadius')?.value || 100) * 1e-6;
    const { viscosity, rhoOil, rhoWater } = currentParams;
    const muOil = viscosity * 1e-3;

    const vStokes = separatorModel.stokesVelocity(radius, rhoWater, rhoOil, muOil);
    const reynolds = separatorModel.reynoldsNumber(vStokes, radius * 2, rhoOil, muOil);

    let resultHtml = `
        <div class="result-box">
            Velocidade terminal: ${(vStokes * 1000).toFixed(2)} mm/s
        </div>
        <div class="info-box">
            🔢 Reynolds da gota: ${reynolds.toExponential(2)}
        </div>
    `;

    if (reynolds < 1) {
        resultHtml += `<div class="success-box">Lei de Stokes aplicável (Re < 1)</div>`;
    } else {
        resultHtml += `<div class="warning-box">Considerar correções para Re > 1</div>`;
    }

    const resultDiv = document.getElementById('stokesResult');
    if (resultDiv) {
        resultDiv.innerHTML = resultHtml;
    }

    // Gráfico de Stokes
    renderStokesChart();
}

function calculateSoudersBrown() {
    const { rhoOil, rhoGas } = currentParams;
    const vSB = separatorModel.soudersBrownVelocity(rhoOil, rhoGas);

    const resultHtml = `
        <div class="result-box">
            Velocidade crítica do gás: ${vSB.toFixed(3)} m/s
        </div>
    `;

    const resultDiv = document.getElementById('soudersBrownResult');
    if (resultDiv) {
        resultDiv.innerHTML = resultHtml;
    }
}

function renderStokesChart() {
    const { viscosity, rhoOil, rhoWater } = currentParams;
    const muOil = viscosity * 1e-3;

    // Varrer tamanhos de gota de 10 μm a 5000 μm em escala logarítmica.
    // Comparar Stokes puro (fórmula fechada) × solver iterativo Morsi-Alexander.
    const diams_um = [];
    const vStokes_mm_s = [];
    const vMorsi_mm_s = [];
    const Re_arr = [];

    for (let i = 10; i <= 5000; i = (i < 100 ? i + 5 : (i < 1000 ? i + 25 : i + 100))) {
        const d = i * 1e-6; // m
        const vS = separatorModel.stokesVelocity(d/2, rhoWater, rhoOil, muOil); // Lei de Stokes pura
        const vM = separatorModel.terminalVelocity(d, rhoWater, rhoOil, muOil); // Morsi-Alexander iterativo
        const Re = Math.abs(rhoOil * vM * d / muOil);
        diams_um.push(i);
        vStokes_mm_s.push(vS * 1000);
        vMorsi_mm_s.push(vM * 1000);
        Re_arr.push(Re);
    }

    const traceStokes = {
        x: diams_um, y: vStokes_mm_s, mode: 'lines',
        name: 'Stokes (fórmula fechada)',
        line: { color: '#a78bfa', width: 1.8, dash: 'dash' },
        hovertemplate: 'd=%{x} μm<br>v=%{y:.2f} mm/s (Stokes)<extra></extra>'
    };
    const traceMorsi = {
        x: diams_um, y: vMorsi_mm_s, mode: 'lines',
        name: 'Morsi-Alexander (iterativo)',
        line: { color: '#06b6d4', width: 2.4 },
        hovertemplate: 'd=%{x} μm<br>v=%{y:.2f} mm/s (iterativo)<extra></extra>'
    };
    // Marcar a faixa de validade de Stokes (Re<1): encontrar o d onde Re cruza 1
    const idxRe1 = Re_arr.findIndex(r => r > 1);
    const dRe1 = idxRe1 > 0 ? diams_um[idxRe1] : null;

    const shapes = dRe1 ? [{
        type: 'line', x0: dRe1, x1: dRe1, y0: 0, y1: 1, yref: 'paper',
        line: { color: '#f59e0b', width: 1.5, dash: 'dot' }
    }] : [];
    const annotations = dRe1 ? [{
        x: dRe1, y: 1, yref: 'paper', text: `Re=1 @ ${dRe1} μm`,
        showarrow: false, xanchor: 'left', yanchor: 'top',
        font: { color: '#f59e0b', size: 10 }, xshift: 4
    }] : [];

    const layout = {
        title: 'Velocidade terminal vs diâmetro de gota',
        xaxis: { title: 'Diâmetro da gota (μm)', type: 'log' },
        yaxis: { title: 'Velocidade de sedimentação (mm/s)', type: 'log' },
        height: 380,
        margin: { t: 48, r: 24, b: 56, l: 64 },
        shapes, annotations
    };

    Plotly.newPlot('stokesChart', [traceStokes, traceMorsi], layout);
}

// ============================================================================
// VASO 3D · viewport paramétrico Three.js
// ============================================================================
function renderVessel3D() {
    const p = currentParams;
    const specs = calculateSeparatorDesign(p);
    const specs3d = {
        ...specs,
        waterCut:    p.waterCut,
        flowRate:    p.flowRate,
        pressure:    p.pressure,
        temperature: p.temperature,
        gor:         p.gor,
        viscosity:   p.viscosity,
        rhoOil:      p.rhoOil,
        rhoWater:    p.rhoWater,
        rhoGas:      p.rhoGas
    };

    // Fast path: se o viewport já existe, só actualiza geometria + sidebar numérica.
    // Evita destruir/recriar WebGL a cada slider tick (performance crítica).
    const existingViewport = document.getElementById('vessel3dViewport');
    if (existingViewport && window.VPO3D && window.VPO3D.scene && window.VPO3D.container === existingViewport) {
        window.VPO3D.update(specs3d);
        updateVesselSidePanel(specs, p);
        return;
    }

    const html = `
        <header class="page-head">
            <div>
                <h2>Vaso 3D · representação física</h2>
                <p>Modelo paramétrico do separador tri-fásico horizontal. Geometria reconstruída em tempo real a partir do dimensionamento (ASME UG-27/32 + Souders-Brown + tempo de residência). Arraste para orbitar, scroll para zoom.</p>
            </div>
            <div class="page-meta">
                <span>${specs.type}</span>
                <strong>${specs.D_final.toFixed(2)} × ${specs.L_eff.toFixed(2)} m</strong>
                <span>D × L efectivo</span>
            </div>
        </header>

        <div class="vessel3d-layout">
            <div class="vessel3d-viewport" id="vessel3dViewport">
                <div class="vessel3d-loader" id="vessel3dLoader">
                    <div class="spin"></div>
                    <div>A carregar motor 3D (Three.js)…</div>
                </div>
                <div class="vessel3d-hud">
                    <strong>Controles</strong>
                    <span><span class="key">drag</span>orbitar</span>
                    <span><span class="key">scroll</span>zoom</span>
                    <span><span class="key">right-drag</span>pan</span>
                </div>
                <div class="vessel3d-actions">
                    <button onclick="VPO3D &amp;&amp; VPO3D.setView('iso')">Isométrica</button>
                    <button onclick="VPO3D &amp;&amp; VPO3D.setView('side')">Lateral</button>
                    <button onclick="VPO3D &amp;&amp; VPO3D.setView('front')">Frontal</button>
                    <button onclick="VPO3D &amp;&amp; VPO3D.setView('top')">Topo</button>
                    <button id="vesselPauseBtn" onclick="vesselTogglePause()">‖ Pausa</button>
                    <button onclick="vesselSnapshot()">PNG</button>
                </div>
            </div>

            <aside class="vessel3d-side">
                <div class="vessel3d-spec">
                    <h4>Dimensões mecânicas</h4>
                    <dl>
                        <dt>Tipo</dt><dd>${specs.type.replace('Trifásico', '3-F')}</dd>
                        <dt>Diâmetro D</dt><dd>${specs.D_final.toFixed(2)} m</dd>
                        <dt>Comprimento L</dt><dd>${specs.L_eff.toFixed(2)} m</dd>
                        <dt>Relação L/D</dt><dd>${(specs.L_eff / specs.D_final).toFixed(2)}</dd>
                        <dt>Espessura t</dt><dd>${specs.t_total} mm</dd>
                        <dt>Peso estimado</dt><dd>${(specs.weight/1000).toFixed(1)} t</dd>
                    </dl>
                </div>
                <div class="vessel3d-spec">
                    <h4>Interfaces de fase</h4>
                    <dl>
                        <dt>Preenchimento líquido</dt><dd>55 %</dd>
                        <dt>Corte de água</dt><dd>${p.waterCut.toFixed(0)} %</dd>
                        <dt>Pressão de projeto</dt><dd>${(p.pressure * 1.1 + 2).toFixed(1)} bar</dd>
                        <dt>Temperatura</dt><dd>${p.temperature} °C</dd>
                    </dl>
                </div>
                <div class="vessel3d-spec">
                    <h4>Legenda</h4>
                    <div class="vessel3d-legend">
                        <span class="lg-shell">Casco (shell + heads 2:1)</span>
                        <span class="lg-gas">Gás · bolhas vermelhas</span>
                        <span class="lg-oil">Petróleo cru · preto</span>
                        <span class="lg-water">Água · azul</span>
                        <span class="lg-mesh">Mist extractor (wire mesh)</span>
                    </div>
                </div>
            </aside>
        </div>
    `;
    document.getElementById('vessel3d').innerHTML = html;

    const viewport = document.getElementById('vessel3dViewport');
    waitForVPO3D((ok, err) => {
        if (!ok) {
            showVessel3DError(viewport, err);
            return;
        }
        try {
            if (!window.VPO3D.scene) {
                window.VPO3D.init(viewport, specs3d);
            } else if (window.VPO3D.container !== viewport) {
                window.VPO3D.dispose();
                window.VPO3D.init(viewport, specs3d);
            } else {
                window.VPO3D.update(specs3d);
            }
            // Remove o loader quando o canvas estiver visível
            const canvas = viewport.querySelector('canvas');
            const loader = document.getElementById('vessel3dLoader');
            if (canvas && loader) loader.remove();
        } catch (e) {
            console.error('[VPO3D] falha a inicializar:', e);
            showVessel3DError(viewport, e);
        }
    });
}

// Espera até window.VPO3D estar disponível (módulo ES loaded).
// Tenta durante 8 segundos; se não aparecer, considera falha.
function waitForVPO3D(cb, deadline = Date.now() + 8000) {
    if (window.VPO3D) return cb(true);
    if (Date.now() > deadline) {
        return cb(false, new Error('Módulo Three.js não carregou. Verifique a ligação (jsdelivr/CDN) ou o console do browser.'));
    }
    setTimeout(() => waitForVPO3D(cb, deadline), 100);
}

function showVessel3DError(viewport, err) {
    const loader = viewport.querySelector('.vessel3d-loader');
    if (!loader) return;
    loader.classList.add('err');
    loader.innerHTML = `
        <strong>Não foi possível carregar o motor 3D</strong>
        <div style="margin-top:4px">${escapeHtml(err?.message || String(err))}</div>
        <code>${escapeHtml(err?.stack || '').split('\n').slice(0, 4).join('\n')}</code>
        <div style="margin-top:8px;color:var(--text-muted)">Abra o console do browser (F12) para mais detalhes. O resto da aplicação continua a funcionar.</div>
    `;
}


// Update incremental apenas do painel lateral (sem tocar no viewport WebGL)
function updateVesselSidePanel(specs, p) {
    const q = (sel) => document.querySelector(sel);
    const side = document.querySelector('.vessel3d-side');
    if (!side) return;
    const specDls = side.querySelectorAll('.vessel3d-spec');
    if (specDls.length >= 2) {
        // 1º card: dimensões
        const dds1 = specDls[0].querySelectorAll('dd');
        if (dds1[0]) dds1[0].textContent = specs.type.replace('Trifásico', '3-F');
        if (dds1[1]) dds1[1].textContent = `${specs.D_final.toFixed(2)} m`;
        if (dds1[2]) dds1[2].textContent = `${specs.L_eff.toFixed(2)} m`;
        if (dds1[3]) dds1[3].textContent = (specs.L_eff / specs.D_final).toFixed(2);
        if (dds1[4]) dds1[4].textContent = `${specs.t_total} mm`;
        if (dds1[5]) dds1[5].textContent = `${(specs.weight/1000).toFixed(1)} t`;
        // 2º card: interfaces
        const dds2 = specDls[1].querySelectorAll('dd');
        if (dds2[1]) dds2[1].textContent = `${p.waterCut.toFixed(0)} %`;
        if (dds2[2]) dds2[2].textContent = `${(p.pressure * 1.1 + 2).toFixed(1)} bar`;
        if (dds2[3]) dds2[3].textContent = `${p.temperature} °C`;
    }
    // Meta do header
    const meta = document.querySelector('#vessel3d .page-head .page-meta');
    if (meta) {
        const spans = meta.querySelectorAll('span');
        const strong = meta.querySelector('strong');
        if (spans[0]) spans[0].textContent = specs.type;
        if (strong) strong.textContent = `${specs.D_final.toFixed(2)} × ${specs.L_eff.toFixed(2)} m`;
    }
}

// Botão: pausar/retomar animação de partículas
function vesselTogglePause() {
    if (!window.VPO3D || typeof window.VPO3D.togglePause !== 'function') return;
    const paused = window.VPO3D.togglePause();
    const btn = document.getElementById('vesselPauseBtn');
    if (btn) btn.textContent = paused ? '▶ Retomar' : '‖ Pausa';
}

// Botão: tirar snapshot PNG do viewport 3D
function vesselSnapshot() {
    if (!window.VPO3D) return;
    const dataUrl = window.VPO3D.snapshot();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `VPO-vessel-3D-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
}

// Hook para actualizar o 3D quando os sliders mudarem e a tab estiver activa
function maybeUpdateVessel3D() {
    const tab = document.querySelector('.tab.active');
    if (!tab || !tab.textContent.includes('Vaso 3D')) return;
    if (!window.VPO3D || !window.VPO3D.scene) return;
    const p = currentParams;
    const specs = calculateSeparatorDesign(p);
    window.VPO3D.update({
        ...specs,
        waterCut:    p.waterCut,
        flowRate:    p.flowRate,
        pressure:    p.pressure,
        temperature: p.temperature,
        gor:         p.gor,
        viscosity:   p.viscosity,
        rhoOil:      p.rhoOil,
        rhoWater:    p.rhoWater,
        rhoGas:      p.rhoGas
    });
}

// Renderizar Redes Neurais
function renderNeural() {
    const { flowRate, pressure, temperature, waterCut, gor, viscosity } = currentParams;

    const trainButtonHtml = nnPredictor.isTrained
        ? '<button onclick="retrainNeuralNetwork()" style="background: var(--warning);">🔄 Retreinar Modelo</button>'
        : '<button onclick="trainNeuralNetwork()"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:3px"><polygon points="3,1 13,8 3,15"/></svg> Treinar Rede Neural</button>';

    const statusHtml = nnPredictor.isTrained
        ? '<div class="success-box"><strong>Modelo Treinado</strong> — A rede neural está pronta para fazer predições</div>'
        : '<div class="info-box"><strong>Modelo Não Treinado</strong> — Clique em "Treinar Rede Neural" para iniciar o treinamento com TensorFlow.js</div>';

    const html = `
        <div class="card">
            <h3>Rede Neural com TensorFlow.js</h3>
            ${statusHtml}
            <div style="margin-top: 1rem;">
                ${trainButtonHtml}
                <button onclick="makePrediction()" ${!nnPredictor.isTrained ? 'disabled' : ''} style="margin-left: 0.5rem;">
                    🔮 Fazer Predição
                </button>
            </div>
            <div id="trainingProgress"></div>
        </div>

        <div class="card">
            <h4>Arquitetura da Rede Neural — MLP 6 → 64 → 32 → 16 → 3</h4>
            <div id="architectureViz"></div>
            <div id="layerTable" style="margin-top: 1.25rem;"></div>
        </div>

        <div class="card">
            <h4>Formulação Matemática</h4>
            <div id="formulasContent"></div>
        </div>

        ${nnPredictor.isTrained ? `
        <div class="charts-grid">
            <div class="card">
                <h4>Histórico de Treinamento - Loss</h4>
                <div id="trainingLossChart"></div>
            </div>
            <div class="card">
                <h4>Histórico de Treinamento - MAE</h4>
                <div id="trainingMAEChart"></div>
            </div>
        </div>
        ` : ''}

        <div class="card">
            <h4>Parâmetros Atuais</h4>
            <div class="status-grid">
                <div class="status-item"><strong>Vazão</strong> ${flowRate} m³/dia</div>
                <div class="status-item"><strong>Pressão</strong> ${pressure} bar</div>
                <div class="status-item"><strong>Temperatura</strong> ${temperature} °C</div>
                <div class="status-item"><strong>Corte de Água</strong> ${waterCut}%</div>
                <div class="status-item"><strong>GOR</strong> ${gor} m³/m³</div>
                <div class="status-item"><strong>Viscosidade</strong> ${viscosity} cP</div>
            </div>
        </div>

        <div class="card" id="predictionResults"></div>
    `;

    document.getElementById('neural').innerHTML = html;

    renderArchitecture();
    renderFormulas();

    if (nnPredictor.isTrained) {
        renderTrainingHistory();
    }
}

// Treinar Rede Neural
async function trainNeuralNetwork(event) {
    const progressDiv = document.getElementById('trainingProgress');
    const button = event ? event.target : document.querySelector('button[onclick="trainNeuralNetwork()"]');

    button.disabled = true;
    button.innerHTML = '<span class="loading"></span> Treinando...';

    progressDiv.innerHTML = `
        <div class="info-box" style="margin-top: 1rem;">
            <strong>⏳ Treinamento em Progresso...</strong>
            <div id="epochInfo">Epoch 0/50</div>
            <div style="background: var(--gray-200); height: 10px; border-radius: 5px; margin-top: 0.5rem; overflow: hidden;">
                <div id="progressBar" style="background: var(--primary); height: 100%; width: 0%; transition: width 0.3s;"></div>
            </div>
        </div>
    `;

    try {
        await nnPredictor.train((epoch, logs) => {
            const progress = ((epoch + 1) / 50) * 100;
            document.getElementById('progressBar').style.width = progress + '%';
            document.getElementById('epochInfo').innerHTML = `
                Epoch ${epoch + 1}/50 -
                Loss: ${logs.loss.toFixed(4)} -
                Val Loss: ${logs.val_loss.toFixed(4)}
            `;
        });

        progressDiv.innerHTML = '<div class="success-box" style="margin-top: 1rem;"><strong>Treinamento Concluído!</strong></div>';

        // Re-renderizar a aba
        setTimeout(() => renderNeural(), 1000);
    } catch (error) {
        progressDiv.innerHTML = `<div class="warning-box" style="margin-top: 1rem;"><strong>Erro:</strong> ${error.message}</div>`;
        button.disabled = false;
        button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:3px"><polygon points="3,1 13,8 3,15"/></svg> Treinar Rede Neural';
    }
}

// Retreinar Rede Neural
async function retrainNeuralNetwork() {
    nnPredictor.isTrained = false;
    nnPredictor.model = null;
    renderNeural();
    setTimeout(() => trainNeuralNetwork(), 100);
}

// Fazer Predição
async function makePrediction() {
    const { flowRate, pressure, temperature, waterCut, gor, viscosity } = currentParams;
    const features = [flowRate, pressure, temperature, waterCut, gor, viscosity];

    const resultsDiv = document.getElementById('predictionResults');
    resultsDiv.innerHTML = '<div class="info-box">⏳ Fazendo predição...</div>';

    try {
        const prediction = await nnPredictor.predict(features);

        // Calcular valores reais para comparação
        const realEffGL = separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor);
        const realEffOA = separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity);
        const realEnergy = separatorModel.energyConsumption(flowRate, pressure, temperature);

        const errorGL = Math.abs(prediction[0] - realEffGL) / realEffGL * 100;
        const errorOA = Math.abs(prediction[1] - realEffOA) / realEffOA * 100;
        const errorEnergy = Math.abs(prediction[2] - realEnergy) / realEnergy * 100;

        resultsDiv.innerHTML = `
            <h4>Resultados da Predição</h4>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">Eficiência G-L Prevista</div>
                    <div class="metric-value">${(prediction[0] * 100).toFixed(2)}%</div>
                    <div class="metric-delta ${errorGL < 5 ? 'positive' : 'negative'}">
                        Erro: ${errorGL.toFixed(2)}%
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Eficiência O-A Prevista</div>
                    <div class="metric-value">${(prediction[1] * 100).toFixed(2)}%</div>
                    <div class="metric-delta ${errorOA < 5 ? 'positive' : 'negative'}">
                        Erro: ${errorOA.toFixed(2)}%
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Energia Prevista</div>
                    <div class="metric-value">${prediction[2].toFixed(3)}</div>
                    <div class="metric-delta ${errorEnergy < 5 ? 'positive' : 'negative'}">
                        Erro: ${errorEnergy.toFixed(2)}%
                    </div>
                </div>
            </div>

            <h4 style="margin-top: 1.5rem;">Comparação: Predição vs Real</h4>
            <div id="comparisonChart"></div>
        `;

        // Renderizar gráfico de comparação
        renderComparisonChart(prediction, [realEffGL, realEffOA, realEnergy]);
    } catch (error) {
        resultsDiv.innerHTML = `<div class="warning-box"><strong>Erro:</strong> ${error.message}</div>`;
    }
}

// Renderizar arquitetura da rede
function renderArchitecture() {
    const layers = [
        { name: 'Input',   subtitle: '6 features',   count: 6,  visible: 6, act: 'Linear',              color: '#10b981' },
        { name: 'Dense 1', subtitle: '64 unidades',  count: 64, visible: 8, act: 'ReLU + Dropout(0.2)', color: '#007acc' },
        { name: 'Dense 2', subtitle: '32 unidades',  count: 32, visible: 6, act: 'ReLU + Dropout(0.2)', color: '#007acc' },
        { name: 'Dense 3', subtitle: '16 unidades',  count: 16, visible: 4, act: 'ReLU',                color: '#007acc' },
        { name: 'Output',  subtitle: '3 saídas',     count: 3,  visible: 3, act: 'Linear',              color: '#f59e0b' }
    ];

    const inputLabels  = ['Q (m³/d)', 'P (bar)', 'T (°C)', 'WC (%)', 'GOR', 'μ (cP)'];
    const outputLabels = ['η_GL', 'η_OA', 'E (kW)'];

    const W = 980, H = 560;
    const xs = [110, 300, 490, 680, 870];
    const yCenter = 290;
    const nodeR = 14;
    const spacing = 38;

    const nodes = layers.map((layer) => {
        const positions = [];
        const startY = yCenter - ((layer.visible - 1) * spacing) / 2;
        for (let i = 0; i < layer.visible; i++) {
            positions.push({ x: xs[layers.indexOf(layer)], y: startY + i * spacing });
        }
        return positions;
    });

    let connections = '';
    for (let li = 0; li < layers.length - 1; li++) {
        for (const n1 of nodes[li]) {
            for (const n2 of nodes[li + 1]) {
                connections += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="rgba(0,122,204,0.18)" stroke-width="0.7"/>`;
            }
        }
    }

    let labels = '';
    layers.forEach((layer, li) => {
        labels += `
            <text x="${xs[li]}" y="55"      text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">${layer.name}</text>
            <text x="${xs[li]}" y="74"      text-anchor="middle" font-size="11" fill="#858585">${layer.subtitle}</text>
            <text x="${xs[li]}" y="${H-30}" text-anchor="middle" font-size="11" fill="#f59e0b">${layer.act}</text>
        `;
    });

    let ellipses = '';
    layers.forEach((layer, li) => {
        if (layer.visible < layer.count) {
            const lastY = nodes[li][nodes[li].length - 1].y;
            ellipses += `<text x="${xs[li]}" y="${lastY + 32}" text-anchor="middle" font-size="22" fill="#858585">⋮</text>`;
            ellipses += `<text x="${xs[li]}" y="${lastY + 60}" text-anchor="middle" font-size="10" font-weight="600" fill="#858585">+${layer.count - layer.visible} unidades</text>`;
        }
    });

    let nodeEls = '';
    nodes.forEach((layerNodes, li) => {
        const layer = layers[li];
        layerNodes.forEach((n, ni) => {
            nodeEls += `<circle cx="${n.x}" cy="${n.y}" r="${nodeR}" fill="${layer.color}" fill-opacity="0.28" stroke="${layer.color}" stroke-width="2"/>`;
            if (li === 0) {
                nodeEls += `<text x="${n.x - 22}" y="${n.y + 4}" text-anchor="end"   font-size="11" font-family="monospace" fill="currentColor">${inputLabels[ni]}</text>`;
            }
            if (li === layers.length - 1) {
                nodeEls += `<text x="${n.x + 22}" y="${n.y + 4}" text-anchor="start" font-size="11" font-family="monospace" fill="currentColor">${outputLabels[ni]}</text>`;
            }
        });
    });

    const svg = `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
             style="width:100%;height:auto;max-height:580px;color:var(--text-primary);background:rgba(0,0,0,0.08);border-radius:6px;">
            <g>${connections}</g>
            <g>${nodeEls}</g>
            <g>${labels}</g>
            <g>${ellipses}</g>
        </svg>
        <div style="text-align:center;font-size:0.78rem;color:var(--text-secondary);margin-top:0.5rem;">
            Diagrama esquemático — apenas algumas unidades das camadas ocultas são desenhadas para legibilidade.
        </div>
    `;

    const p1 = 6 * 64 + 64;    // 448
    const p2 = 64 * 32 + 32;   // 2080
    const p3 = 32 * 16 + 16;   // 528
    const p4 = 16 * 3 + 3;     // 51
    const total = p1 + p2 + p3 + p4;

    const rows = [
        ['L0', 'Input',   '6',  '—',         '—'],
        ['L1', 'Dense',   '64', 'ReLU',      `6·64 + 64 = ${p1}`],
        ['—',  'Dropout', '—',  'p = 0.2',   '0'],
        ['L2', 'Dense',   '32', 'ReLU',      `64·32 + 32 = ${p2.toLocaleString('pt-BR')}`],
        ['—',  'Dropout', '—',  'p = 0.2',   '0'],
        ['L3', 'Dense',   '16', 'ReLU',      `32·16 + 16 = ${p3}`],
        ['L4', 'Dense',   '3',  'Linear',    `16·3 + 3 = ${p4}`]
    ];

    const table = `
        <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse: collapse; font-size: 0.85rem;">
            <thead>
                <tr style="background: var(--bg-tertiary);">
                    <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color);">Camada</th>
                    <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color);">Tipo</th>
                    <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color);">Unidades</th>
                    <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color);">Ativação</th>
                    <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color);">Parâmetros (W + b)</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `
                    <tr>
                        ${r.map(c => `<td style="padding:0.45rem 0.75rem;border-bottom:1px solid var(--border-color);font-family:monospace;">${c}</td>`).join('')}
                    </tr>
                `).join('')}
                <tr>
                    <td colspan="4" style="padding:0.6rem 0.75rem;font-weight:600;">Total de parâmetros treináveis</td>
                    <td style="padding:0.6rem 0.75rem;font-family:monospace;font-weight:700;color:var(--accent);">${total.toLocaleString('pt-BR')}</td>
                </tr>
            </tbody>
        </table>
        </div>
    `;

    document.getElementById('architectureViz').innerHTML = svg;
    document.getElementById('layerTable').innerHTML = table;
}

// Renderizar fórmulas matemáticas da rede neural
function renderFormulas() {
    const target = document.getElementById('formulasContent');
    if (!target) return;

    const formula = (label, eq, desc) => `
        <div style="margin:0.85rem 0;padding:0.7rem 1rem;background:var(--bg-tertiary);border-left:3px solid var(--accent);border-radius:4px;">
            <div style="font-weight:600;color:var(--accent);margin-bottom:0.35rem;font-size:0.82rem;letter-spacing:0.02em;">${label}</div>
            <div style="font-family:'Cambria Math','STIX Two Math',Georgia,serif;font-size:1.02rem;padding:0.35rem 0;color:var(--text-bright);line-height:1.7;">${eq}</div>
            ${desc ? `<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.25rem;">${desc}</div>` : ''}
        </div>
    `;

    target.innerHTML = `
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem;">
            Equações que governam o treino e a inferência da MLP. <strong>x ∈ ℝ⁶</strong> é o vetor de entrada (Q, P, T, WC, GOR, μ);
            <strong>ŷ ∈ ℝ³</strong> é a saída predita (η<sub>GL</sub>, η<sub>OA</sub>, E).
        </p>

        ${formula(
            '1 · Normalização Z-score (pré-processamento)',
            'x̃<sub>i</sub> &nbsp;=&nbsp; ( x<sub>i</sub> − μ<sub>i</sub> ) / ( σ<sub>i</sub> + ε )',
            'μ e σ são estimados sobre o conjunto de treino. ε = 10⁻⁷ evita divisão por zero.'
        )}

        ${formula(
            '2 · Camada densa — propagação direta',
            'z<sup>(ℓ)</sup> &nbsp;=&nbsp; W<sup>(ℓ)</sup> · a<sup>(ℓ−1)</sup> &nbsp;+&nbsp; b<sup>(ℓ)</sup>',
            'W<sup>(ℓ)</sup> ∈ ℝ<sup>n<sub>ℓ</sub>×n<sub>ℓ−1</sub></sup>, b<sup>(ℓ)</sup> ∈ ℝ<sup>n<sub>ℓ</sub></sup>. Para ℓ = 1, a<sup>(0)</sup> = x̃.'
        )}

        ${formula(
            '3 · Ativação ReLU (camadas ocultas L1, L2, L3)',
            'a<sup>(ℓ)</sup> &nbsp;=&nbsp; ReLU( z<sup>(ℓ)</sup> ) &nbsp;=&nbsp; max( 0, z<sup>(ℓ)</sup> )',
            'Não-linearidade que zera ativações negativas; barata e eficaz contra vanishing gradient.'
        )}

        ${formula(
            '4 · Dropout (regularização nas camadas L1 e L2)',
            'ã<sup>(ℓ)</sup> &nbsp;=&nbsp; ( a<sup>(ℓ)</sup> ⊙ m ) / ( 1 − p ), &nbsp;&nbsp; m<sub>i</sub> ~ Bernoulli( 1 − p )',
            'p = 0.2. Aplicado apenas durante o treino; em inferência o dropout fica desativado.'
        )}

        ${formula(
            '5 · Camada de saída (regressão linear)',
            'ŷ &nbsp;=&nbsp; W<sup>(out)</sup> · a<sup>(3)</sup> &nbsp;+&nbsp; b<sup>(out)</sup>',
            'Sem ativação → preserva a escala física das saídas (eficiências em [0,1] e energia em kW).'
        )}

        ${formula(
            '6 · Função de perda — Mean Squared Error',
            'ℒ &nbsp;=&nbsp; (1 / N) &nbsp; Σ<sub>n=1</sub><sup>N</sup> &nbsp; ‖ y<sup>(n)</sup> − ŷ<sup>(n)</sup> ‖²',
            'Erro quadrático médio sobre as 3 saídas em todo o mini-batch (N = 32).'
        )}

        ${formula(
            '7 · Otimizador Adam (α = 10⁻³)',
            `
                g<sub>t</sub> &nbsp;=&nbsp; ∇<sub>θ</sub> ℒ ( θ<sub>t−1</sub> )<br>
                m<sub>t</sub> &nbsp;=&nbsp; β₁ &middot; m<sub>t−1</sub> &nbsp;+&nbsp; ( 1 − β₁ ) &middot; g<sub>t</sub><br>
                v<sub>t</sub> &nbsp;=&nbsp; β₂ &middot; v<sub>t−1</sub> &nbsp;+&nbsp; ( 1 − β₂ ) &middot; g<sub>t</sub>²<br>
                m̂<sub>t</sub> &nbsp;=&nbsp; m<sub>t</sub> / ( 1 − β₁<sup>t</sup> ), &nbsp;&nbsp; v̂<sub>t</sub> &nbsp;=&nbsp; v<sub>t</sub> / ( 1 − β₂<sup>t</sup> )<br>
                θ<sub>t</sub> &nbsp;=&nbsp; θ<sub>t−1</sub> &nbsp;−&nbsp; α &middot; m̂<sub>t</sub> / ( √v̂<sub>t</sub> + ε )
            `,
            'Hiperparâmetros padrão: β₁ = 0.9, β₂ = 0.999, ε = 10⁻⁸.'
        )}

        <div style="margin-top:1.25rem;padding:0.75rem 1rem;background:rgba(0,122,204,0.08);border-radius:6px;">
            <div style="font-weight:600;margin-bottom:0.5rem;color:var(--accent);">Hiperparâmetros de Treino</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.5rem 1rem;font-size:0.85rem;">
                <div><strong>Épocas:</strong> 50</div>
                <div><strong>Batch size:</strong> 32</div>
                <div><strong>Learning rate:</strong> α = 10⁻³</div>
                <div><strong>Validation split:</strong> 20%</div>
                <div><strong>Amostras de treino:</strong> 1 000</div>
                <div><strong>Dropout rate:</strong> p = 0.2</div>
                <div><strong>Otimizador:</strong> Adam</div>
                <div><strong>Loss:</strong> MSE</div>
                <div><strong>Métricas:</strong> MSE, MAE</div>
            </div>
        </div>
    `;
}

// Renderizar histórico de treinamento
function renderTrainingHistory() {
    if (!nnPredictor.trainingHistory) return;

    const history = nnPredictor.trainingHistory.history;
    const epochs = Array.from({ length: history.loss.length }, (_, i) => i + 1);

    // Gráfico de Loss
    const traceLoss = {
        x: epochs,
        y: history.loss,
        mode: 'lines+markers',
        name: 'Training Loss',
        line: { color: '#ef4444', width: 2 }
    };

    const traceValLoss = {
        x: epochs,
        y: history.val_loss,
        mode: 'lines+markers',
        name: 'Validation Loss',
        line: { color: '#3b82f6', width: 2 }
    };

    const layoutLoss = {
        xaxis: { title: 'Epoch' },
        yaxis: { title: 'Loss (MSE)' },
        height: 350,
        margin: { t: 20, b: 40, l: 60, r: 20 }
    };

    Plotly.newPlot('trainingLossChart', [traceLoss, traceValLoss], layoutLoss, { responsive: true });

    // Gráfico de MAE
    const traceMAE = {
        x: epochs,
        y: history.mae,
        mode: 'lines+markers',
        name: 'Training MAE',
        line: { color: '#10b981', width: 2 }
    };

    const traceValMAE = {
        x: epochs,
        y: history.val_mae,
        mode: 'lines+markers',
        name: 'Validation MAE',
        line: { color: '#f59e0b', width: 2 }
    };

    const layoutMAE = {
        xaxis: { title: 'Epoch' },
        yaxis: { title: 'MAE' },
        height: 350,
        margin: { t: 20, b: 40, l: 60, r: 20 }
    };

    Plotly.newPlot('trainingMAEChart', [traceMAE, traceValMAE], layoutMAE, { responsive: true });
}

// Renderizar gráfico de comparação
function renderComparisonChart(predicted, real) {
    const categories = ['Eficiência G-L', 'Eficiência O-A', 'Energia'];

    const tracePredicted = {
        x: categories,
        y: [predicted[0] * 100, predicted[1] * 100, predicted[2]],
        type: 'bar',
        name: 'Predição',
        marker: { color: '#3b82f6' }
    };

    const traceReal = {
        x: categories,
        y: [real[0] * 100, real[1] * 100, real[2]],
        type: 'bar',
        name: 'Real (Modelo Físico)',
        marker: { color: '#10b981' }
    };

    const layout = {
        barmode: 'group',
        height: 350,
        margin: { t: 20, b: 60, l: 60, r: 20 },
        yaxis: { title: 'Valor' }
    };

    Plotly.newPlot('comparisonChart', [tracePredicted, traceReal], layout, { responsive: true });
}

// Renderizar Otimização
function renderOptimization() {
    const html = `
        <h3><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M14 1v9h-1V3.41L7.41 9 6 7.59 11.59 2H5V1h9zM8 12H3V7h1v4h4v1zm5-1v1h-1v-1h1zM2 14h12v1H2v-1zM1 6v8h1V6H1z"/></svg> Otimização Multiobjetivo (NSGA-II)</h3>

        <div class="info-box">
            <strong>Objetivos:</strong><br>
            1. Maximizar eficiência de separação (G-L e O-A)<br>
            2. Minimizar consumo energético<br>
            3. Minimizar emissões de CO₂
        </div>

        <button onclick="runOptimization()"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:3px"><polygon points="3,1 13,8 3,15"/></svg> Executar Otimização</button>

        <div id="optimizationResults"></div>
        <div class="chart-container">
            <div id="optimizationChart"></div>
        </div>
    `;

    document.getElementById('optimization').innerHTML = html;
}

function runOptimization() {
    const resultsDiv = document.getElementById('optimizationResults');
    resultsDiv.innerHTML = '<div class="info-box">⏳ Executando otimização... Aguarde.</div>';

    // Executar otimização em background
    setTimeout(() => {
        const bounds = [
            [150, 2400],   // flowRate
            [8.5, 15.2],   // pressure
            [45, 85],      // temperature
            [15, 78]       // waterCut
        ];

        const solutions = optimizer.nsgaIIOptimization(bounds, 30, 50);
        const bestSolution = solutions[solutions.length - 1];

        const [flowRate, pressure, temperature, waterCut] = bestSolution.solution;
        const [effObj, energyObj, emissionsObj] = bestSolution.objectives;

        let html = `
            <div class="success-box">
                <strong>Otimização Concluída!</strong>
            </div>

            <h4>Melhores Parâmetros Encontrados</h4>
            <div class="formulas-grid">
                <div class="formula-box"><strong>Vazão:</strong> ${flowRate.toFixed(1)} m³/dia</div>
                <div class="formula-box"><strong>Pressão:</strong> ${pressure.toFixed(2)} bar</div>
                <div class="formula-box"><strong>Temperatura:</strong> ${temperature.toFixed(1)} °C</div>
                <div class="formula-box"><strong>Corte de Água:</strong> ${waterCut.toFixed(1)}%</div>
            </div>

            <h4>Objetivos Alcançados</h4>
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">Eficiência</div>
                    <div class="metric-value">${(-effObj * 100).toFixed(1)}%</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Energia</div>
                    <div class="metric-value">${energyObj.toFixed(2)}</div>
                    <div class="metric-delta">MWh/1000m³</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Emissões</div>
                    <div class="metric-value">${emissionsObj.toFixed(2)}</div>
                    <div class="metric-delta">ton CO₂</div>
                </div>
            </div>
        `;

        resultsDiv.innerHTML = html;

        // Gráfico de convergência
        renderOptimizationChart(solutions);
    }, 1000);
}

function renderOptimizationChart(solutions) {
    const generations = solutions.map(s => s.generation);
    const efficiencies = solutions.map(s => -s.objectives[0]);
    const energies = solutions.map(s => s.objectives[1]);

    const trace1 = {
        x: generations,
        y: efficiencies,
        mode: 'lines+markers',
        name: 'Eficiência',
        yaxis: 'y'
    };

    const trace2 = {
        x: generations,
        y: energies,
        mode: 'lines+markers',
        name: 'Energia',
        yaxis: 'y2'
    };

    const layout = {
        title: 'Convergência da Otimização',
        xaxis: { title: 'Geração' },
        yaxis: {
            title: 'Eficiência',
            titlefont: { color: '#1f77b4' },
            tickfont: { color: '#1f77b4' }
        },
        yaxis2: {
            title: 'Energia (MWh/1000m³)',
            titlefont: { color: '#ff7f0e' },
            tickfont: { color: '#ff7f0e' },
            overlaying: 'y',
            side: 'right'
        },
        height: 400
    };

    Plotly.newPlot('optimizationChart', [trace1, trace2], layout, {responsive: true});
}

// Renderizar Controle Fuzzy
function renderFuzzy() {
    const { flowRate, pressure, temperature, waterCut, gor, viscosity } = currentParams;

    const effGL = separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor);
    const effOA = separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity);
    const avgEff = (effGL + effOA) / 2;
    const energy = separatorModel.energyConsumption(flowRate, pressure, temperature);

    // Obter decisão de controle
    const decision = fuzzyController.getControlAction({
        efficiency: avgEff,
        waterCut: waterCut,
        temperature: temperature,
        pressure: pressure,
        energy: energy,
        flowRate: flowRate
    });

    // Fuzzificar variáveis
    const fuzzyEff = fuzzyController.fuzzifyEfficiency(avgEff);
    const fuzzyWater = fuzzyController.fuzzifyWaterCut(waterCut);
    const fuzzyTemp = fuzzyController.fuzzifyTemperature(temperature);
    const fuzzyEnergy = fuzzyController.fuzzifyEnergy(energy);

    const html = `
        <div class="card">
            <h3>Sistema de Controle Fuzzy Avançado</h3>
            <div class="info-box">
                <strong>Sistema de Inferência Fuzzy</strong> —
                Utiliza 10 regras com fuzzificação de 6 variáveis para controle inteligente do processo.
            </div>
        </div>

        <div class="card">
            <h4>Decisão de Controle</h4>
            <div class="result-box" style="background: ${decision.action === 'emergency_shutdown' ? 'linear-gradient(135deg, var(--error) 0%, #dc2626 100%)' : 'linear-gradient(135deg, var(--success) 0%, #059669 100%)'};">
                ${decision.description}
                <div style="font-size: 0.85rem; margin-top: 0.5rem; opacity: 0.95;">
                    Confiança: ${(decision.confidence * 100).toFixed(1)}%
                </div>
            </div>

            ${decision.rule ? `
                <div class="info-box">
                    <strong>Regra Ativada:</strong> ${decision.rule}
                </div>
            ` : ''}

            ${decision.allRules && decision.allRules.length > 1 ? `
                <details style="margin-top: 1rem;">
                    <summary style="cursor: pointer; font-weight: 600; color: var(--gray-700);">
                        Ver todas as regras ativadas (${decision.allRules.length})
                    </summary>
                    <div style="margin-top: 0.5rem;">
                        ${decision.allRules.map(rule => `
                            <div class="formula-box" style="margin: 0.5rem 0;">
                                <strong>Regra ${rule.id}:</strong> ${rule.description}
                                <br><small>Ativação: ${(rule.activation * 100).toFixed(1)}% | Prioridade: ${rule.priority}</small>
                            </div>
                        `).join('')}
                    </div>
                </details>
            ` : ''}
        </div>

        <div class="charts-grid">
            <div class="card">
                <h4>Funções de Pertinência - Eficiência</h4>
                <div id="membershipEffChart"></div>
            </div>
            <div class="card">
                <h4>Funções de Pertinência - Corte de Água</h4>
                <div id="membershipWaterChart"></div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="card">
                <h4>Funções de Pertinência - Temperatura</h4>
                <div id="membershipTempChart"></div>
            </div>
            <div class="card">
                <h4>Funções de Pertinência - Energia</h4>
                <div id="membershipEnergyChart"></div>
            </div>
        </div>

        <div class="card">
            <h4>Fuzzificação das Variáveis Atuais</h4>
            <div class="status-grid">
                ${renderFuzzyValues('Eficiência', fuzzyEff, avgEff)}
                ${renderFuzzyValues('Corte de Água', fuzzyWater, waterCut)}
                ${renderFuzzyValues('Temperatura', fuzzyTemp, temperature)}
                ${renderFuzzyValues('Energia', fuzzyEnergy, energy)}
            </div>
        </div>

        <div class="card">
            <h4>Superfície de Controle 3D</h4>
            <div class="info-box">
                Visualização da superfície de controle fuzzy mostrando a relação entre Eficiência e Corte de Água.
            </div>
            <div id="controlSurfaceChart"></div>
        </div>

        <div class="card">
            <h4>Todas as Regras Fuzzy</h4>
            <div class="formulas-grid">
                ${fuzzyController.rules.map(rule => `
                    <div class="formula-box">
                        <strong>Regra ${rule.id} ${rule.priority === 0 ? '[CRIT]' : ''}</strong><br>
                        ${rule.description}
                        <br><small style="color: var(--gray-500);">Prioridade: ${rule.priority}</small>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    document.getElementById('fuzzy').innerHTML = html;

    // Renderizar gráficos
    renderMembershipFunctions();
    renderControlSurface();
}

// Renderizar valores fuzzy
function renderFuzzyValues(label, fuzzyValues, currentValue) {
    const maxKey = Object.keys(fuzzyValues).reduce((a, b) =>
        fuzzyValues[a] > fuzzyValues[b] ? a : b
    );

    return Object.entries(fuzzyValues).map(([key, value]) => {
        const percentage = (value * 100).toFixed(1);
        const isMax = key === maxKey && value > 0;

        return `
            <div class="status-item" style="${isMax ? 'border-left-color: var(--success); background: var(--gray-100);' : ''}">
                <strong>${label} - ${key.toUpperCase()}</strong>
                ${percentage}% ${isMax ? '✓' : ''}
                <div style="background: var(--gray-200); height: 6px; border-radius: 3px; margin-top: 0.25rem;">
                    <div style="background: ${isMax ? 'var(--success)' : 'var(--primary)'}; height: 100%; width: ${percentage}%; border-radius: 3px; transition: width 0.3s;"></div>
                </div>
            </div>
        `;
    }).join('');
}

// Renderizar funções de pertinência
function renderMembershipFunctions() {
    // Eficiência
    const effValues = [];
    for (let e = 0.7; e <= 1.0; e += 0.01) {
        const fuzzy = fuzzyController.fuzzifyEfficiency(e);
        effValues.push({
            x: e,
            low: fuzzy.low,
            medium: fuzzy.medium,
            high: fuzzy.high,
            very_low: fuzzy.very_low,
            very_high: fuzzy.very_high
        });
    }

    const tracesEff = [
        { x: effValues.map(v => v.x), y: effValues.map(v => v.very_low), name: 'Muito Baixa', line: { color: '#dc2626' } },
        { x: effValues.map(v => v.x), y: effValues.map(v => v.low), name: 'Baixa', line: { color: '#f59e0b' } },
        { x: effValues.map(v => v.x), y: effValues.map(v => v.medium), name: 'Média', line: { color: '#3b82f6' } },
        { x: effValues.map(v => v.x), y: effValues.map(v => v.high), name: 'Alta', line: { color: '#10b981' } },
        { x: effValues.map(v => v.x), y: effValues.map(v => v.very_high), name: 'Muito Alta', line: { color: '#059669' } }
    ];

    Plotly.newPlot('membershipEffChart', tracesEff, {
        xaxis: { title: 'Eficiência' },
        yaxis: { title: 'Grau de Pertinência', range: [0, 1] },
        height: 300,
        margin: { t: 10, b: 40, l: 60, r: 20 }
    }, { responsive: true });

    // Corte de Água
    const waterValues = [];
    for (let w = 0; w <= 100; w += 2) {
        const fuzzy = fuzzyController.fuzzifyWaterCut(w);
        waterValues.push({
            x: w,
            low: fuzzy.low,
            medium: fuzzy.medium,
            high: fuzzy.high,
            very_high: fuzzy.very_high
        });
    }

    const tracesWater = [
        { x: waterValues.map(v => v.x), y: waterValues.map(v => v.low), name: 'Baixo', line: { color: '#10b981' } },
        { x: waterValues.map(v => v.x), y: waterValues.map(v => v.medium), name: 'Médio', line: { color: '#3b82f6' } },
        { x: waterValues.map(v => v.x), y: waterValues.map(v => v.high), name: 'Alto', line: { color: '#f59e0b' } },
        { x: waterValues.map(v => v.x), y: waterValues.map(v => v.very_high), name: 'Muito Alto', line: { color: '#dc2626' } }
    ];

    Plotly.newPlot('membershipWaterChart', tracesWater, {
        xaxis: { title: 'Corte de Água (%)' },
        yaxis: { title: 'Grau de Pertinência', range: [0, 1] },
        height: 300,
        margin: { t: 10, b: 40, l: 60, r: 20 }
    }, { responsive: true });

    // Temperatura
    const tempValues = [];
    for (let t = 30; t <= 100; t += 2) {
        const fuzzy = fuzzyController.fuzzifyTemperature(t);
        tempValues.push({
            x: t,
            very_low: fuzzy.very_low,
            low: fuzzy.low,
            normal: fuzzy.normal,
            high: fuzzy.high,
            very_high: fuzzy.very_high
        });
    }

    const tracesTemp = [
        { x: tempValues.map(v => v.x), y: tempValues.map(v => v.very_low), name: 'Muito Baixa', line: { color: '#3b82f6' } },
        { x: tempValues.map(v => v.x), y: tempValues.map(v => v.low), name: 'Baixa', line: { color: '#10b981' } },
        { x: tempValues.map(v => v.x), y: tempValues.map(v => v.normal), name: 'Normal', line: { color: '#f59e0b' } },
        { x: tempValues.map(v => v.x), y: tempValues.map(v => v.high), name: 'Alta', line: { color: '#dc2626' } },
        { x: tempValues.map(v => v.x), y: tempValues.map(v => v.very_high), name: 'Muito Alta', line: { color: '#991b1b' } }
    ];

    Plotly.newPlot('membershipTempChart', tracesTemp, {
        xaxis: { title: 'Temperatura (°C)' },
        yaxis: { title: 'Grau de Pertinência', range: [0, 1] },
        height: 300,
        margin: { t: 10, b: 40, l: 60, r: 20 }
    }, { responsive: true });

    // Energia
    const energyValues = [];
    for (let e = 1; e <= 5; e += 0.1) {
        const fuzzy = fuzzyController.fuzzifyEnergy(e);
        energyValues.push({
            x: e,
            very_low: fuzzy.very_low,
            low: fuzzy.low,
            normal: fuzzy.normal,
            high: fuzzy.high,
            very_high: fuzzy.very_high
        });
    }

    const tracesEnergy = [
        { x: energyValues.map(v => v.x), y: energyValues.map(v => v.very_low), name: 'Muito Baixa', line: { color: '#059669' } },
        { x: energyValues.map(v => v.x), y: energyValues.map(v => v.low), name: 'Baixa', line: { color: '#10b981' } },
        { x: energyValues.map(v => v.x), y: energyValues.map(v => v.normal), name: 'Normal', line: { color: '#3b82f6' } },
        { x: energyValues.map(v => v.x), y: energyValues.map(v => v.high), name: 'Alta', line: { color: '#f59e0b' } },
        { x: energyValues.map(v => v.x), y: energyValues.map(v => v.very_high), name: 'Muito Alta', line: { color: '#dc2626' } }
    ];

    Plotly.newPlot('membershipEnergyChart', tracesEnergy, {
        xaxis: { title: 'Energia (MWh/1000m³)' },
        yaxis: { title: 'Grau de Pertinência', range: [0, 1] },
        height: 300,
        margin: { t: 10, b: 40, l: 60, r: 20 }
    }, { responsive: true });
}

// Renderizar superfície de controle
function renderControlSurface() {
    const steps = 20;
    const effRange = [0.75, 0.99];
    const waterRange = [15, 78];

    const { flowRate, pressure, temperature, energy } = currentParams;

    const surface = fuzzyController.generateControlSurface(
        'efficiency', effRange,
        'waterCut', waterRange,
        { flowRate, pressure, temperature, energy }
    );

    const xValues = [];
    const yValues = [];
    for (let i = 0; i <= steps; i++) {
        xValues.push(effRange[0] + (i / steps) * (effRange[1] - effRange[0]));
        yValues.push(waterRange[0] + (i / steps) * (waterRange[1] - waterRange[0]));
    }

    const trace = {
        type: 'surface',
        x: xValues,
        y: yValues,
        z: surface,
        colorscale: 'Viridis',
        colorbar: {
            title: 'Confiança'
        }
    };

    const layout = {
        scene: {
            xaxis: { title: 'Eficiência' },
            yaxis: { title: 'Corte de Água (%)' },
            zaxis: { title: 'Confiança da Decisão' }
        },
        height: 500,
        margin: { t: 20, b: 20, l: 20, r: 20 }
    };

    Plotly.newPlot('controlSurfaceChart', [trace], layout, { responsive: true });
}

// Renderizar Análise Econômica
function renderEconomic() {
    const html = `
        <h3>Analise Economica - Dados Manuais</h3>

        <div class="info-box" style="margin-bottom:1rem;">
            <strong>Todos os valores devem ser inseridos manualmente</strong> com base nos dados reais da sua planta/projeto. Os valores padrao sao apenas referencias iniciais.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
            <div class="card">
                <h4>Investimento e Financeiro</h4>
                <label>Investimento Total (USD):</label>
                <input type="number" id="econ_investment" value="450000" step="10000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
                <label>Taxa de Desconto (%/ano):</label>
                <input type="number" id="econ_discount" value="12" step="0.5" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
                <label>Horizonte (anos):</label>
                <input type="number" id="econ_years" value="15" step="1" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
            </div>
            <div class="card">
                <h4>Receitas Anuais (USD/ano)</h4>
                <label>Receita Adicional de Oleo:</label>
                <input type="number" id="econ_revenue_oil" value="120000" step="5000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
                <label>Receita de Gas Natural:</label>
                <input type="number" id="econ_revenue_gas" value="50000" step="5000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
                <label>Outras Receitas:</label>
                <input type="number" id="econ_revenue_other" value="0" step="5000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
            <div class="card">
                <h4>Economias Anuais (USD/ano)</h4>
                <label>Economia de Energia:</label>
                <input type="number" id="econ_save_energy" value="30000" step="1000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
                <label>Economia de Quimicos:</label>
                <input type="number" id="econ_save_chem" value="15000" step="1000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
                <label>Economia de Manutencao:</label>
                <input type="number" id="econ_save_maint" value="20000" step="1000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
                <label>Economia Tratamento Agua:</label>
                <input type="number" id="econ_save_water" value="10000" step="1000" style="width:100%;padding:6px;margin-bottom:8px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;">
            </div>
            <div class="card">
                <h4>Resultados</h4>
                <div id="econResults" style="font-size:0.95rem;"></div>
            </div>
        </div>

        <button onclick="calculateEconomics()" style="padding:10px 24px;background:var(--accent);color:white;border:none;border-radius:4px;cursor:pointer;font-size:1rem;margin-bottom:1rem;">Calcular VPL / TIR / Payback</button>

        <div class="chart-container">
            <div id="economicChart"></div>
        </div>
    `;

    document.getElementById('economic').innerHTML = html;
}

function calculateEconomics() {
    const investment = parseFloat(document.getElementById('econ_investment').value) || 0;
    const discountRate = (parseFloat(document.getElementById('econ_discount').value) || 12) / 100;
    const years = parseInt(document.getElementById('econ_years').value) || 15;

    const revOil = parseFloat(document.getElementById('econ_revenue_oil').value) || 0;
    const revGas = parseFloat(document.getElementById('econ_revenue_gas').value) || 0;
    const revOther = parseFloat(document.getElementById('econ_revenue_other').value) || 0;
    const saveEnergy = parseFloat(document.getElementById('econ_save_energy').value) || 0;
    const saveChem = parseFloat(document.getElementById('econ_save_chem').value) || 0;
    const saveMaint = parseFloat(document.getElementById('econ_save_maint').value) || 0;
    const saveWater = parseFloat(document.getElementById('econ_save_water').value) || 0;

    const totalBenefits = revOil + revGas + revOther + saveEnergy + saveChem + saveMaint + saveWater;

    // VPL
    let npv = -investment;
    for (let t = 1; t <= years; t++) {
        npv += totalBenefits / Math.pow(1 + discountRate, t);
    }

    // Payback simples
    const payback = totalBenefits > 0 ? investment / totalBenefits : Infinity;

    // TIR (bisecao)
    let irr = 0;
    if (totalBenefits > 0) {
        let lo = -0.5, hi = 5.0;
        for (let iter = 0; iter < 100; iter++) {
            const mid = (lo + hi) / 2;
            let npvTest = -investment;
            for (let t = 1; t <= years; t++) npvTest += totalBenefits / Math.pow(1 + mid, t);
            if (npvTest > 0) lo = mid; else hi = mid;
        }
        irr = (lo + hi) / 2;
    }

    // ROI descontado 10 anos
    let npv10 = 0;
    for (let t = 1; t <= Math.min(10, years); t++) npv10 += totalBenefits / Math.pow(1 + discountRate, t);
    const roi = investment > 0 ? ((npv10 - investment) / investment * 100) : 0;

    const resultsDiv = document.getElementById('econResults');
    resultsDiv.innerHTML = `
        <div class="metrics-grid" style="grid-template-columns:1fr 1fr;">
            <div class="metric-card">
                <div class="metric-label">Beneficio Anual Total</div>
                <div class="metric-value" style="color:var(--success)">$${totalBenefits.toLocaleString()}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">VPL (${years} anos)</div>
                <div class="metric-value" style="color:${npv>=0?'var(--success)':'var(--error)'}">$${Math.round(npv).toLocaleString()}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">TIR</div>
                <div class="metric-value">${(irr*100).toFixed(1)}%</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Payback</div>
                <div class="metric-value">${payback < 50 ? payback.toFixed(1)+' anos' : '>50 anos'}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">ROI (10 anos)</div>
                <div class="metric-value">${roi.toFixed(1)}%</div>
            </div>
        </div>
    `;

    // Grafico de fluxo de caixa acumulado
    const yearsRange = [];
    const cumulative = [];
    let running = -investment;
    yearsRange.push(0);
    cumulative.push(running);
    for (let t = 1; t <= years; t++) {
        running += totalBenefits;
        yearsRange.push(t);
        cumulative.push(running);
    }

    const trace1 = {
        x: yearsRange, y: cumulative,
        mode: 'lines+markers', name: 'Fluxo Acumulado',
        line: { color: '#2ca02c', width: 3 },
        fill: 'tozeroy', fillcolor: 'rgba(44,160,44,0.15)'
    };

    Plotly.newPlot('economicChart', [trace1], {
        title: `Fluxo de Caixa Acumulado (${years} anos)`,
        xaxis: { title: 'Ano' },
        yaxis: { title: 'Valor (USD)' },
        height: 400,
        shapes: [{ type: 'line', x0: 0, x1: years, y0: 0, y1: 0, line: { color: 'red', dash: 'dash' } }]
    }, { responsive: true });
}

// Renderizar Calculadora Avançada
function renderCalculator() {
    const html = `
        <div class="card">
            <h3>Fórmulas Fundamentais</h3>
            <div class="formulas-grid">
                <div class="formula-card">
                    <strong>Número de Reynolds</strong>
                    <div class="formula">Re = ρvD/μ</div>
                </div>
                <div class="formula-card">
                    <strong>Número de Weber</strong>
                    <div class="formula">We = ρv²L/σ</div>
                </div>
                <div class="formula-card">
                    <strong>Número de Bond</strong>
                    <div class="formula">Bo = Δρ·g·L²/σ</div>
                </div>
                <div class="formula-card">
                    <strong>Número Capilar</strong>
                    <div class="formula">Ca = μv/σ</div>
                </div>
            </div>
        </div>

        <div class="calculator-grid">
            <div class="card">
                <h4>Número de Reynolds</h4>
                <div class="input-group">
                    <label>Densidade (kg/m³)</label>
                    <input type="number" id="rhoReynolds" value="870" step="1">
                </div>
                <div class="input-group">
                    <label>Velocidade (m/s)</label>
                    <input type="number" id="velReynolds" value="1.2" step="0.1">
                </div>
                <div class="input-group">
                    <label>Diâmetro (m)</label>
                    <input type="number" id="diaReynolds" value="0.8" step="0.1">
                </div>
                <div class="input-group">
                    <label>Viscosidade (Pa.s)</label>
                    <input type="number" id="muReynolds" value="0.015" step="0.001">
                </div>
                <button onclick="calculateReynolds()">Calcular Reynolds</button>
                <div id="reynoldsResult"></div>
            </div>

            <div class="card">
                <h4>Número de Weber</h4>
                <div class="input-group">
                    <label>Densidade (kg/m³)</label>
                    <input type="number" id="rhoWeber" value="870" step="1">
                </div>
                <div class="input-group">
                    <label>Velocidade (m/s)</label>
                    <input type="number" id="velWeber" value="1.2" step="0.1">
                </div>
                <div class="input-group">
                    <label>Comprimento (m)</label>
                    <input type="number" id="lengthWeber" value="0.01" step="0.001">
                </div>
                <div class="input-group">
                    <label>Tensão Superficial (N/m)</label>
                    <input type="number" id="sigmaWeber" value="0.025" step="0.001">
                </div>
                <button onclick="calculateWeber()">Calcular Weber</button>
                <div id="weberResult"></div>
            </div>
        </div>
    `;

    document.getElementById('calculator').innerHTML = html;
}

function calculateReynolds() {
    const rho = parseFloat(document.getElementById('rhoReynolds').value);
    const vel = parseFloat(document.getElementById('velReynolds').value);
    const dia = parseFloat(document.getElementById('diaReynolds').value);
    const mu = parseFloat(document.getElementById('muReynolds').value);

    const reynolds = separatorModel.reynoldsNumber(vel, dia, rho, mu);

    let flowType, color;
    if (reynolds < 2300) {
        flowType = 'Laminar';
        color = 'blue';
    } else if (reynolds > 4000) {
        flowType = 'Turbulento';
        color = 'red';
    } else {
        flowType = 'Transição';
        color = 'orange';
    }

    const html = `
        <div class="result-box">
            Re = ${reynolds.toFixed(0)}
        </div>
        <div style="color: ${color}; font-weight: bold; margin-top: 10px;">
            Regime: ${flowType}
        </div>
    `;

    document.getElementById('reynoldsResult').innerHTML = html;
}

function calculateWeber() {
    const rho = parseFloat(document.getElementById('rhoWeber').value);
    const vel = parseFloat(document.getElementById('velWeber').value);
    const length = parseFloat(document.getElementById('lengthWeber').value);
    const sigma = parseFloat(document.getElementById('sigmaWeber').value);

    const weber = separatorModel.weberNumber(vel, length, rho, sigma);

    let behavior, color;
    if (weber < 1) {
        behavior = 'Gotas estáveis';
        color = 'green';
    } else if (weber < 10) {
        behavior = 'Deformação moderada';
        color = 'orange';
    } else {
        behavior = 'Fragmentação de gotas';
        color = 'red';
    }

    const html = `
        <div class="result-box">
            We = ${weber.toFixed(2)}
        </div>
        <div style="color: ${color}; font-weight: bold; margin-top: 10px;">
            ${behavior}
        </div>
    `;

    document.getElementById('weberResult').innerHTML = html;
}

// ============================================================================
// COMPARAÇÃO DE MODELOS - MLP vs MODELO FÍSICO
// ============================================================================

// Métricas estatísticas
function calcRMSE(predicted, actual) {
    const n = predicted.length;
    const sumSq = predicted.reduce((sum, p, i) => sum + Math.pow(p - actual[i], 2), 0);
    return Math.sqrt(sumSq / n);
}

function calcMAE(predicted, actual) {
    const n = predicted.length;
    return predicted.reduce((sum, p, i) => sum + Math.abs(p - actual[i]), 0) / n;
}

function calcR2(predicted, actual) {
    const n = actual.length;
    const mean = actual.reduce((s, v) => s + v, 0) / n;
    const ssTot = actual.reduce((s, v) => s + Math.pow(v - mean, 2), 0);
    const ssRes = predicted.reduce((s, p, i) => s + Math.pow(actual[i] - p, 2), 0);
    return 1 - ssRes / ssTot;
}

function calcMAPE(predicted, actual) {
    const n = predicted.length;
    return (predicted.reduce((sum, p, i) => sum + Math.abs((actual[i] - p) / actual[i]), 0) / n) * 100;
}

// Gerar dados de teste (diferentes do treino)
function generateTestData(nSamples = 200) {
    const data = { inputs: [], physicalOutputs: { effGL: [], effOA: [], energy: [] } };

    for (let i = 0; i < nSamples; i++) {
        const flowRate = 150 + Math.random() * (2400 - 150);
        const pressure = 8.5 + Math.random() * (15.2 - 8.5);
        const temperature = 45 + Math.random() * (85 - 45);
        const waterCut = 15 + Math.random() * (78 - 15);
        const gor = 45 + Math.random() * (180 - 45);
        const viscosity = 10 + Math.random() * (30 - 10);

        data.inputs.push([flowRate, pressure, temperature, waterCut, gor, viscosity]);
        data.physicalOutputs.effGL.push(separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor));
        data.physicalOutputs.effOA.push(separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity));
        data.physicalOutputs.energy.push(separatorModel.energyConsumption(flowRate, pressure, temperature));
    }

    return data;
}

// Executar comparação completa
async function runModelComparison() {
    const resultsDiv = document.getElementById('comparisonResults');
    const runBtn = document.getElementById('runComparisonBtn');

    if (!nnPredictor.isTrained) {
        resultsDiv.innerHTML = `
            <div class="warning-box">
                <strong>Rede Neural não treinada.</strong> Vá à aba "Redes Neurais" e treine o modelo primeiro.
            </div>`;
        return;
    }

    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="loading"></span> Executando comparação...';
    resultsDiv.innerHTML = '<div class="info-box">Gerando dados de teste e executando predições...</div>';

    try {
        const testData = generateTestData(200);
        const nnPredictions = { effGL: [], effOA: [], energy: [] };

        // Executar predições da rede neural
        for (let i = 0; i < testData.inputs.length; i++) {
            const pred = await nnPredictor.predict(testData.inputs[i]);
            nnPredictions.effGL.push(pred[0]);
            nnPredictions.effOA.push(pred[1]);
            nnPredictions.energy.push(pred[2]);
        }

        const physical = testData.physicalOutputs;

        // Calcular métricas para cada variável de saída
        const metrics = {
            effGL: {
                label: 'Eficiência G-L',
                unit: '%',
                rmse: calcRMSE(nnPredictions.effGL, physical.effGL),
                mae: calcMAE(nnPredictions.effGL, physical.effGL),
                r2: calcR2(nnPredictions.effGL, physical.effGL),
                mape: calcMAPE(nnPredictions.effGL, physical.effGL),
                predicted: nnPredictions.effGL,
                actual: physical.effGL
            },
            effOA: {
                label: 'Eficiência O-A',
                unit: '%',
                rmse: calcRMSE(nnPredictions.effOA, physical.effOA),
                mae: calcMAE(nnPredictions.effOA, physical.effOA),
                r2: calcR2(nnPredictions.effOA, physical.effOA),
                mape: calcMAPE(nnPredictions.effOA, physical.effOA),
                predicted: nnPredictions.effOA,
                actual: physical.effOA
            },
            energy: {
                label: 'Consumo Energético',
                unit: 'MWh',
                rmse: calcRMSE(nnPredictions.energy, physical.energy),
                mae: calcMAE(nnPredictions.energy, physical.energy),
                r2: calcR2(nnPredictions.energy, physical.energy),
                mape: calcMAPE(nnPredictions.energy, physical.energy),
                predicted: nnPredictions.energy,
                actual: physical.energy
            }
        };

        // Renderizar resultados completos
        renderComparisonResults(metrics, testData.inputs.length);

    } catch (error) {
        resultsDiv.innerHTML = `<div class="warning-box"><strong>Erro:</strong> ${error.message}</div>`;
    }

    runBtn.disabled = false;
    runBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:3px"><polygon points="3,1 13,8 3,15"/></svg> Executar Comparação';
}

// Renderizar resultados da comparação
function renderComparisonResults(metrics, nSamples) {
    const resultsDiv = document.getElementById('comparisonResults');

    // Classificar qualidade do R²
    function r2Quality(r2) {
        if (r2 >= 0.99) return { text: 'Excelente', color: 'var(--success)', icon: '🟢' };
        if (r2 >= 0.95) return { text: 'Muito Bom', color: 'var(--success)', icon: '🟢' };
        if (r2 >= 0.90) return { text: 'Bom', color: 'var(--warning)', icon: '🟡' };
        if (r2 >= 0.80) return { text: 'Moderado', color: 'var(--warning)', icon: '🟡' };
        return { text: 'Fraco', color: 'var(--error)', icon: '🔴' };
    }

    const avgR2 = (metrics.effGL.r2 + metrics.effOA.r2 + metrics.energy.r2) / 3;
    const overallQuality = r2Quality(avgR2);

    let html = `
        <div class="success-box">
            <strong>Comparação concluída</strong> - ${nSamples} amostras de teste avaliadas
        </div>

        <!-- Resumo Geral -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Resumo Geral da Performance do Modelo Neural</h4>
            <div class="result-box" style="text-align: center;">
                <div style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">
                    ${overallQuality.icon} R² Médio = ${avgR2.toFixed(4)}
                </div>
                <div style="font-size: 0.9rem; color: ${overallQuality.color}; font-weight: 600;">
                    Classificação: ${overallQuality.text}
                </div>
                <div style="font-size: 0.8rem; margin-top: 0.5rem; opacity: 0.8;">
                    A rede neural ${avgR2 >= 0.95 ? 'reproduz com alta fidelidade' : avgR2 >= 0.90 ? 'captura adequadamente' : 'apresenta limitações em capturar'}
                    o comportamento do modelo físico do separador
                </div>
            </div>
        </div>

        <!-- Tabela de Métricas -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Métricas Estatísticas por Variável de Saída</h4>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: var(--font-size-sm);">
                    <thead>
                        <tr style="border-bottom: 2px solid var(--border-color);">
                            <th style="padding: 0.75rem; text-align: left; color: var(--text-bright);">Variável</th>
                            <th style="padding: 0.75rem; text-align: center; color: var(--syntax-blue);">RMSE</th>
                            <th style="padding: 0.75rem; text-align: center; color: var(--syntax-teal);">MAE</th>
                            <th style="padding: 0.75rem; text-align: center; color: var(--syntax-purple);">R²</th>
                            <th style="padding: 0.75rem; text-align: center; color: var(--syntax-orange);">MAPE (%)</th>
                            <th style="padding: 0.75rem; text-align: center;">Qualidade</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.values(metrics).map(m => {
                            const q = r2Quality(m.r2);
                            return `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 0.75rem; font-weight: 600; color: var(--text-bright);">${m.label}</td>
                                <td style="padding: 0.75rem; text-align: center; font-family: var(--font-family);">${m.rmse.toFixed(6)}</td>
                                <td style="padding: 0.75rem; text-align: center; font-family: var(--font-family);">${m.mae.toFixed(6)}</td>
                                <td style="padding: 0.75rem; text-align: center; font-weight: 700; color: ${q.color};">${m.r2.toFixed(4)}</td>
                                <td style="padding: 0.75rem; text-align: center; font-family: var(--font-family);">${m.mape.toFixed(2)}%</td>
                                <td style="padding: 0.75rem; text-align: center;">${q.icon} ${q.text}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Explicação das Métricas -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Interpretação das Métricas</h4>
            <div class="formulas-grid">
                <div class="formula-card">
                    <strong style="color: var(--syntax-blue);">RMSE</strong>
                    <div class="formula">√(Σ(ŷᵢ - yᵢ)² / n)</div>
                    <div style="font-size: 0.75rem; margin-top: 0.3rem;">Raiz do Erro Quadrático Médio - penaliza grandes desvios</div>
                </div>
                <div class="formula-card">
                    <strong style="color: var(--syntax-teal);">MAE</strong>
                    <div class="formula">Σ|ŷᵢ - yᵢ| / n</div>
                    <div style="font-size: 0.75rem; margin-top: 0.3rem;">Erro Absoluto Médio - desvio médio das predições</div>
                </div>
                <div class="formula-card">
                    <strong style="color: var(--syntax-purple);">R²</strong>
                    <div class="formula">1 - SS_res / SS_tot</div>
                    <div style="font-size: 0.75rem; margin-top: 0.3rem;">Coeficiente de Determinação - quanto da variância é explicada (0 a 1)</div>
                </div>
                <div class="formula-card">
                    <strong style="color: var(--syntax-orange);">MAPE</strong>
                    <div class="formula">Σ|yᵢ - ŷᵢ|/|yᵢ| × 100/n</div>
                    <div style="font-size: 0.75rem; margin-top: 0.3rem;">Erro Percentual Absoluto Médio - erro relativo em %</div>
                </div>
            </div>
        </div>

        <!-- Gráficos de Scatter (Predito vs Real) -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Gráficos de Dispersão: Predição MLP vs Modelo Físico</h4>
            <div class="info-box">
                Pontos mais próximos da linha diagonal (y = x) indicam melhor concordância entre a rede neural e o modelo físico.
            </div>
            <div class="charts-grid">
                <div><div id="scatterGL"></div></div>
                <div><div id="scatterOA"></div></div>
            </div>
            <div><div id="scatterEnergy"></div></div>
        </div>

        <!-- Gráfico de Barras das Métricas -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Comparação Visual das Métricas</h4>
            <div id="metricsBarChart"></div>
        </div>

        <!-- Histograma de Erros -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Distribuição dos Erros (Resíduos)</h4>
            <div class="info-box">
                Uma distribuição centrada em zero e com forma gaussiana indica que o modelo neural não tem viés sistemático.
            </div>
            <div class="charts-grid">
                <div><div id="errorHistGL"></div></div>
                <div><div id="errorHistOA"></div></div>
            </div>
            <div><div id="errorHistEnergy"></div></div>
        </div>

        <!-- Gráfico de Resíduos -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Resíduos vs Valor Predito</h4>
            <div class="info-box">
                Resíduos aleatoriamente distribuídos em torno de zero indicam que o modelo não tem viés dependente da magnitude.
            </div>
            <div class="charts-grid">
                <div><div id="residualGL"></div></div>
                <div><div id="residualOA"></div></div>
            </div>
            <div><div id="residualEnergy"></div></div>
        </div>

        <!-- Conclusão -->
        <div class="card" style="margin-top: 1rem;">
            <h4>Conclusão da Análise Comparativa</h4>
            <div class="result-box">
                <p><strong>Modelo Neural (MLP 6→64→32→16→3):</strong></p>
                <ul style="margin: 0.5rem 0; padding-left: 1.5rem;">
                    <li>Eficiência G-L: R² = ${metrics.effGL.r2.toFixed(4)}, MAPE = ${metrics.effGL.mape.toFixed(2)}%</li>
                    <li>Eficiência O-A: R² = ${metrics.effOA.r2.toFixed(4)}, MAPE = ${metrics.effOA.mape.toFixed(2)}%</li>
                    <li>Consumo Energético: R² = ${metrics.energy.r2.toFixed(4)}, MAPE = ${metrics.energy.mape.toFixed(2)}%</li>
                </ul>
                <p style="margin-top: 0.5rem;">
                    ${avgR2 >= 0.95
                        ? 'A rede neural demonstra capacidade de substituir o modelo físico com alta precisão, validando a aplicação de IA na otimização do separador de produção.'
                        : avgR2 >= 0.90
                        ? 'A rede neural apresenta boa capacidade de generalização, podendo ser utilizada como modelo surrogate para otimização em tempo real.'
                        : 'O modelo neural necessita de mais dados de treino ou ajuste de hiperparâmetros para melhorar a precisão.'}
                </p>
            </div>
        </div>
    `;

    resultsDiv.innerHTML = html;

    // Renderizar todos os gráficos
    renderScatterPlots(metrics);
    renderMetricsBarChart(metrics);
    renderErrorHistograms(metrics);
    renderResidualPlots(metrics);
}

// Gráficos de dispersão (Predito vs Real)
function renderScatterPlots(metrics) {
    const plotlyLayout = (title, axisLabel) => ({
        title: { text: title, font: { size: 14 } },
        xaxis: { title: 'Modelo Físico (' + axisLabel + ')' },
        yaxis: { title: 'Predição MLP (' + axisLabel + ')' },
        height: 380,
        margin: { t: 40, b: 50, l: 60, r: 20 },
        shapes: [{
            type: 'line', x0: 0, y0: 0, x1: 1, y1: 1,
            xref: 'paper', yref: 'paper',
            line: { color: '#f14c4c', width: 2, dash: 'dash' }
        }]
    });

    // Eficiência G-L
    const m = metrics.effGL;
    Plotly.newPlot('scatterGL', [{
        x: m.actual, y: m.predicted,
        mode: 'markers',
        type: 'scatter',
        marker: { color: '#569cd6', size: 5, opacity: 0.6 },
        name: `R² = ${m.r2.toFixed(4)}`
    }], {
        ...plotlyLayout('Eficiência Gás-Líquido', 'fração'),
        xaxis: { title: 'Modelo Físico', range: [Math.min(...m.actual) - 0.01, Math.max(...m.actual) + 0.01] },
        yaxis: { title: 'Predição MLP', range: [Math.min(...m.predicted) - 0.01, Math.max(...m.predicted) + 0.01] },
        shapes: [{
            type: 'line',
            x0: Math.min(...m.actual), y0: Math.min(...m.actual),
            x1: Math.max(...m.actual), y1: Math.max(...m.actual),
            line: { color: '#f14c4c', width: 2, dash: 'dash' }
        }]
    }, { responsive: true });

    // Eficiência O-A
    const mOA = metrics.effOA;
    Plotly.newPlot('scatterOA', [{
        x: mOA.actual, y: mOA.predicted,
        mode: 'markers',
        type: 'scatter',
        marker: { color: '#4ec9b0', size: 5, opacity: 0.6 },
        name: `R² = ${mOA.r2.toFixed(4)}`
    }], {
        ...plotlyLayout('Eficiência Óleo-Água', 'fração'),
        xaxis: { title: 'Modelo Físico', range: [Math.min(...mOA.actual) - 0.01, Math.max(...mOA.actual) + 0.01] },
        yaxis: { title: 'Predição MLP', range: [Math.min(...mOA.predicted) - 0.01, Math.max(...mOA.predicted) + 0.01] },
        shapes: [{
            type: 'line',
            x0: Math.min(...mOA.actual), y0: Math.min(...mOA.actual),
            x1: Math.max(...mOA.actual), y1: Math.max(...mOA.actual),
            line: { color: '#f14c4c', width: 2, dash: 'dash' }
        }]
    }, { responsive: true });

    // Energia
    const mE = metrics.energy;
    Plotly.newPlot('scatterEnergy', [{
        x: mE.actual, y: mE.predicted,
        mode: 'markers',
        type: 'scatter',
        marker: { color: '#ce9178', size: 5, opacity: 0.6 },
        name: `R² = ${mE.r2.toFixed(4)}`
    }], {
        ...plotlyLayout('Consumo Energético', 'MWh/1000m³'),
        xaxis: { title: 'Modelo Físico', range: [Math.min(...mE.actual) - 0.1, Math.max(...mE.actual) + 0.1] },
        yaxis: { title: 'Predição MLP', range: [Math.min(...mE.predicted) - 0.1, Math.max(...mE.predicted) + 0.1] },
        shapes: [{
            type: 'line',
            x0: Math.min(...mE.actual), y0: Math.min(...mE.actual),
            x1: Math.max(...mE.actual), y1: Math.max(...mE.actual),
            line: { color: '#f14c4c', width: 2, dash: 'dash' }
        }]
    }, { responsive: true });
}

// Gráfico de barras das métricas R²
function renderMetricsBarChart(metrics) {
    const labels = ['Eficiência G-L', 'Eficiência O-A', 'Consumo Energético'];
    const r2Values = [metrics.effGL.r2, metrics.effOA.r2, metrics.energy.r2];
    const mapeValues = [metrics.effGL.mape, metrics.effOA.mape, metrics.energy.mape];

    const traceR2 = {
        x: labels, y: r2Values,
        type: 'bar', name: 'R²',
        marker: { color: '#c586c0' },
        text: r2Values.map(v => v.toFixed(4)),
        textposition: 'outside'
    };

    const traceMAPE = {
        x: labels, y: mapeValues,
        type: 'bar', name: 'MAPE (%)',
        marker: { color: '#ce9178' },
        text: mapeValues.map(v => v.toFixed(2) + '%'),
        textposition: 'outside',
        yaxis: 'y2'
    };

    Plotly.newPlot('metricsBarChart', [traceR2, traceMAPE], {
        title: { text: 'R² e MAPE por Variável de Saída', font: { size: 14 } },
        barmode: 'group',
        yaxis: { title: 'R²', range: [0, 1.15] },
        yaxis2: {
            title: 'MAPE (%)', overlaying: 'y', side: 'right',
            range: [0, Math.max(...mapeValues) * 1.5]
        },
        height: 400,
        margin: { t: 40, b: 60, l: 60, r: 60 },
        shapes: [{
            type: 'line', x0: -0.5, x1: 2.5, y0: 0.95, y1: 0.95,
            line: { color: '#4ec9b0', width: 2, dash: 'dot' }
        }],
        annotations: [{
            x: 2.5, y: 0.95, text: 'R² = 0.95 (ref.)',
            showarrow: false, xanchor: 'left',
            font: { size: 10, color: '#4ec9b0' }
        }]
    }, { responsive: true });
}

// Histogramas de erros
function renderErrorHistograms(metrics) {
    const renderHist = (divId, m, color, title) => {
        const errors = m.predicted.map((p, i) => p - m.actual[i]);
        const meanErr = errors.reduce((s, e) => s + e, 0) / errors.length;

        Plotly.newPlot(divId, [{
            x: errors, type: 'histogram',
            nbinsx: 30,
            marker: { color: color, line: { color: '#ffffff', width: 0.5 } },
            opacity: 0.8,
            name: 'Resíduos'
        }], {
            title: { text: title, font: { size: 13 } },
            xaxis: { title: 'Erro (Predito - Real)' },
            yaxis: { title: 'Frequência' },
            height: 350,
            margin: { t: 40, b: 50, l: 50, r: 20 },
            shapes: [{
                type: 'line', x0: 0, x1: 0, y0: 0, y1: 1,
                yref: 'paper',
                line: { color: '#f14c4c', width: 2, dash: 'dash' }
            }, {
                type: 'line', x0: meanErr, x1: meanErr, y0: 0, y1: 1,
                yref: 'paper',
                line: { color: '#4ec9b0', width: 2 }
            }],
            annotations: [{
                x: meanErr, y: 1, yref: 'paper',
                text: `μ = ${meanErr.toExponential(2)}`,
                showarrow: true, arrowhead: 2,
                font: { size: 10, color: '#4ec9b0' }
            }]
        }, { responsive: true });
    };

    renderHist('errorHistGL', metrics.effGL, '#569cd6', 'Distribuição Resíduos - Eficiência G-L');
    renderHist('errorHistOA', metrics.effOA, '#4ec9b0', 'Distribuição Resíduos - Eficiência O-A');
    renderHist('errorHistEnergy', metrics.energy, '#ce9178', 'Distribuição Resíduos - Energia');
}

// Gráficos de resíduos vs valor predito
function renderResidualPlots(metrics) {
    const renderResidual = (divId, m, color, title) => {
        const residuals = m.predicted.map((p, i) => p - m.actual[i]);

        Plotly.newPlot(divId, [{
            x: m.predicted, y: residuals,
            mode: 'markers', type: 'scatter',
            marker: { color: color, size: 5, opacity: 0.6 },
            name: 'Resíduos'
        }], {
            title: { text: title, font: { size: 13 } },
            xaxis: { title: 'Valor Predito' },
            yaxis: { title: 'Resíduo (Predito - Real)' },
            height: 350,
            margin: { t: 40, b: 50, l: 60, r: 20 },
            shapes: [{
                type: 'line',
                x0: Math.min(...m.predicted), x1: Math.max(...m.predicted),
                y0: 0, y1: 0,
                line: { color: '#f14c4c', width: 2, dash: 'dash' }
            }]
        }, { responsive: true });
    };

    renderResidual('residualGL', metrics.effGL, '#569cd6', 'Resíduos - Eficiência G-L');
    renderResidual('residualOA', metrics.effOA, '#4ec9b0', 'Resíduos - Eficiência O-A');
    renderResidual('residualEnergy', metrics.energy, '#ce9178', 'Resíduos - Energia');
}

// Renderizar aba de Comparação
function renderComparison() {
    const trainedStatus = nnPredictor.isTrained
        ? '<div class="success-box"><strong>Rede Neural treinada</strong> - Pronta para comparação</div>'
        : '<div class="warning-box"><strong>Rede Neural não treinada</strong> - Treine o modelo na aba "Redes Neurais" antes de executar a comparação</div>';

    const html = `
        <div class="card">
            <h3>Comparação de Modelos: MLP vs Modelo Físico</h3>
            <div class="info-box">
                <strong>Objetivo:</strong> Avaliar quantitativamente se a Rede Neural (MLP) consegue reproduzir
                com fidelidade os resultados do modelo físico-empírico do separador de produção.
                Esta análise é fundamental para validar a aplicação de IA na otimização do processo.
            </div>

            ${trainedStatus}

            <div style="margin-top: 1rem;">
                <button id="runComparisonBtn" onclick="runModelComparison()" ${!nnPredictor.isTrained ? 'disabled' : ''}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:3px"><polygon points="3,1 13,8 3,15"/></svg> Executar Comparação
                </button>
            </div>
        </div>

        <div class="card" style="margin-top: 1rem;">
            <h4>Metodologia</h4>
            <div class="formulas-grid">
                <div class="formula-card">
                    <strong>1. Dados de Teste</strong>
                    <div style="font-size: 0.8rem; margin-top: 0.3rem;">
                        200 amostras aleatórias independentes do conjunto de treino
                    </div>
                </div>
                <div class="formula-card">
                    <strong>2. Modelo Físico</strong>
                    <div style="font-size: 0.8rem; margin-top: 0.3rem;">
                        Stokes + Souders-Brown + correlações empíricas (referência)
                    </div>
                </div>
                <div class="formula-card">
                    <strong>3. Modelo Neural</strong>
                    <div style="font-size: 0.8rem; margin-top: 0.3rem;">
                        MLP: 6 inputs → 64 → 32 → 16 → 3 outputs (TensorFlow.js)
                    </div>
                </div>
                <div class="formula-card">
                    <strong>4. Métricas</strong>
                    <div style="font-size: 0.8rem; margin-top: 0.3rem;">
                        RMSE, MAE, R², MAPE - avaliação completa da precisão
                    </div>
                </div>
            </div>
        </div>

        <div id="comparisonResults"></div>
    `;

    document.getElementById('comparison').innerHTML = html;
}

// ============================================================================
// ASSISTENTE IA - CHAT INTERFACE
// ============================================================================

let chatHistory = [];

function renderAssistant() {
    const html = `
        <div class="chat-container">
            <div class="chat-messages" id="chatMessages">
                <div class="chat-msg ai">
                    <div class="chat-avatar" aria-hidden="true">
                        <svg viewBox="0 0 64 64" width="18" height="18"><path d="M32 10c-9 12-14 20-14 28a14 14 0 0 0 28 0c0-8-5-16-14-28z" fill="#ffffff"/><path d="M22 28 L32 50 L42 28" stroke="#0b1220" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </div>
                    <div class="chat-bubble">
                        <div class="chat-meta"><strong>Assistente VPO</strong><span class="model-tag">modelo-físico · v0.9</span></div>
                        A iniciar scan e análise completa dos parâmetros operacionais…
                    </div>
                </div>
            </div>
            <div class="chat-input-bar">
                <div class="chat-input-shell">
                    <input type="text" id="chatInput" placeholder="Pergunte ou escreva um comando (ex.: simular, otimizar, dimensionar)…" autocomplete="off" onkeydown="if(event.key==='Enter')sendChatMessage()"/>
                    <button class="chat-send" onclick="sendChatMessage()" aria-label="Enviar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `;
    document.getElementById('assistant').innerHTML = html;
    chatHistory = [];
    setTimeout(() => runFullChatAnalysis({ ...currentParams }), 300);
}

// Avatar SVG (marca VPO — gota/V)
const AI_AVATAR = `<svg viewBox="0 0 64 64" width="18" height="18"><path d="M32 10c-9 12-14 20-14 28a14 14 0 0 0 28 0c0-8-5-16-14-28z" fill="#ffffff"/><path d="M22 28 L32 50 L42 28" stroke="#0b1220" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const USER_AVATAR = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 4a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm-1 5a2 2 0 0 0-2 2v.5c0 .28.22.5.5.5h9a.5.5 0 0 0 .5-.5V11a2 2 0 0 0-2-2H5z"/></svg>`;

// Sanitização contra XSS — usada para TODO conteúdo fornecido pelo utilizador
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Helpers de chat
// role = 'ai'   : `content` é HTML interno confiável (gerado pelo app)
// role = 'user' : `content` é texto bruto do utilizador — SEMPRE escapar
function addChatMsg(role, content) {
    const container = document.getElementById('chatMessages');
    const avatar = role === 'ai' ? AI_AVATAR : USER_AVATAR;
    const safe = role === 'user' ? escapeHtml(content) : content;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}`;
    msgDiv.innerHTML = `<div class="chat-avatar">${avatar}</div><div class="chat-bubble">${safe}</div>`;
    container.appendChild(msgDiv);
    msgDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return msgDiv;
}

function addTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ai';
    msgDiv.id = 'chatTyping';
    msgDiv.innerHTML = `<div class="chat-avatar">${AI_AVATAR}</div><div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>`;
    container.appendChild(msgDiv);
    msgDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function removeTypingIndicator() {
    const el = document.getElementById('chatTyping');
    if (el) el.remove();
}

async function typeAndRespond(contentFn) {
    addTypingIndicator();
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    removeTypingIndicator();
    const content = contentFn();
    addChatMsg('ai', content);
}

// ---- Diagrama: toolbar, fullscreen, download ----
let diagramCounter = 0;

function wrapDiagramWithToolbar(svgHtml, title) {
    const id = 'diagram-' + (++diagramCounter);
    return `
        <div class="diagram-toolbar">
            <button onclick="maximizeDiagram('${id}','${title}')" title="Maximizar">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h4V2H2v5h1V3zm10 0h-4V2h5v5h-1V3zM3 13h4v1H2v-5h1v4zm10 0h-4v1h5v-5h-1v4z"/></svg>
            </button>
            <button onclick="downloadDiagram('${id}','${title}')" title="Download PNG">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 13h7l.5-.5v-3h-1v2.5H5V9.5H4v3l.5.5zM8 10l3-3H9V2H7v5H5l3 3z"/></svg>
            </button>
            <button onclick="downloadDiagramSVG('${id}','${title}')" title="Download SVG">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1H11l4 4v9.5l-.5.5h-13l-.5-.5v-13l.5-.5zM2 2v12h12V5.5L10.5 2H2z"/><path d="M5 7h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z"/></svg>
            </button>
        </div>
        <div class="diagram-box" id="${id}">${svgHtml}</div>`;
}

function maximizeDiagram(id, title) {
    const box = document.getElementById(id);
    if (!box) return;
    const svgEl = box.querySelector('svg');
    if (!svgEl) return;

    const overlay = document.createElement('div');
    overlay.className = 'diagram-fullscreen';
    overlay.innerHTML = `
        <div class="diagram-fullscreen-bar">
            <span>${title}</span>
            <div class="fs-actions">
                <button onclick="downloadDiagram('${id}','${title}')" title="Download PNG">
                    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 13h7l.5-.5v-3h-1v2.5H5V9.5H4v3l.5.5zM8 10l3-3H9V2H7v5H5l3 3z"/></svg>
                </button>
                <button onclick="downloadDiagramSVG('${id}','${title}')" title="Download SVG">
                    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1H11l4 4v9.5l-.5.5h-13l-.5-.5v-13l.5-.5zM2 2v12h12V5.5L10.5 2H2z"/><path d="M5 7h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z"/></svg>
                </button>
                <button onclick="this.closest('.diagram-fullscreen').remove()" title="Fechar">
                    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.293l3.146-3.147.708.708L8.707 8l3.147 3.146-.708.708L8 8.707l-3.146 3.147-.708-.708L7.293 8 4.146 4.854l.708-.708L8 7.293z"/></svg>
                </button>
            </div>
        </div>
        <div class="diagram-fs-content">${svgEl.outerHTML}</div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

function downloadDiagram(id, title) {
    const box = document.getElementById(id);
    if (!box) return;
    const svgEl = box.querySelector('svg');
    if (!svgEl) return;

    const svgClone = svgEl.cloneNode(true);
    const vb = svgClone.getAttribute('viewBox') || '0 0 1200 600';
    const [,, w, h] = vb.split(/\s+/).map(Number);
    const scale = 2;

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        const a = document.createElement('a');
        a.download = (title || 'diagram').replace(/\s+/g, '_') + '.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
    };
    img.src = url;
}

function downloadDiagramSVG(id, title) {
    const box = document.getElementById(id);
    if (!box) return;
    const svgEl = box.querySelector('svg');
    if (!svgEl) return;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.download = (title || 'diagram').replace(/\s+/g, '_') + '.svg';
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
}

// Enviar mensagem do utilizador
async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;

    addChatMsg('user', text);
    const cmd = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const params = { ...currentParams };

    if (cmd.includes('analisar') || cmd.includes('analise completa') || cmd.includes('tudo')) {
        await runFullChatAnalysis(params);
    } else if (cmd.includes('scan') || cmd.includes('parametro')) {
        await typeAndRespond(() => chatStep1_ParameterScan(params));
    } else if (cmd.includes('simul')) {
        await typeAndRespond(() => chatStep2_Simulation(params));
    } else if (cmd.includes('fuzzy')) {
        await typeAndRespond(() => chatStep3_FuzzyAnalysis(params));
    } else if (cmd.includes('optim')) {
        await typeAndRespond(() => chatStep4_Optimization(params));
    } else if (cmd.includes('dimension') || cmd.includes('design')) {
        await typeAndRespond(() => {
            const specs = calculateSeparatorDesign(params);
            return chatStep5_Design(params, specs);
        });
    } else if (cmd === 'pfd' || cmd.includes('fluxo')) {
        await typeAndRespond(() => {
            const specs = calculateSeparatorDesign(params);
            return chatStep6_PFD(params, specs);
        });
    } else if (cmd === 'pid' || cmd.includes('p&id') || cmd.includes('instrumenta')) {
        await typeAndRespond(() => {
            const specs = calculateSeparatorDesign(params);
            return chatStep7_PID(params, specs);
        });
    } else if (cmd.includes('resum')) {
        await typeAndRespond(() => {
            const specs = calculateSeparatorDesign(params);
            return chatStep8_Summary(params, specs);
        });
    } else {
        await typeAndRespond(() =>
            `Não reconheci o comando "<strong>${text}</strong>".<br>
            Tente: <strong>analisar</strong>, <strong>scan</strong>, <strong>simular</strong>, <strong>fuzzy</strong>, <strong>optimizar</strong>, <strong>dimensionar</strong>, <strong>pfd</strong>, <strong>pid</strong> ou <strong>resumo</strong>.`
        );
    }
    input.disabled = false;
    input.focus();
}

// Análise completa sequencial no chat
async function runFullChatAnalysis(params) {
    const steps = [
        () => chatStep1_ParameterScan(params),
        () => chatStep2_Simulation(params),
        () => chatStep3_FuzzyAnalysis(params),
        () => chatStep4_Optimization(params),
        () => {
            const specs = calculateSeparatorDesign(params);
            params._vesselSpecs = specs;
            return chatStep5_Design(params, specs);
        },
        () => chatStep6_PFD(params, params._vesselSpecs),
        () => chatStep7_PID(params, params._vesselSpecs),
        () => chatStep8_Summary(params, params._vesselSpecs)
    ];

    for (const stepFn of steps) {
        await typeAndRespond(stepFn);
    }
    addChatMsg('ai', 'Análise completa finalizada. Pode alterar os parâmetros na sidebar e executar novamente, ou pedir qualquer passo individual.');
}

// ---- PASSO 1: Scan de Parâmetros ----
function chatStep1_ParameterScan(p) {
    let regime = 'Condições Moderadas';
    let cls = 'ok';
    if (p.gor > 120) { regime = 'Alto GOR - Dominado por Gás'; cls = 'warn'; }
    else if (p.waterCut > 60) { regime = 'Alto Corte de Água'; cls = 'warn'; }
    else if (p.viscosity > 25) { regime = 'Óleo Pesado / Alta Viscosidade'; cls = 'crit'; }
    else if (p.flowRate > 2000) { regime = 'Alta Vazão'; cls = 'warn'; }

    const paramRows = [
        { name: 'Vazão', value: p.flowRate, unit: 'm³/dia', optimal: [800, 1500], min: 150, max: 2400 },
        { name: 'Pressão', value: p.pressure, unit: 'bar', optimal: [10, 13], min: 8.5, max: 15.2 },
        { name: 'Temperatura', value: p.temperature, unit: '°C', optimal: [55, 75], min: 45, max: 85 },
        { name: 'Corte de Água', value: p.waterCut, unit: '%', optimal: [20, 50], min: 15, max: 78 },
        { name: 'GOR', value: p.gor, unit: 'm³/m³', optimal: [60, 120], min: 45, max: 180 },
        { name: 'Viscosidade', value: p.viscosity, unit: 'cP', optimal: [10, 20], min: 10, max: 30 },
        { name: 'ρ Óleo', value: p.rhoOil, unit: 'kg/m³', optimal: [830, 900], min: 800, max: 950 },
        { name: 'ρ Água', value: p.rhoWater, unit: 'kg/m³', optimal: [1010, 1050], min: 1000, max: 1100 },
        { name: 'ρ Gás', value: p.rhoGas, unit: 'kg/m³', optimal: [0.8, 1.5], min: 0.7, max: 2.0 }
    ];

    const rows = paramRows.map(r => {
        let st = '<span class="ok">Normal</span>';
        if (r.value <= r.min || r.value >= r.max) st = '<span class="crit">Limite</span>';
        else if (r.value < r.optimal[0] || r.value > r.optimal[1]) st = '<span class="warn">Atenção</span>';
        return `<tr><td>${r.name}</td><td><span class="val">${r.value}</span> ${r.unit}</td><td>${r.optimal[0]}–${r.optimal[1]}</td><td>${st}</td></tr>`;
    }).join('');

    return `
        <strong>1 · Scan de Parâmetros Operacionais</strong><br><br>
        Regime detectado: <strong class="${cls}">${regime}</strong><br><br>
        <table>
            <thead><tr><th>Parâmetro</th><th>Valor</th><th>Faixa Ótima</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ---- PASSO 2: Simulação com Modelos ----
function chatStep2_Simulation(p) {
    const effGL = separatorModel.separationEfficiencyGL(p.flowRate, p.pressure, p.temperature, p.gor);
    const effOA = separatorModel.separationEfficiencyOA(p.flowRate, p.temperature, p.waterCut, p.viscosity);
    const energy = separatorModel.energyConsumption(p.flowRate, p.pressure, p.temperature);
    const muOil = p.viscosity * 1e-3;
    const vStokes = separatorModel.stokesVelocity(100e-6, p.rhoWater, p.rhoOil, muOil);
    const vSB = separatorModel.soudersBrownVelocity(p.rhoOil, p.rhoGas);
    const Re = separatorModel.reynoldsNumber(vStokes, 200e-6, p.rhoOil, muOil);

    const sGL = effGL > 0.93 ? 'ok' : effGL > 0.90 ? 'warn' : 'crit';
    const sOA = effOA > 0.87 ? 'ok' : effOA > 0.84 ? 'warn' : 'crit';
    const sE = energy < 2.5 ? 'ok' : energy < 3.5 ? 'warn' : 'crit';

    return `
        <strong>2 · Simulação com Modelos Físicos</strong><br><br>
        <table>
            <thead><tr><th>Modelo</th><th>Resultado</th><th>Status</th></tr></thead>
            <tbody>
                <tr><td>Eficiência G-L</td><td><span class="val">${(effGL*100).toFixed(2)}%</span></td><td><span class="${sGL}">${sGL === 'ok' ? 'Excelente' : sGL === 'warn' ? 'Bom' : 'Crítico'}</span></td></tr>
                <tr><td>Eficiência O-A</td><td><span class="val">${(effOA*100).toFixed(2)}%</span></td><td><span class="${sOA}">${sOA === 'ok' ? 'Excelente' : sOA === 'warn' ? 'Bom' : 'Crítico'}</span></td></tr>
                <tr><td>Consumo Energético</td><td><span class="val">${energy.toFixed(3)} MWh/1000m³</span></td><td><span class="${sE}">${sE === 'ok' ? 'Baixo' : sE === 'warn' ? 'Moderado' : 'Alto'}</span></td></tr>
                <tr><td>Vel. Stokes (100μm)</td><td><span class="val">${(vStokes*1000).toFixed(3)} mm/s</span></td><td><span class="${Re < 1 ? 'ok' : 'warn'}">${Re < 1 ? 'Stokes válido' : 'Re > 1'}</span></td></tr>
                <tr><td>Vel. Souders-Brown</td><td><span class="val">${vSB.toFixed(3)} m/s</span></td><td><span class="ok">Limite arraste</span></td></tr>
                <tr><td>Reynolds gota</td><td><span class="val">${Re.toExponential(2)}</span></td><td><span class="${Re < 1 ? 'ok' : 'warn'}">${Re < 1 ? 'Regime Stokes' : 'Correcção'}</span></td></tr>
            </tbody>
        </table>`;
}

// ---- PASSO 3: Análise Fuzzy ----
function chatStep3_FuzzyAnalysis(p) {
    const effGL = separatorModel.separationEfficiencyGL(p.flowRate, p.pressure, p.temperature, p.gor);
    const effOA = separatorModel.separationEfficiencyOA(p.flowRate, p.temperature, p.waterCut, p.viscosity);
    const avgEff = (effGL + effOA) / 2;
    const energy = separatorModel.energyConsumption(p.flowRate, p.pressure, p.temperature);

    const decision = fuzzyController.getControlAction({
        efficiency: avgEff, waterCut: p.waterCut, temperature: p.temperature,
        pressure: p.pressure, energy: energy, flowRate: p.flowRate
    });

    const rulesHtml = decision.allRules ? decision.allRules.map(r =>
        `<tr><td>R${r.id}</td><td>${r.description}</td><td><span class="val">${(r.activation*100).toFixed(1)}%</span></td></tr>`
    ).join('') : '';

    return `
        <strong>3 · Análise de Controle Fuzzy</strong><br><br>
        <div class="reco-box">
            <strong>Acção Recomendada:</strong> ${decision.description}<br>
            Confiança: <span class="val">${(decision.confidence*100).toFixed(1)}%</span>
        </div>
        ${rulesHtml ? `
        <table>
            <thead><tr><th>Regra</th><th>Condição</th><th>Activação</th></tr></thead>
            <tbody>${rulesHtml}</tbody>
        </table>` : ''}`;
}

// ---- PASSO 4: Optimização Rápida ----
function chatStep4_Optimization(p) {
    const bounds = [[150, 2400], [8.5, 15.2], [45, 85], [15, 78]];
    const solutions = optimizer.nsgaIIOptimization(bounds, 15, 20);
    const best = solutions[solutions.length - 1];
    const [optFlow, optPress, optTemp, optWC] = best.solution;
    const currentEff = -(optimizer.evaluateObjectives([p.flowRate, p.pressure, p.temperature, p.waterCut])[0]);
    const optimalEff = -best.objectives[0];
    const improvement = ((optimalEff - currentEff) / currentEff * 100);

    return `
        <strong>4 · Optimização Rápida (NSGA-II)</strong><br><br>
        <table>
            <thead><tr><th>Parâmetro</th><th>Actual</th><th>Óptimo</th><th>Δ</th></tr></thead>
            <tbody>
                <tr><td>Vazão (m³/dia)</td><td><span class="val">${p.flowRate}</span></td><td><span class="val">${optFlow.toFixed(0)}</span></td><td>${(optFlow - p.flowRate).toFixed(0)}</td></tr>
                <tr><td>Pressão (bar)</td><td><span class="val">${p.pressure}</span></td><td><span class="val">${optPress.toFixed(1)}</span></td><td>${(optPress - p.pressure).toFixed(1)}</td></tr>
                <tr><td>Temperatura (°C)</td><td><span class="val">${p.temperature}</span></td><td><span class="val">${optTemp.toFixed(1)}</span></td><td>${(optTemp - p.temperature).toFixed(1)}</td></tr>
                <tr><td>Corte de Água (%)</td><td><span class="val">${p.waterCut}</span></td><td><span class="val">${optWC.toFixed(1)}</span></td><td>${(optWC - p.waterCut).toFixed(1)}</td></tr>
            </tbody>
        </table>
        <div class="reco-box">
            Eficiência Actual: <span class="val">${(currentEff*100).toFixed(2)}%</span> →
            Eficiência Óptima: <span class="val">${(optimalEff*100).toFixed(2)}%</span>
            (<span class="${improvement >= 0 ? 'ok' : 'crit'}">${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}%</span>)
        </div>`;
}

// ---- MOTOR DE DIMENSIONAMENTO ----
function calculateSeparatorDesign(p) {
    // 1. Selecção do tipo
    let type, LD_ratio;
    if (p.gor > 120 || p.pressure > 13) {
        type = 'Vertical Trifásico';
        LD_ratio = 4.0;
    } else if (p.waterCut > 60 && p.flowRate > 1500) {
        type = 'Horizontal Trifásico com Boot';
        LD_ratio = 3.5;
    } else {
        type = 'Horizontal Trifásico';
        LD_ratio = 3.5;
    }

    // 2. Caudais
    const Q_total_m3s = p.flowRate / 86400;
    const gasFraction = p.gor / (p.gor + 1000);
    const Q_gas = Q_total_m3s * gasFraction;
    const Q_liquid = Q_total_m3s * (1 - gasFraction);
    const Q_oil = Q_liquid * (1 - p.waterCut / 100);
    const Q_water = Q_liquid * (p.waterCut / 100);

    // 3. Capacidade gás (Souders-Brown)
    const vg_max = separatorModel.soudersBrownVelocity(p.rhoOil, p.rhoGas);
    const liquidFill = 0.55;
    const A_gas_min = Q_gas / vg_max;
    const D_from_gas = Math.sqrt(4 * A_gas_min / (Math.PI * (1 - liquidFill)));

    // 4. Tempo de residência
    let tRes = 3;
    if (p.viscosity > 20) tRes = 7;
    if (p.viscosity > 25) tRes = 10;
    if (p.waterCut > 50) tRes *= 1.3;
    if (p.waterCut > 70) tRes *= 1.5;
    const V_liquid_required = Q_liquid * tRes * 60;

    // 5. Diâmetro por líquido
    const D_from_liquid = Math.pow(
        (4 * V_liquid_required) / (Math.PI * LD_ratio * liquidFill), 1/3
    );

    // 6. Diâmetro controlante
    let D_internal = Math.max(D_from_gas, D_from_liquid);
    D_internal = Math.max(0.6, Math.min(3.0, D_internal));

    // Arredondar para tamanho padrão (polegadas)
    const D_inches = D_internal * 39.3701;
    const stdDiameters = [24, 30, 36, 42, 48, 54, 60, 72, 84, 96, 108, 120];
    const D_std_in = stdDiameters.find(d => d >= D_inches) || stdDiameters[stdDiameters.length - 1];
    const D_final = D_std_in * 0.0254;
    const L_eff = D_final * LD_ratio;
    const L_ss = L_eff + 1.5 * D_final;

    // 7. Volume real e tempo de residência
    const V_real = Math.PI / 4 * Math.pow(D_final, 2) * L_eff * liquidFill;
    const tRes_real = V_real / Q_liquid / 60;

    // 8. Espessura parede (ASME VIII)
    const P_design = p.pressure * 1.1 + 2;
    const P_MPa = P_design * 0.1;
    const S_allow = 137.9;
    const E_joint = 0.85;
    const t_shell = (P_MPa * D_final * 1000 / 2) / (S_allow * E_joint - 0.6 * P_MPa);
    const t_total = Math.ceil(t_shell + 3);

    // 9. Peso estimado
    const surfaceArea = Math.PI * D_final * L_ss + 2 * Math.PI * Math.pow(D_final/2, 2);
    const weight = surfaceArea * (t_total / 1000) * 7850;

    // 10. Internos
    const internals = [];
    internals.push({ name: p.flowRate > 1500 ? 'Schoepentoeter (Inlet Diverter)' : 'Deflector de Entrada', purpose: 'Distribuição do fluxo e separação inicial' });
    internals.push({ name: 'Eliminador de Névoa (Wire Mesh)', purpose: 'Remoção de líquido do gás (>99% gotas >10μm)' });
    if (p.waterCut > 40 || p.viscosity > 20) {
        internals.push({ name: 'Placas Coalescedoras', purpose: 'Promoção da coalescência óleo-água' });
    }
    if (type.includes('Horizontal')) {
        internals.push({ name: 'Placa de Vertedouro (Weir)', purpose: 'Manutenção da interface óleo-água' });
    }
    internals.push({ name: 'Quebra-Vórtice (Saída Óleo)', purpose: 'Prevenção de re-arrastamento de gás' });
    internals.push({ name: 'Quebra-Vórtice (Saída Água)', purpose: 'Prevenção de formação de vórtice' });
    if (p.waterCut > 60) {
        internals.push({ name: 'Bocais de Jato de Areia', purpose: 'Capacidade de remoção de sólidos' });
    }

    // 11. Bocais
    const nozzle = (Q, v_target) => {
        const A = Q / v_target;
        const D = Math.sqrt(4 * A / Math.PI);
        const D_mm = Math.max(50, Math.ceil(D * 1000 / 25) * 25);
        return D_mm;
    };

    return {
        type, LD_ratio, D_final, D_std_in, L_eff, L_ss, P_design, t_total,
        material: 'SA-516 Gr. 70', weight: Math.round(weight),
        V_liquid: V_real, tRes_real, internals,
        Q_gas, Q_oil, Q_water, Q_liquid,
        nozzles: {
            inlet: nozzle(Q_total_m3s, 1.5),
            gasOutlet: nozzle(Q_gas, 18),
            oilOutlet: nozzle(Q_oil, 0.8),
            waterOutlet: nozzle(Q_water, 0.8)
        }
    };
}

// ---- PASSO 5: Proposta de Design ----
function chatStep5_Design(p, specs) {
    const specItems = [
        { label: 'Tipo', value: specs.type },
        { label: 'Diâmetro', value: `${(specs.D_final*1000).toFixed(0)} mm (${specs.D_std_in}")` },
        { label: 'Comp. Efectivo', value: `${specs.L_eff.toFixed(2)} m` },
        { label: 'Comp. S-S', value: `${specs.L_ss.toFixed(2)} m` },
        { label: 'L/D', value: specs.LD_ratio.toFixed(1) },
        { label: 'P Projecto', value: `${specs.P_design.toFixed(1)} bar` },
        { label: 'Espessura', value: `${specs.t_total} mm` },
        { label: 'Material', value: specs.material },
        { label: 'Peso', value: `${specs.weight.toLocaleString()} kg` },
        { label: 'Vol. Líquido', value: `${specs.V_liquid.toFixed(2)} m³` },
        { label: 'Res. Time', value: `${specs.tRes_real.toFixed(1)} min` }
    ];

    return `
        <strong>5 · Dimensionamento do Separador</strong><br>
        <small>Conforme API 12J e GPSA Engineering Data Book</small><br><br>
        <div class="spec-grid">
            ${specItems.map(s => `<div class="spec-card"><small>${s.label}</small><span>${s.value}</span></div>`).join('')}
        </div>
        <br><strong>Bocais</strong>
        <table>
            <thead><tr><th>Bocal</th><th>mm</th><th>pol</th></tr></thead>
            <tbody>
                <tr><td>Entrada</td><td><span class="val">${specs.nozzles.inlet}</span></td><td>${(specs.nozzles.inlet / 25.4).toFixed(1)}"</td></tr>
                <tr><td>Saída Gás</td><td><span class="val">${specs.nozzles.gasOutlet}</span></td><td>${(specs.nozzles.gasOutlet / 25.4).toFixed(1)}"</td></tr>
                <tr><td>Saída Óleo</td><td><span class="val">${specs.nozzles.oilOutlet}</span></td><td>${(specs.nozzles.oilOutlet / 25.4).toFixed(1)}"</td></tr>
                <tr><td>Saída Água</td><td><span class="val">${specs.nozzles.waterOutlet}</span></td><td>${(specs.nozzles.waterOutlet / 25.4).toFixed(1)}"</td></tr>
            </tbody>
        </table>
        <br><strong>Internos do Vaso</strong>
        <ul class="int-list">
            ${specs.internals.map(i => `<li><strong>${i.name}</strong> — ${i.purpose}</li>`).join('')}
        </ul>`;
}

// ---- PASSO 6: PFD ----
function chatStep6_PFD(p, specs) {
    const svgBg = '#1a1a2e';
    const txtMain = '#cccccc';
    const txtDim = '#888888';
    const gasColor = '#f14c4c';
    const oilColor = '#ce9178';
    const waterColor = '#569cd6';
    const vesselColor = '#4ec9b0';
    const equipColor = '#3c3c3c';

    const svg = `
    <svg viewBox="0 0 1200 550" xmlns="http://www.w3.org/2000/svg" style="font-family: 'Inter', sans-serif;">
        <defs>
            <marker id="pfd-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="${txtMain}"/>
            </marker>
            <marker id="pfd-arrow-gas" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="${gasColor}"/>
            </marker>
            <marker id="pfd-arrow-oil" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="${oilColor}"/>
            </marker>
            <marker id="pfd-arrow-water" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="${waterColor}"/>
            </marker>
        </defs>
        <rect width="1200" height="550" fill="${svgBg}"/>
        <rect x="850" y="490" width="340" height="50" fill="${equipColor}" stroke="#555" stroke-width="1"/>
        <text x="1020" y="510" text-anchor="middle" fill="${txtMain}" font-size="11" font-weight="600">PROCESS FLOW DIAGRAM (PFD)</text>
        <text x="1020" y="525" text-anchor="middle" fill="${txtDim}" font-size="9">VPO AI Assistant - ${specs.type} - Rev. 0</text>
        <text x="1020" y="537" text-anchor="middle" fill="${txtDim}" font-size="8">Q=${p.flowRate} m³/dia | P=${p.pressure} bar | T=${p.temperature}°C</text>
        <rect x="30" y="205" width="90" height="60" rx="5" fill="${equipColor}" stroke="${vesselColor}" stroke-width="2"/>
        <text x="75" y="228" text-anchor="middle" fill="${vesselColor}" font-size="9" font-weight="600">POÇO</text>
        <text x="75" y="245" text-anchor="middle" fill="${txtDim}" font-size="8">Manifold</text>
        <text x="75" y="258" text-anchor="middle" fill="${txtDim}" font-size="7">${p.flowRate} m³/d</text>
        <line x1="120" y1="235" x2="200" y2="235" stroke="${txtMain}" stroke-width="3" marker-end="url(#pfd-arrow)"/>
        <text x="160" y="225" text-anchor="middle" fill="${txtDim}" font-size="7">Stream 1</text>
        <rect x="210" y="210" width="70" height="50" rx="5" fill="${equipColor}" stroke="${oilColor}" stroke-width="2"/>
        <text x="245" y="233" text-anchor="middle" fill="${oilColor}" font-size="9" font-weight="600">E-100</text>
        <text x="245" y="248" text-anchor="middle" fill="${txtDim}" font-size="7">Aquecedor</text>
        <line x1="280" y1="235" x2="370" y2="235" stroke="${txtMain}" stroke-width="3" marker-end="url(#pfd-arrow)"/>
        <text x="325" y="225" text-anchor="middle" fill="${txtDim}" font-size="7">Stream 2</text>
        <text x="325" y="255" text-anchor="middle" fill="${txtDim}" font-size="7">${p.temperature}°C, ${p.pressure} bar</text>
        <g transform="translate(380, 170)">
            <text x="160" y="-15" text-anchor="middle" fill="${vesselColor}" font-size="13" font-weight="700">V-100</text>
            <text x="160" y="0" text-anchor="middle" fill="${txtDim}" font-size="8">${specs.type}</text>
            <ellipse cx="10" cy="65" rx="15" ry="65" fill="${equipColor}" stroke="${vesselColor}" stroke-width="2"/>
            <rect x="10" y="0" width="300" height="130" fill="${equipColor}" stroke="${vesselColor}" stroke-width="2"/>
            <ellipse cx="310" cy="65" rx="15" ry="65" fill="${equipColor}" stroke="${vesselColor}" stroke-width="2"/>
            <rect x="11" y="1" width="298" height="40" fill="rgba(241, 76, 76, 0.08)"/>
            <text x="160" y="25" text-anchor="middle" fill="${gasColor}" font-size="9" font-weight="600">GÁS</text>
            <rect x="11" y="41" width="298" height="40" fill="rgba(206, 145, 120, 0.1)"/>
            <text x="160" y="65" text-anchor="middle" fill="${oilColor}" font-size="9" font-weight="600">ÓLEO</text>
            <rect x="11" y="81" width="298" height="48" fill="rgba(86, 156, 214, 0.1)"/>
            <text x="160" y="110" text-anchor="middle" fill="${waterColor}" font-size="9" font-weight="600">ÁGUA</text>
            <line x1="10" y1="41" x2="310" y2="41" stroke="${txtDim}" stroke-width="1" stroke-dasharray="5,3"/>
            <line x1="10" y1="81" x2="310" y2="81" stroke="${waterColor}" stroke-width="1" stroke-dasharray="5,3"/>
            <line x1="250" y1="0" x2="250" y2="40" stroke="${vesselColor}" stroke-width="1.5" stroke-dasharray="3,2"/>
            <text x="265" y="20" fill="${txtDim}" font-size="6">ME</text>
            <line x1="200" y1="41" x2="200" y2="130" stroke="${vesselColor}" stroke-width="2"/>
            <text x="208" y="95" fill="${txtDim}" font-size="6">Weir</text>
            <text x="160" y="145" text-anchor="middle" fill="${txtDim}" font-size="7">⌀${specs.D_std_in}" × ${specs.L_ss.toFixed(1)}m S-S</text>
        </g>
        <polyline points="540,180 540,100 850,100" fill="none" stroke="${gasColor}" stroke-width="2.5" stroke-dasharray="8,3" marker-end="url(#pfd-arrow-gas)"/>
        <text x="690" y="90" text-anchor="middle" fill="${gasColor}" font-size="8">Stream 3 - Gás</text>
        <text x="690" y="115" text-anchor="middle" fill="${txtDim}" font-size="7">${(specs.Q_gas*86400).toFixed(0)} m³/d</text>
        <rect x="860" y="65" width="55" height="70" rx="5" fill="${equipColor}" stroke="${gasColor}" stroke-width="2"/>
        <text x="887" y="95" text-anchor="middle" fill="${gasColor}" font-size="9" font-weight="600">V-200</text>
        <text x="887" y="110" text-anchor="middle" fill="${txtDim}" font-size="7">Scrubber</text>
        <line x1="915" y1="100" x2="1000" y2="100" stroke="${gasColor}" stroke-width="2" stroke-dasharray="6,3" marker-end="url(#pfd-arrow-gas)"/>
        <rect x="1010" y="75" width="70" height="50" rx="5" fill="${equipColor}" stroke="${gasColor}" stroke-width="1.5"/>
        <text x="1045" y="98" text-anchor="middle" fill="${gasColor}" font-size="8" font-weight="600">Compressor</text>
        <text x="1045" y="112" text-anchor="middle" fill="${txtDim}" font-size="7">C-100</text>
        <polyline points="560,300 560,380 850,380" fill="none" stroke="${oilColor}" stroke-width="2.5" marker-end="url(#pfd-arrow-oil)"/>
        <text x="700" y="370" text-anchor="middle" fill="${oilColor}" font-size="8">Stream 4 - Óleo</text>
        <text x="700" y="395" text-anchor="middle" fill="${txtDim}" font-size="7">${(specs.Q_oil*86400).toFixed(1)} m³/d</text>
        <rect x="860" y="355" width="80" height="55" rx="5" fill="${equipColor}" stroke="${oilColor}" stroke-width="2"/>
        <text x="900" y="380" text-anchor="middle" fill="${oilColor}" font-size="9" font-weight="600">T-100</text>
        <text x="900" y="395" text-anchor="middle" fill="${txtDim}" font-size="7">Tq. Óleo</text>
        <line x1="940" y1="382" x2="1020" y2="382" stroke="${oilColor}" stroke-width="2" marker-end="url(#pfd-arrow-oil)"/>
        <text x="1060" y="385" text-anchor="middle" fill="${oilColor}" font-size="8">Exportação</text>
        <polyline points="600,300 600,450 850,450" fill="none" stroke="${waterColor}" stroke-width="2.5" marker-end="url(#pfd-arrow-water)"/>
        <text x="720" y="440" text-anchor="middle" fill="${waterColor}" font-size="8">Stream 5 - Água</text>
        <text x="720" y="465" text-anchor="middle" fill="${txtDim}" font-size="7">${(specs.Q_water*86400).toFixed(1)} m³/d</text>
        <rect x="860" y="425" width="80" height="55" rx="5" fill="${equipColor}" stroke="${waterColor}" stroke-width="2"/>
        <text x="900" y="450" text-anchor="middle" fill="${waterColor}" font-size="9" font-weight="600">T-200</text>
        <text x="900" y="465" text-anchor="middle" fill="${txtDim}" font-size="7">Trat. Água</text>
        <line x1="940" y1="452" x2="1020" y2="452" stroke="${waterColor}" stroke-width="2" marker-end="url(#pfd-arrow-water)"/>
        <text x="1065" y="455" text-anchor="middle" fill="${waterColor}" font-size="8">Descarte</text>
        <rect x="10" y="490" width="200" height="50" fill="${equipColor}" stroke="#555" stroke-width="1" rx="3"/>
        <text x="20" y="507" fill="${txtMain}" font-size="9" font-weight="600">Legenda:</text>
        <line x1="20" y1="520" x2="50" y2="520" stroke="${gasColor}" stroke-width="2" stroke-dasharray="6,3"/>
        <text x="55" y="523" fill="${txtDim}" font-size="8">Gás</text>
        <line x1="85" y1="520" x2="115" y2="520" stroke="${oilColor}" stroke-width="2"/>
        <text x="120" y="523" fill="${txtDim}" font-size="8">Óleo</text>
        <line x1="150" y1="520" x2="180" y2="520" stroke="${waterColor}" stroke-width="2"/>
        <text x="185" y="523" fill="${txtDim}" font-size="8">Água</text>
    </svg>`;

    return `
        <strong>6 · Diagrama de Fluxo do Processo (PFD)</strong><br><br>
        ${wrapDiagramWithToolbar(svg, 'PFD - Process Flow Diagram')}`;
}

// ---- PASSO 7: P&ID ----
function chatStep7_PID(p, specs) {
    const bg = '#1a1a2e';
    const txt = '#cccccc';
    const dim = '#888888';
    const gas = '#f14c4c';
    const oil = '#ce9178';
    const water = '#569cd6';
    const vessel = '#4ec9b0';
    const eq = '#3c3c3c';
    const inst = '#9cdcfe';
    const signal = '#c586c0';
    const safety = '#f14c4c';

    const IC = (x, y, tag, dcs=false) => `
        <g transform="translate(${x}, ${y})">
            <circle cx="0" cy="0" r="15" fill="${eq}" stroke="${txt}" stroke-width="1.5"/>
            ${dcs ? `<line x1="-15" y1="0" x2="15" y2="0" stroke="${txt}" stroke-width="1"/>` : ''}
            <text x="0" y="${dcs ? -4 : 1}" text-anchor="middle" fill="${inst}" font-size="7" font-weight="600">${tag.split('-')[0]}</text>
            ${dcs ? `<text x="0" y="7" text-anchor="middle" fill="${dim}" font-size="5">${tag.split('-').slice(1).join('-')}</text>` : `<text x="0" y="10" text-anchor="middle" fill="${dim}" font-size="5">${tag.split('-').slice(1).join('-')}</text>`}
        </g>`;

    const CV = (x, y, tag) => `
        <g transform="translate(${x}, ${y})">
            <polygon points="-12,-8 0,0 12,-8" fill="none" stroke="${txt}" stroke-width="1.5"/>
            <polygon points="-12,8 0,0 12,8" fill="none" stroke="${txt}" stroke-width="1.5"/>
            <line x1="0" y1="-8" x2="0" y2="-22" stroke="${txt}" stroke-width="1"/>
            <rect x="-16" y="-38" width="32" height="14" rx="2" fill="${eq}" stroke="${txt}" stroke-width="1"/>
            <text x="0" y="-28" text-anchor="middle" fill="${inst}" font-size="6" font-weight="600">${tag}</text>
        </g>`;

    const PSV = (x, y, tag) => `
        <g transform="translate(${x}, ${y})">
            <polygon points="-8,0 0,-14 8,0" fill="none" stroke="${safety}" stroke-width="1.5"/>
            <line x1="-10" y1="0" x2="10" y2="0" stroke="${safety}" stroke-width="1.5"/>
            <line x1="0" y1="-14" x2="0" y2="-26" stroke="${safety}" stroke-width="1.5"/>
            <text x="0" y="12" text-anchor="middle" fill="${safety}" font-size="6" font-weight="600">${tag}</text>
        </g>`;

    const SL = (x1, y1, x2, y2, type='electronic') => {
        const dash = type === 'electronic' ? '10,3,2,3' : type === 'pneumatic' ? '4,4' : '2,2';
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${signal}" stroke-width="1" stroke-dasharray="${dash}"/>`;
    };

    const svg = `
    <svg viewBox="0 0 1400 700" xmlns="http://www.w3.org/2000/svg" style="font-family: 'Inter', sans-serif;">
        <rect width="1400" height="700" fill="${bg}"/>
        <rect x="1050" y="640" width="340" height="50" fill="${eq}" stroke="#555" stroke-width="1"/>
        <text x="1220" y="660" text-anchor="middle" fill="${txt}" font-size="11" font-weight="600">P&ID - SEPARADOR ${specs.type.toUpperCase()}</text>
        <text x="1220" y="675" text-anchor="middle" fill="${dim}" font-size="9">VPO AI Assistant - Simbologia ISA S5.1</text>
        <text x="1220" y="687" text-anchor="middle" fill="${dim}" font-size="8">V-100 | ⌀${specs.D_std_in}" × ${specs.L_ss.toFixed(1)}m | P_des=${specs.P_design.toFixed(1)} bar</text>
        <rect x="350" y="20" width="600" height="55" rx="5" fill="${eq}" stroke="${signal}" stroke-width="2" stroke-dasharray="4,2"/>
        <text x="650" y="38" text-anchor="middle" fill="${signal}" font-size="10" font-weight="700">SISTEMA DE CONTROLE DISTRIBUÍDO (DCS)</text>
        ${IC(420, 55, 'PIC-100', true)}
        ${IC(500, 55, 'LIC-100A', true)}
        ${IC(580, 55, 'LIC-100B', true)}
        ${IC(660, 55, 'TI-100', true)}
        ${IC(740, 55, 'FI-100', true)}
        ${IC(830, 55, 'AT-100', true)}
        <line x1="30" y1="300" x2="120" y2="300" stroke="${txt}" stroke-width="3"/>
        <text x="50" y="290" fill="${dim}" font-size="7">From Well</text>
        ${CV(140, 300, 'SDV-100')}
        <line x1="152" y1="300" x2="200" y2="300" stroke="${txt}" stroke-width="3"/>
        ${IC(230, 300, 'FT-100')}
        <line x1="230" y1="285" x2="230" y2="300" stroke="${txt}" stroke-width="1"/>
        ${SL(230, 285, 740, 70)}
        <line x1="245" y1="300" x2="320" y2="300" stroke="${txt}" stroke-width="3"/>
        <g transform="translate(330, 200)">
            <text x="190" y="-25" text-anchor="middle" fill="${vessel}" font-size="14" font-weight="700">V-100</text>
            <text x="190" y="-10" text-anchor="middle" fill="${dim}" font-size="8">${specs.type}</text>
            <ellipse cx="10" cy="100" rx="18" ry="100" fill="${eq}" stroke="${vessel}" stroke-width="2"/>
            <rect x="10" y="0" width="360" height="200" fill="${eq}" stroke="${vessel}" stroke-width="2"/>
            <ellipse cx="370" cy="100" rx="18" ry="100" fill="${eq}" stroke="${vessel}" stroke-width="2"/>
            <rect x="11" y="1" width="358" height="60" fill="rgba(241, 76, 76, 0.06)"/>
            <text x="190" y="35" text-anchor="middle" fill="${gas}" font-size="10" font-weight="600">GÁS</text>
            <rect x="11" y="61" width="358" height="60" fill="rgba(206, 145, 120, 0.06)"/>
            <text x="190" y="95" text-anchor="middle" fill="${oil}" font-size="10" font-weight="600">ÓLEO</text>
            <rect x="11" y="121" width="358" height="78" fill="rgba(86, 156, 214, 0.06)"/>
            <text x="190" y="165" text-anchor="middle" fill="${water}" font-size="10" font-weight="600">ÁGUA</text>
            <line x1="10" y1="61" x2="370" y2="61" stroke="${dim}" stroke-width="1" stroke-dasharray="5,3"/>
            <line x1="10" y1="121" x2="370" y2="121" stroke="${water}" stroke-width="1" stroke-dasharray="5,3"/>
            <line x1="310" y1="0" x2="310" y2="60" stroke="${vessel}" stroke-width="2" stroke-dasharray="4,2"/>
            <text x="325" y="30" fill="${dim}" font-size="6">ME</text>
            <line x1="240" y1="61" x2="240" y2="200" stroke="${vessel}" stroke-width="2"/>
            <text x="250" y="150" fill="${dim}" font-size="6">Weir</text>
            <circle cx="0" cy="100" r="5" fill="${vessel}"/>
            <circle cx="340" cy="0" r="5" fill="${gas}"/>
            <circle cx="280" cy="200" r="5" fill="${oil}"/>
            <circle cx="180" cy="200" r="5" fill="${water}"/>
        </g>
        ${PSV(620, 175, 'PSV-100')}
        <line x1="620" y1="188" x2="620" y2="200" stroke="${safety}" stroke-width="1.5"/>
        <g transform="translate(560, 170)">
            <rect x="-16" y="-10" width="32" height="20" rx="2" fill="${eq}" stroke="${safety}" stroke-width="1.5"/>
            <text x="0" y="3" text-anchor="middle" fill="${safety}" font-size="6" font-weight="600">PSHH</text>
            <text x="0" y="24" text-anchor="middle" fill="${dim}" font-size="5">100</text>
        </g>
        <line x1="560" y1="180" x2="560" y2="200" stroke="${safety}" stroke-width="1"/>
        ${IC(700, 175, 'PT-100')}
        <line x1="700" y1="190" x2="700" y2="200" stroke="${txt}" stroke-width="1"/>
        ${SL(700, 160, 420, 70)}
        ${IC(760, 300, 'TT-100')}
        <line x1="745" y1="300" x2="700" y2="300" stroke="${txt}" stroke-width="1"/>
        ${SL(760, 285, 660, 70)}
        ${IC(770, 380, 'LT-100A')}
        <line x1="755" y1="380" x2="700" y2="380" stroke="${txt}" stroke-width="1"/>
        ${SL(770, 365, 500, 70)}
        <g transform="translate(770, 340)">
            <rect x="-14" y="-9" width="28" height="18" rx="2" fill="${eq}" stroke="${safety}" stroke-width="1.5"/>
            <text x="0" y="3" text-anchor="middle" fill="${safety}" font-size="5" font-weight="600">LSHH</text>
        </g>
        <line x1="756" y1="340" x2="700" y2="340" stroke="${safety}" stroke-width="1"/>
        ${IC(770, 430, 'LT-100B')}
        <line x1="755" y1="430" x2="700" y2="430" stroke="${txt}" stroke-width="1"/>
        ${SL(770, 415, 580, 70)}
        <g transform="translate(770, 460)">
            <rect x="-14" y="-9" width="28" height="18" rx="2" fill="${eq}" stroke="${safety}" stroke-width="1.5"/>
            <text x="0" y="3" text-anchor="middle" fill="${safety}" font-size="5" font-weight="600">LSLL</text>
        </g>
        <line x1="756" y1="460" x2="700" y2="460" stroke="${safety}" stroke-width="1"/>
        <line x1="670" y1="200" x2="670" y2="130" stroke="${gas}" stroke-width="2.5" stroke-dasharray="8,3"/>
        <line x1="670" y1="130" x2="1050" y2="130" stroke="${gas}" stroke-width="2.5" stroke-dasharray="8,3"/>
        <text x="870" y="120" text-anchor="middle" fill="${gas}" font-size="8">Gás para Compressor</text>
        ${CV(900, 130, 'PCV-100')}
        ${SL(900, 92, 420, 70)}
        <line x1="610" y1="400" x2="610" y2="530" stroke="${oil}" stroke-width="2.5"/>
        <line x1="610" y1="530" x2="1050" y2="530" stroke="${oil}" stroke-width="2.5"/>
        <text x="870" y="520" text-anchor="middle" fill="${oil}" font-size="8">Óleo para Tanque</text>
        ${CV(850, 530, 'LCV-100B')}
        ${SL(850, 492, 580, 70)}
        ${IC(1000, 530, 'AT-100')}
        ${SL(1000, 515, 830, 70)}
        <line x1="510" y1="400" x2="510" y2="600" stroke="${water}" stroke-width="2.5"/>
        <line x1="510" y1="600" x2="1050" y2="600" stroke="${water}" stroke-width="2.5"/>
        <text x="870" y="590" text-anchor="middle" fill="${water}" font-size="8">Água para Tratamento</text>
        ${CV(750, 600, 'LCV-100A')}
        ${SL(750, 562, 500, 70)}
        <rect x="10" y="620" width="320" height="70" fill="${eq}" stroke="#555" stroke-width="1" rx="3"/>
        <text x="20" y="637" fill="${txt}" font-size="9" font-weight="600">Simbologia ISA S5.1:</text>
        ${IC(35, 655, 'XX')}
        <text x="58" y="658" fill="${dim}" font-size="7">Instrumento Campo</text>
        ${IC(155, 655, 'XX', true)}
        <text x="178" y="658" fill="${dim}" font-size="7">Instrumento DCS</text>
        <line x1="20" y1="678" x2="60" y2="678" stroke="${signal}" stroke-width="1" stroke-dasharray="10,3,2,3"/>
        <text x="65" y="681" fill="${dim}" font-size="7">Sinal Electrónico</text>
        <line x1="160" y1="678" x2="200" y2="678" stroke="${safety}" stroke-width="1.5"/>
        <text x="205" y="681" fill="${dim}" font-size="7">Segurança (SIS)</text>
    </svg>`;

    return `
        <strong>7 · Diagrama P&ID (Piping & Instrumentation)</strong><br>
        <small>Simbologia ISA S5.1 — Malhas LIC, PIC, instrumentos de segurança (PSV, PSHH, LSHH, LSLL) e DCS</small><br><br>
        ${wrapDiagramWithToolbar(svg, 'PID - Piping and Instrumentation Diagram')}`;
}

// ---- PASSO 8: Resumo ----
function chatStep8_Summary(p, specs) {
    const effGL = separatorModel.separationEfficiencyGL(p.flowRate, p.pressure, p.temperature, p.gor);
    const effOA = separatorModel.separationEfficiencyOA(p.flowRate, p.temperature, p.waterCut, p.viscosity);
    const energy = separatorModel.energyConsumption(p.flowRate, p.pressure, p.temperature);

    return `
        <strong>8 · Resumo Executivo e Recomendações</strong><br><br>
        <table>
            <tbody>
                <tr><td><strong>Tipo</strong></td><td><span class="val">${specs.type}</span></td></tr>
                <tr><td><strong>Dimensões</strong></td><td><span class="val">⌀${specs.D_std_in}" × ${specs.L_ss.toFixed(1)}m</span> (L/D = ${specs.LD_ratio})</td></tr>
                <tr><td><strong>P Projecto</strong></td><td><span class="val">${specs.P_design.toFixed(1)} bar</span></td></tr>
                <tr><td><strong>Material</strong></td><td><span class="val">${specs.material}</span> | t = ${specs.t_total} mm</td></tr>
                <tr><td><strong>Peso</strong></td><td><span class="val">${specs.weight.toLocaleString()} kg</span></td></tr>
                <tr><td><strong>Efic. G-L</strong></td><td><span class="val ${effGL > 0.93 ? 'ok' : effGL > 0.90 ? 'warn' : 'crit'}">${(effGL*100).toFixed(1)}%</span></td></tr>
                <tr><td><strong>Efic. O-A</strong></td><td><span class="val ${effOA > 0.87 ? 'ok' : effOA > 0.84 ? 'warn' : 'crit'}">${(effOA*100).toFixed(1)}%</span></td></tr>
                <tr><td><strong>Energia</strong></td><td><span class="val">${energy.toFixed(2)} MWh/1000m³</span></td></tr>
            </tbody>
        </table>
        <br><strong>Recomendações</strong>
        <ul class="int-list">
            <li><strong>Malha de Nível</strong> — LIC com transmissores radar para interface O/A. LCV nas saídas de óleo e água.</li>
            <li><strong>Controle de Pressão</strong> — PCV na linha de gás via PIC. PSV para alívio a ${(specs.P_design * 1.1).toFixed(1)} bar.</li>
            <li><strong>Segurança (SIS)</strong> — PSHH e LSHH com shutdown (SDV). LSLL contra operação a seco.</li>
            ${p.waterCut > 50 ? `<li><strong>Emulsão</strong> — Injecção de desemulsificante a montante (WC = ${p.waterCut}%).</li>` : ''}
            ${p.viscosity > 20 ? `<li><strong>Aquecimento</strong> — Manter T > ${Math.max(60, p.temperature)}°C para reduzir viscosidade.</li>` : ''}
            <li><strong>BSW</strong> — Analisador AT-100 na linha de óleo (BSW < 1%).</li>
        </ul>
        <div class="reco-box" style="margin-top: 8px;">
            <small><strong>Nota:</strong> Dimensionamento preliminar (FEED). O projecto detalhado requer análise de fadiga, vibrações, CFD e verificação ASME/API completa.</small>
        </div>`;
}

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    setupSliders();
    renderDashboard();
});
