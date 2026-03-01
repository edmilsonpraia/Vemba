// ============================================================================
// SISTEMA INTELIGENTE DE OTIMIZAÇÃO DE SEPARADORES - VERSÃO JAVASCRIPT
// ============================================================================

// Classe para modelagem matemática do separador
class SeparatorModel {
    constructor() {
        this.g = 9.81; // aceleração da gravidade (m/s²)
        this.pi = Math.PI;
    }

    // Calcula velocidade terminal pela Lei de Stokes
    // v = (2gr²(ρp - ρf))/(9μ)
    stokesVelocity(radius, rho_p, rho_f, mu) {
        return (2 * this.g * Math.pow(radius, 2) * (rho_p - rho_f)) / (9 * mu);
    }

    // Velocidade crítica de Souders-Brown para evitar arraste
    // vg = K√((ρl - ρg)/ρg)
    soudersBrownVelocity(rho_l, rho_g, K = 0.107) {
        return K * Math.sqrt((rho_l - rho_g) / rho_g);
    }

    // Modelo de eficiência de separação gás-líquido
    // Baseado em correlações empíricas de separadores trifásicos
    separationEfficiencyGL(flowRate, pressure, temperature, gor) {
        const baseEff = 0.95;
        // Vazão: eficiência cai com desvio do ponto ótimo (~1000 m³/dia)
        const flowFactor = -0.04 * Math.pow((flowRate - 1000) / 700, 2);
        // Pressão: maior pressão melhora separação G-L (mais gás dissolve, menos arraste)
        const pressFactor = 0.03 * Math.log(pressure / 10);
        // Temperatura: aumento moderado ajuda (reduz viscosidade)
        const tempFactor = 0.015 * (temperature - 60) / 25;
        // GOR: alto GOR dificulta separação (mais gás para separar)
        const gorFactor = -0.03 * Math.pow((gor - 80) / 100, 2);

        const efficiency = baseEff + flowFactor + pressFactor + tempFactor + gorFactor;
        return Math.max(0.85, Math.min(0.99, efficiency));
    }

    // Modelo de eficiência de separação óleo-água
    // Baseado em Lei de Stokes: maior T -> menor viscosidade -> melhor separação
    separationEfficiencyOA(flowRate, temperature, waterCut, viscosity) {
        const baseEff = 0.89;
        // Vazão: menor tempo de residência reduz eficiência
        const flowFactor = -0.05 * Math.pow((flowRate - 800) / 800, 2);
        // Temperatura: efeito forte via redução de viscosidade (Arrhenius-like)
        const tempFactor = 0.04 * (1 - Math.exp(-(temperature - 45) / 20));
        // Corte de água: emulsões mais estáveis com alto BSW
        const waterFactor = -0.08 * Math.pow(waterCut / 100, 1.5);
        // Viscosidade: relação directa com Lei de Stokes (v ~ 1/mu)
        const viscFactor = -0.06 * Math.log(viscosity / 10);

        const efficiency = baseEff + flowFactor + tempFactor + waterFactor + viscFactor;
        return Math.max(0.75, Math.min(0.96, efficiency));
    }

