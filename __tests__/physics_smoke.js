// Smoke test numérico dos modelos físicos refactorados.
// Carrega app.js num sandbox Node sem DOM/Plotly e verifica invariantes.

const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');

// Sandbox mínimo: stubs para globals do browser
const noop = () => {};
const stubEl = { addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop, setAttribute: noop, getAttribute: () => null, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, style: { setProperty: noop }, replaceChildren: noop, focus: noop, select: noop, prepend: noop };
const stubDoc = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ ...stubEl }),
    addEventListener: noop,
    removeEventListener: noop,
    documentElement: { setAttribute: noop, getAttribute: () => null }
};
const sandbox = {
    document: stubDoc,
    window: { innerWidth: 1920, addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    navigator: { userAgent: 'node' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Plotly: undefined,
    tf: undefined,
    Intl,
    Math, Number, Array, Object, String, Boolean, JSON, Date,
    Set, Map,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

// Apêndice: expõe no sandbox os bindings que são `const` (não escapam da module scope do VM)
const bootstrap = `
;try { this.separatorModel = separatorModel; } catch(e){}
try { this.fuzzyController = fuzzyController; } catch(e){}
try { this.optimizer = optimizer; } catch(e){}
try { this.validateParams = validateParams; } catch(e){}
try { this.SeparatorModel = SeparatorModel; } catch(e){}
`;

vm.createContext(sandbox);
try {
    vm.runInContext(src + bootstrap, sandbox, { filename: 'app.js' });
} catch (e) {
    console.error('ERRO AO CARREGAR app.js NO SANDBOX:', e.message);
    process.exit(1);
}

// -- Testes --
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
    if (cond) { console.log('  ok  ', name); pass++; }
    else      { console.log('  FAIL', name, extra); fail++; }
}

const sep = sandbox.separatorModel;
if (!sep) { console.error('separatorModel não foi exportado ao sandbox'); process.exit(1); }

console.log('\n[1] Morsi-Alexander Cd — monotonia por regime');
const CdS = sep.cdMorsiAlexander(0.05);   // Stokes: Cd ≈ 24/0.05 = 480
const CdI = sep.cdMorsiAlexander(100);    // intermediário
const CdN = sep.cdMorsiAlexander(5e4);    // Newton
check('Cd(Re=0.05) ≈ 24/Re alto', Math.abs(CdS - 24/0.05) < 1, `got=${CdS.toFixed(2)}`);
check('Cd(Re=5e4) ≈ 0.44 (Newton)', Math.abs(CdN - 0.44) < 0.01, `got=${CdN.toFixed(3)}`);
check('Cd monotonia geral CdS > CdI > CdN', CdS > CdI && CdI > CdN, `CdS=${CdS.toFixed(1)} CdI=${CdI.toFixed(2)} CdN=${CdN.toFixed(2)}`);

console.log('\n[2] Velocidade terminal iterativa');
// Gota de água de 500 μm em óleo, μ=15 cP ⇒ Pa·s=0.015
const vT = sep.terminalVelocity(500e-6, 1020, 870, 0.015);
check('v_term > 0 para ρ_água > ρ_óleo', vT > 0, `v=${vT.toExponential(2)}`);
// Stokes pura dá v = g·d²·Δρ/(18μ) = 9.81·(5e-4)²·150/(18·0.015) ≈ 1.36e-3 m/s
// Com Re pequeno (<1) deve bater com Stokes a <5%
const vStokesCheck = (9.81 * (500e-6)**2 * 150) / (18 * 0.015);
check('v_term bate com Stokes em Re<<1', Math.abs(vT - vStokesCheck) / vStokesCheck < 0.05, `v=${vT.toExponential(2)} vStokes=${vStokesCheck.toExponential(2)}`);

console.log('\n[3] Regime diagnostico');
check('Regime stokes para gota pequena/óleo viscoso', sep.particleRegime(500e-6, 1020, 870, 0.015) === 'stokes');

console.log('\n[4] Souders-Brown GPSA');
const K_atm = sep.soudersBrownK(1, 'mesh');
const K_30 = sep.soudersBrownK(30, 'mesh');
const K_60 = sep.soudersBrownK(60, 'mesh');
check('K(1 bar, mesh) = 0.107', Math.abs(K_atm - 0.107) < 1e-6, `K=${K_atm}`);
check('K cai com P (GPSA)', K_atm > K_30 && K_30 > K_60, `atm=${K_atm.toFixed(3)} 30=${K_30.toFixed(3)} 60=${K_60.toFixed(3)}`);
const K_vane = sep.soudersBrownK(10, 'vane');
const K_mesh = sep.soudersBrownK(10, 'mesh');
check('K_vane > K_mesh (maior capacidade)', K_vane > K_mesh, `vane=${K_vane.toFixed(3)} mesh=${K_mesh.toFixed(3)}`);

console.log('\n[5] Redlich-Kwong EoS');
const Z_atm = sep.zFactorRK(1, 300);
const Z_50bar = sep.zFactorRK(50, 300);
check('Z(1 bar, 300 K) ≈ 1', Math.abs(Z_atm - 1) < 0.02, `Z=${Z_atm.toFixed(3)}`);
check('Z(50 bar) < Z(1 bar) para gás natural', Z_50bar < Z_atm, `Z1=${Z_atm.toFixed(3)} Z50=${Z_50bar.toFixed(3)}`);
check('Z sempre em [0.1, 1.2]', Z_50bar >= 0.1 && Z_50bar <= 1.2, `Z=${Z_50bar}`);
const rho_atm = sep.gasDensityRK(1, 288.15, 18);
const rho_50 = sep.gasDensityRK(50, 288.15, 18);
check('ρ_gás(50 bar) >> ρ_gás(1 bar)', rho_50 > rho_atm * 30, `atm=${rho_atm.toFixed(2)} 50bar=${rho_50.toFixed(2)}`);

console.log('\n[6] Weber crítico / breakup de gotas');
const dMax_lo = sep.maxStableDroplet(0.1, 870);  // v baixa ⇒ d_max grande
const dMax_hi = sep.maxStableDroplet(5, 870);    // v alta  ⇒ d_max pequeno
check('d_max cai com velocidade² (We crit)', dMax_hi < dMax_lo / 2000, `lo=${dMax_lo.toExponential(2)} hi=${dMax_hi.toExponential(2)}`);

console.log('\n[7] Eficiências com guards de entrada');
const effGL_ok = sep.separationEfficiencyGL(1250, 11.3, 62, 95);
check('effGL ∈ [0.70, 0.995]', effGL_ok >= 0.70 && effGL_ok <= 0.995, `eff=${effGL_ok.toFixed(4)}`);
const effGL_bad = sep.separationEfficiencyGL(0, 11.3, 62, 95);   // flowRate inválido
check('effGL(flow=0) retorna 0 (guard)', effGL_bad === 0, `eff=${effGL_bad}`);
const effGL_badP = sep.separationEfficiencyGL(1250, -5, 62, 95); // P negativa
check('effGL(P<0) retorna 0 (guard)', effGL_badP === 0, `eff=${effGL_badP}`);
const effOA_ok = sep.separationEfficiencyOA(1250, 62, 42, 15);
check('effOA ∈ [0.60, 0.96]', effOA_ok >= 0.60 && effOA_ok <= 0.96, `eff=${effOA_ok.toFixed(4)}`);

console.log('\n[8] Validação de domínio');
const err_ok = sandbox.validateParams({
    flowRate: 1250, pressure: 11.3, temperature: 62, waterCut: 42, gor: 95, viscosity: 15,
    rhoOil: 870, rhoWater: 1020, rhoGas: 1.2
});
check('baseline passa validação (0 erros)', err_ok.length === 0, `errs=${err_ok.join(' | ')}`);
const err_inv = sandbox.validateParams({
    flowRate: 1250, pressure: 11.3, temperature: 62, waterCut: 42, gor: 95, viscosity: 15,
    rhoOil: 1050, rhoWater: 1020, rhoGas: 1.2   // ρ_óleo >= ρ_água
});
check('ρ_óleo ≥ ρ_água detectado', err_inv.some(e => e.includes('ρ_óleo')), `errs=${err_inv.join(' | ')}`);
const err_neg = sandbox.validateParams({
    flowRate: 1250, pressure: -1, temperature: 62, waterCut: 42, gor: 95, viscosity: 15,
    rhoOil: 870, rhoWater: 1020, rhoGas: 1.2
});
check('P ≤ 0 detectado', err_neg.some(e => e.toLowerCase().includes('pressão')), `errs=${err_neg.join(' | ')}`);
const err_nan = sandbox.validateParams({
    flowRate: NaN, pressure: 11.3, temperature: 62, waterCut: 42, gor: 95, viscosity: 15,
    rhoOil: 870, rhoWater: 1020, rhoGas: 1.2
});
check('NaN na vazão detectado', err_nan.some(e => e.toLowerCase().includes('vazão')), `errs=${err_nan.join(' | ')}`);

console.log('\n[9] Defuzzificação Sugeno — agregação por acção');
const fuzzy = sandbox.fuzzyController;
if (fuzzy) {
    // Força várias regras com a mesma acção para ver se soma
    const fake = [
        { action: 'reduce_pressure', activation: 0.3, priority: 1, description: 'r1' },
        { action: 'reduce_pressure', activation: 0.5, priority: 1, description: 'r2' },
        { action: 'increase_heating', activation: 0.9, priority: 2, description: 'r3' },
    ];
    const res = fuzzy.defuzzify(fake);
    // reduce_pressure: 1*(0.3+0.5) = 0.8; increase_heating: 0.5*0.9 = 0.45 ⇒ reduce_pressure vence
    check('Acção vencedora correcta (massa agregada)', res.action === 'reduce_pressure', `got=${res.action}`);
    check('aggregated[] presente e ordenado', Array.isArray(res.aggregated) && res.aggregated[0].action === 'reduce_pressure');
    check('confidence ∈ [0,1]', res.confidence >= 0 && res.confidence <= 1, `conf=${res.confidence}`);
    // caso vazio
    const empty = fuzzy.defuzzify([]);
    check('Lista vazia → maintain', empty.action === 'maintain');
} else {
    console.log('  WARN fuzzyController indisponível no sandbox');
}

console.log(`\n==== ${pass} OK · ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