    // Modelo de consumo energético (MWh/1000m³)
    // Inclui bombeamento, aquecimento e compressão
    energyConsumption(flowRate, pressure, temperature) {
        // Bombeamento: cresce com Q^1.2 (perdas de carga)
        const pumpEnergy = 0.8 * Math.pow(flowRate / 1000, 1.2);
        // Compressão: proporcional à razão de pressão
        const compressionEnergy = 0.3 * (pressure / 10);
        // Aquecimento: proporcional a delta-T acima da ambiente (35°C)
        const heatingEnergy = 0.015 * Math.max(0, temperature - 35);
        // Termo cruzado: alta vazão + alta pressão = mais energia
        const crossTerm = 0.0002 * flowRate * (pressure - 8.5);

        return pumpEnergy + compressionEnergy + heatingEnergy + crossTerm;
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

    // Implementação simplificada do NSGA-II
    nsgaIIOptimization(bounds, popSize = 50, generations = 100) {
        const nVars = bounds.length;
        let population = this.generateRandomPopulation(popSize, bounds);
        const bestSolutions = [];

        for (let gen = 0; gen < generations; gen++) {
            // Avaliação dos objetivos
            const objectives = population.map(ind => this.evaluateObjectives(ind));

            // Seleção não-dominada
            const paretoFront = this.fastNonDominatedSort(objectives);

            // Armazenar melhor solução
            if (paretoFront.length > 0) {
                const bestIdx = paretoFront[0];
                bestSolutions.push({
                    generation: gen,
                    solution: [...population[bestIdx]],
                    objectives: [...objectives[bestIdx]]
                });
            }

            // Evolução da população
            population = this.evolvePopulation(population, objectives, bounds);
        }

        return bestSolutions;
    }

    generateRandomPopulation(size, bounds) {
        const population = [];
        for (let i = 0; i < size; i++) {
            const individual = bounds.map(bound =>
                Math.random() * (bound[1] - bound[0]) + bound[0]
            );
            population.push(individual);
        }
        return population;
    }

    evaluateObjectives(solution) {
        try {
            let [flowRate, pressure, temperature, waterCut] = solution;

            // Garantir limites
            flowRate = Math.max(150, Math.min(2400, flowRate));
            pressure = Math.max(8.5, Math.min(15.2, pressure));
            temperature = Math.max(45, Math.min(85, temperature));
            waterCut = Math.max(15, Math.min(78, waterCut));

            // Objetivo 1: Maximizar eficiência (convertido para minimização)
            const effGL = this.separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, 100);
            const effOA = this.separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, 15);
            const efficiencyObj = -(effGL + effOA) / 2;

            // Objetivo 2: Minimizar consumo energético
            const energyObj = this.separatorModel.energyConsumption(flowRate, pressure, temperature);

            // Objetivo 3: Minimizar emissões
            const emissionsObj = energyObj * 0.5 + 0.1 * pressure;

            return [efficiencyObj, energyObj, emissionsObj];
        } catch (e) {
            return [0.0, 10.0, 10.0];
        }
    }

    fastNonDominatedSort(objectives) {
        const n = objectives.length;
        const dominatedCount = new Array(n).fill(0);
        const fronts = [[]];

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i !== j) {
                    if (this.dominates(objectives[i], objectives[j])) {
                        // i domina j
                    } else if (this.dominates(objectives[j], objectives[i])) {
                        dominatedCount[i]++;
                    }
                }
            }

            if (dominatedCount[i] === 0) {
                fronts[0].push(i);
            }
        }

        return fronts[0].length > 0 ? fronts[0] : [0];
    }

    dominates(obj1, obj2) {
        let betterInOne = false;
        for (let i = 0; i < obj1.length; i++) {
            if (obj1[i] > obj2[i]) return false;
            if (obj1[i] < obj2[i]) betterInOne = true;
        }
        return betterInOne;
    }

    evolvePopulation(population, objectives, bounds) {
        const newPopulation = population.map(ind => [...ind]);
        const mutationRate = 0.1;

        for (let i = 0; i < population.length; i++) {
            if (Math.random() < mutationRate) {
                for (let j = 0; j < bounds.length; j++) {
                    if (Math.random() < 0.3) {
                        const mutation = this.randomNormal(0, 0.1) * (bounds[j][1] - bounds[j][0]);
                        newPopulation[i][j] += mutation;
                        newPopulation[i][j] = Math.max(bounds[j][0], Math.min(bounds[j][1], newPopulation[i][j]));
                    }
                }
            }
        }

        return newPopulation;
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

    // Gerar dados de treinamento
    generateTrainingData(nSamples = 1000) {
        const data = {
            inputs: [],
            outputs: []
        };

        for (let i = 0; i < nSamples; i++) {
            // Gerar parâmetros aleatórios
            const flowRate = 150 + Math.random() * (2400 - 150);
            const pressure = 8.5 + Math.random() * (15.2 - 8.5);
            const temperature = 45 + Math.random() * (85 - 45);
            const waterCut = 15 + Math.random() * (78 - 15);
            const gor = 45 + Math.random() * (180 - 45);
            const viscosity = 10 + Math.random() * (30 - 10);

            // Calcular saídas usando modelo físico
            const effGL = this.separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor);
            const effOA = this.separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity);
            const energy = this.separatorModel.energyConsumption(flowRate, pressure, temperature);

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

    // Defuzzificação
    defuzzify(activatedRules) {
        if (activatedRules.length === 0) {
            return {
                action: 'maintain',
                confidence: 0,
                description: 'Manter parâmetros atuais'
            };
        }

        // Ordenar por ativação e prioridade
        activatedRules.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.activation - a.activation;
        });

        const bestRule = activatedRules[0];

        return {
            action: bestRule.action,
            confidence: bestRule.activation,
            description: this.getActionDescription(bestRule.action),
            rule: bestRule.description,
            allRules: activatedRules
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

// Atualizar valores dos sliders
function setupSliders() {
    const sliders = ['flowRate', 'pressure', 'temperature', 'waterCut', 'gor', 'viscosity'];

    sliders.forEach(sliderId => {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(sliderId + 'Value');

        slider.addEventListener('input', function() {
            valueDisplay.textContent = this.value;
            currentParams[sliderId] = parseFloat(this.value);
            updateDashboard();
        });
    });

    // Inputs numéricos
    ['rhoOil', 'rhoWater', 'rhoGas'].forEach(inputId => {
        const input = document.getElementById(inputId);
        input.addEventListener('change', function() {
            currentParams[inputId] = parseFloat(this.value);
            updateDashboard();
        });
    });
}

// Atualizar dashboard
function updateDashboard() {
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

    const html = `
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Eficiência G-L</div>
                <div class="metric-value">${(effGL * 100).toFixed(1)}%</div>
                <div class="metric-delta ${deltaGL >= 0 ? 'positive' : 'negative'}">
                    ${deltaGL >= 0 ? '↑' : '↓'} ${Math.abs(deltaGL).toFixed(1)}%
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Eficiência O-A</div>
                <div class="metric-value">${(effOA * 100).toFixed(1)}%</div>
                <div class="metric-delta ${deltaOA >= 0 ? 'positive' : 'negative'}">
                    ${deltaOA >= 0 ? '↑' : '↓'} ${Math.abs(deltaOA).toFixed(1)}%
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Consumo de Energia</div>
                <div class="metric-value">${energy.toFixed(2)}</div>
                <div class="metric-delta ${deltaEnergy <= 0 ? 'positive' : 'negative'}">
                    MWh/1000m³
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Impacto Econômico</div>
                <div class="metric-value">$${Math.abs(efficiencyGain).toFixed(0)}</div>
                <div class="metric-delta ${efficiencyGain >= 0 ? 'positive' : 'negative'}">
                    ${efficiencyGain >= 0 ? '↑' : '↓'} ${(Math.abs(efficiencyGain)/baselineRevenue*100).toFixed(1)}% anual
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
        x: dates,
        y: efficiencyData,
        mode: 'lines+markers',
        name: 'Eficiência Total (%)',
        line: { color: '#1f77b4', width: 3 },
        marker: { size: 4 }
    };

    const trace2 = {
        x: dates,
        y: upperBound,
        mode: 'lines',
        line: { width: 0 },
        showlegend: false,
        hoverinfo: 'skip'
    };

    const trace3 = {
        x: dates,
        y: lowerBound,
        mode: 'lines',
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: 'rgba(31, 119, 180, 0.2)',
        name: 'Banda de Confiança (±2%)',
        hoverinfo: 'skip'
    };

    const layout = {
        title: 'Tendência de Eficiência ao Longo do Tempo',
        xaxis: { title: 'Data' },
        yaxis: {
            title: 'Eficiência (%)',
            tickformat: '.1%',
            range: [0.85, 1.0]
        },
        height: 400,
        shapes: [{
            type: 'line',
            x0: dates[0],
            x1: dates[dates.length - 1],
            y0: 0.95,
            y1: 0.95,
            line: {
                color: 'red',
                width: 2,
                dash: 'dash'
            }
        }],
        annotations: [{
            x: dates[dates.length - 1],
            y: 0.95,
            text: 'Meta: 95%',
            showarrow: false,
            xanchor: 'left'
        }]
    };

    Plotly.newPlot('efficiencyTrendChart', [trace1, trace2, trace3], layout, {responsive: true});
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
        name: '🔵 Atual',
        line: { color: '#ff7f0e', width: 3 },
        fillcolor: 'rgba(255, 127, 14, 0.3)'
    };

    const trace2 = {
        type: 'scatterpolar',
        r: benchmarkValues,
        theta: categories,
        fill: 'toself',
        name: '🟢 Benchmark',
        line: { color: '#2ca02c', width: 3 },
        fillcolor: 'rgba(44, 160, 44, 0.2)'
    };

    const trace3 = {
        type: 'scatterpolar',
        r: targetValues,
        theta: categories,
        name: 'Meta',
        line: { color: '#d62728', width: 2, dash: 'dash' }
    };

    const layout = {
        title: 'Performance vs Benchmark vs Meta',
        polar: {
            radialaxis: {
                visible: true,
                range: [0, 100]
            }
        },
        height: 400
    };

    Plotly.newPlot('performanceRadarChart', [trace1, trace2, trace3], layout, {responsive: true});
}

// Renderizar Modelagem Matemática
function renderModeling() {
    const html = `
        <div class="card">
            <h3>Equações Fundamentais do Processo</h3>
            <div class="formulas-grid">
                <div class="formula-card">
                    <strong>Lei de Stokes</strong>
                    <div class="formula">v = 2gr²(ρₚ - ρf)/(9μ)</div>
                </div>
                <div class="formula-card">
                    <strong>Souders-Brown</strong>
                    <div class="formula">vg = K√((ρₗ - ρg)/ρg)</div>
                </div>
                <div class="formula-card">
                    <strong>Eficiência Total</strong>
                    <div class="formula">η = (Qout,sep/Qin,total) × 100%</div>
                </div>
                <div class="formula-card">
                    <strong>Tempo de Residência</strong>
                    <div class="formula">τ = V/Q</div>
                </div>
                <div class="formula-card">
                    <strong>Balanço de Massa</strong>
                    <div class="formula">∂(αᵢρᵢ)/∂t + ∇·(αᵢρᵢvᵢ) = Γᵢ</div>
                </div>
                <div class="formula-card">
                    <strong>Critério de Arraste</strong>
                    <div class="formula">CD = 24/Re (Re < 1)</div>
                </div>
            </div>
        </div>

        <div class="calculator-grid">
            <div class="card">
                <h4>Lei de Stokes - Velocidade Terminal</h4>
                <div class="input-group">
                    <label>Raio da gota (μm)</label>
                    <input type="number" id="dropRadius" value="100" min="10" max="1000">
                </div>
                <button onclick="calculateStokes()">Calcular</button>
                <div id="stokesResult"></div>
            </div>

            <div class="card">
                <h4>Correlação de Souders-Brown</h4>
                <button onclick="calculateSoudersBrown()">Calcular</button>
                <div id="soudersBrownResult"></div>
            </div>
        </div>

        <div class="card">
            <div id="stokesChart"></div>
        </div>
    `;

    document.getElementById('modeling').innerHTML = html;
    calculateStokes();
    calculateSoudersBrown();
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

    const dropSizes = [];
    const velocities = [];

    for (let i = 10; i <= 1000; i += 10) {
        dropSizes.push(i);
        const radius = i * 1e-6;
        const v = separatorModel.stokesVelocity(radius, rhoWater, rhoOil, muOil);
        velocities.push(v * 1000); // mm/s
    }

    const trace = {
        x: dropSizes,
        y: velocities,
        mode: 'lines',
        name: '📉 Velocidade de Sedimentação',
        line: { color: '#d62728', width: 3 }
    };

    const layout = {
        title: 'Lei de Stokes - Análise de Separabilidade',
        xaxis: {
            title: 'Diâmetro da Gota (μm)',
            type: 'log'
        },
        yaxis: { title: 'Velocidade de Sedimentação (mm/s)' },
        height: 400
    };

    Plotly.newPlot('stokesChart', [trace], layout, {responsive: true});
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

        ${nnPredictor.isTrained ? `
        <div class="card">
            <h4>Arquitetura da Rede Neural</h4>
            <div id="architectureViz"></div>
        </div>

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

    if (nnPredictor.isTrained) {
        renderArchitecture();
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
    const architecture = nnPredictor.getArchitecture();
    if (!architecture) return;

    const html = `
        <div style="display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap; gap: 1rem;">
            ${architecture.map((layer, idx) => `
                <div style="text-align: center;">
                    <div style="background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
                                color: white; padding: 1rem; border-radius: 0.5rem; min-width: 120px;">
                        <div style="font-weight: 600; margin-bottom: 0.5rem;">${layer.type}</div>
                        ${layer.units ? `<div style="font-size: 0.875rem;">Units: ${layer.units}</div>` : ''}
                        ${layer.activation ? `<div style="font-size: 0.75rem; opacity: 0.9;">${layer.activation}</div>` : ''}
                    </div>
                    ${idx < architecture.length - 1 ? '<div style="margin: 0.5rem 0;">→</div>' : ''}
                </div>
            `).join('')}
        </div>
    `;

    document.getElementById('architectureViz').innerHTML = html;
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
    const { flowRate, pressure, temperature, waterCut, gor, viscosity } = currentParams;

    const effGL = separatorModel.separationEfficiencyGL(flowRate, pressure, temperature, gor);
    const effOA = separatorModel.separationEfficiencyOA(flowRate, temperature, waterCut, viscosity);
    const energy = separatorModel.energyConsumption(flowRate, pressure, temperature);

    const avgEff = (effGL + effOA) / 2;
    const baselineRevenue = 180000;
    const energyCost = 50; // USD/MWh

    const revenueGain = (avgEff - 0.92) * baselineRevenue;
    const energyCostYear = energy * (flowRate / 1000) * 365 * energyCost;
    const netBenefit = revenueGain - energyCostYear;

    const html = `
        <h3><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M14 2v12H2V2h12zm-1 1H3v10h10V3zM8.5 4v1.5H10v1H8.5v1H10v1H8.5V10h3v1H4.5v-1h3V8.5H6v-1h1.5v-1H6v-1h1.5V4h1z"/></svg> Análise Econômica</h3>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Ganho de Receita</div>
                <div class="metric-value">$${revenueGain.toFixed(0)}</div>
                <div class="metric-delta">/ano</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Custo de Energia</div>
                <div class="metric-value">$${energyCostYear.toFixed(0)}</div>
                <div class="metric-delta">/ano</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Benefício Líquido</div>
                <div class="metric-value">$${netBenefit.toFixed(0)}</div>
                <div class="metric-delta">/ano</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">ROI</div>
                <div class="metric-value">${(netBenefit / 100000 * 100).toFixed(1)}%</div>
                <div class="metric-delta">anual</div>
            </div>
        </div>

        <h4>Análise de Sensibilidade</h4>
        <div class="chart-container">
            <div id="economicChart"></div>
        </div>

        <div class="info-box">
            <strong>Premissas:</strong><br>
            • Receita base: $${baselineRevenue.toLocaleString()}/ano<br>
            • Custo de energia: $${energyCost}/MWh<br>
            • Eficiência de referência: 92%<br>
            • Operação: 365 dias/ano
        </div>
    `;

    document.getElementById('economic').innerHTML = html;
    renderEconomicChart();
}

function renderEconomicChart() {
    const efficiencies = [];
    const revenues = [];
    const costs = [];
    const netBenefits = [];

    const baselineRevenue = 180000;
    const energyCostPerMWh = 50;
    const { flowRate, pressure, temperature } = currentParams;

    for (let eff = 0.85; eff <= 0.99; eff += 0.01) {
        efficiencies.push(eff * 100);
        const revenue = (eff - 0.92) * baselineRevenue;
        revenues.push(revenue);

        const energy = separatorModel.energyConsumption(flowRate, pressure, temperature);
        const cost = energy * (flowRate / 1000) * 365 * energyCostPerMWh;
        costs.push(cost);

        netBenefits.push(revenue - cost);
    }

    const trace1 = {
        x: efficiencies,
        y: revenues,
        mode: 'lines',
        name: 'Ganho de Receita',
        line: { color: '#2ca02c', width: 3 }
    };

    const trace2 = {
        x: efficiencies,
        y: costs,
        mode: 'lines',
        name: 'Custo de Energia',
        line: { color: '#d62728', width: 3 }
    };

    const trace3 = {
        x: efficiencies,
        y: netBenefits,
        mode: 'lines',
        name: 'Benefício Líquido',
        line: { color: '#1f77b4', width: 3 }
    };

    const layout = {
        title: 'Análise de Sensibilidade Econômica',
        xaxis: { title: 'Eficiência (%)' },
        yaxis: { title: 'Valor (USD/ano)' },
        height: 400
    };

    Plotly.newPlot('economicChart', [trace1, trace2, trace3], layout, {responsive: true});
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
                    <div class="chat-avatar"><svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M5 3a3 3 0 1 1 6 0v1a3 3 0 0 1-6 0V3zm3-2a2 2 0 0 0-2 2v1a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2zM4.5 7A2.5 2.5 0 0 0 2 9.5V12a4 4 0 0 0 3.5 3.97V15A3 3 0 0 1 3 12V9.5A1.5 1.5 0 0 1 4.5 8h7A1.5 1.5 0 0 1 13 9.5V12a3 3 0 0 1-2.5 2.96v1A4 4 0 0 0 14 12V9.5A2.5 2.5 0 0 0 11.5 7h-7zM8 11a1 1 0 0 1 1 1v2.5a1 1 0 1 1-2 0V12a1 1 0 0 1 1-1z"/></svg></div>
                    <div class="chat-bubble">
                        <strong>VPO AI Assistant</strong><br>
                        A iniciar scan e análise completa dos parâmetros operacionais...
                    </div>
                </div>
            </div>
            <div class="chat-input-bar">
                <input type="text" id="chatInput" placeholder="Escreva um comando ou pergunta..." onkeydown="if(event.key==='Enter')sendChatMessage()"/>
                <button onclick="sendChatMessage()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
            </div>
        </div>
    `;
    document.getElementById('assistant').innerHTML = html;
    chatHistory = [];
    setTimeout(() => runFullChatAnalysis({ ...currentParams }), 300);
}

// SVG avatars
const AI_AVATAR = `<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M5 3a3 3 0 1 1 6 0v1a3 3 0 0 1-6 0V3zm3-2a2 2 0 0 0-2 2v1a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2zM4.5 7A2.5 2.5 0 0 0 2 9.5V12a4 4 0 0 0 3.5 3.97V15A3 3 0 0 1 3 12V9.5A1.5 1.5 0 0 1 4.5 8h7A1.5 1.5 0 0 1 13 9.5V12a3 3 0 0 1-2.5 2.96v1A4 4 0 0 0 14 12V9.5A2.5 2.5 0 0 0 11.5 7h-7zM8 11a1 1 0 0 1 1 1v2.5a1 1 0 1 1-2 0V12a1 1 0 0 1 1-1z"/></svg>`;
const USER_AVATAR = `<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 4a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm-1 5a2 2 0 0 0-2 2v.5c0 .28.22.5.5.5h9a.5.5 0 0 0 .5-.5V11a2 2 0 0 0-2-2H5zm-1 2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1H4zm-2 2.5h12v1H2v-1z"/></svg>`;

// Helpers de chat
function addChatMsg(role, content) {
    const container = document.getElementById('chatMessages');
    const avatar = role === 'ai' ? AI_AVATAR : USER_AVATAR;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}`;
    msgDiv.innerHTML = `<div class="chat-avatar">${avatar}</div><div class="chat-bubble">${content}</div>`;
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
