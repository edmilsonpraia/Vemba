import streamlit as st
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import sklearn.neural_network as nn
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import scipy.optimize as opt
from scipy.stats import norm
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# Configuração da página
st.set_page_config(
    page_title="Sistema Inteligente de Otimização de Separadores",
    page_icon="🛢️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# CSS customizado para melhorar a aparência
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        color: #1e3a8a;
        text-align: center;
        margin-bottom: 2rem;
        padding: 1rem;
        background: linear-gradient(90deg, #f0f9ff 0%, #e0f2fe 100%);
        border-radius: 10px;
        border-left: 5px solid #1e3a8a;
    }
    .metric-card {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 1rem;
        border-radius: 10px;
        color: white;
        text-align: center;
        margin: 0.5rem 0;
    }
    .sidebar .sidebar-content {
        background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
    }
    .formula-box {
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 5px;
        padding: 1rem;
        margin: 0.5rem 0;
    }
    .enhanced-formula {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-radius: 8px;
        padding: 1rem;
        margin: 0.5rem 0;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
</style>
""", unsafe_allow_html=True)

# Classe para modelagem matemática do separador
class SeparatorModel:
    def __init__(self):
        self.g = 9.81  # aceleração da gravidade (m/s²)
        self.pi = np.pi
        
    def stokes_velocity(self, radius, rho_p, rho_f, mu):
        """
        Calcula velocidade terminal pela Lei de Stokes
        v = (2gr²(ρp - ρf))/(9μ)
        """
        return (2 * self.g * radius**2 * (rho_p - rho_f)) / (9 * mu)
    
    def souders_brown_velocity(self, rho_l, rho_g, K=0.107):
        """
        Velocidade crítica de Souders-Brown para evitar arraste
        vg = K√((ρl - ρg)/ρg)
        """
        return K * np.sqrt((rho_l - rho_g) / rho_g)
    
    def separation_efficiency_gl(self, flow_rate, pressure, temperature, gor):
        """
        Modelo de eficiência de separação gás-líquido
        Baseado em correlações empíricas de Arnold & Stewart (2008)
        e critério de Souders-Brown para arraste de líquido.

        Fatores considerados:
        - Velocidade superficial do gás vs velocidade crítica (Souders-Brown)
        - Tempo de residência efetivo (função da vazão e volume do separador)
        - Efeito da pressão na densidade do gás (gás ideal corrigido)
        - Efeito da temperatura na viscosidade e tensão superficial
        - Efeito do GOR na carga de gás
        """
        # Propriedades aproximadas do gás a P e T de operação
        # Densidade do gás corrigida (lei dos gases reais, Z~0.85)
        rho_gas_op = 1.2 * (pressure / 10.0) * (288.15 / (temperature + 273.15)) / 0.85
        rho_liq = 870.0  # kg/m³ típico

        # Velocidade crítica de Souders-Brown (K típico para separador vertical)
        K_sb = 0.107 - 0.0002 * (pressure - 10.0)  # K diminui levemente com pressão
        v_critical = K_sb * np.sqrt((rho_liq - rho_gas_op) / rho_gas_op)

        # Velocidade superficial do gás no separador
        # Assumindo separador com diâmetro interno ~1.2m, área ~1.13 m²
        area_sep = 1.13  # m²
        # Vazão de gás = vazão total * GOR / 1000 (converter para m³/m³)
        gas_flow_rate = flow_rate * (gor / 1000.0) / 86400.0  # m³/s
        v_gas = gas_flow_rate / area_sep

        # Razão v_gas / v_critical determina eficiência
        velocity_ratio = v_gas / v_critical if v_critical > 0 else 1.0

        # Eficiência baseada na razão de velocidades (curva sigmoidal)
        # Quando v_gas << v_critical: eficiência alta (~99%)
        # Quando v_gas ~ v_critical: eficiência cai rapidamente
        eff_velocity = 1.0 / (1.0 + np.exp(8.0 * (velocity_ratio - 0.7)))

        # Fator de tempo de residência (mínimo recomendado: 3-5 min para gás)
        # Volume típico do separador: ~15 m³
        volume_sep = 15.0  # m³
        residence_time = volume_sep / (flow_rate / 86400.0) if flow_rate > 0 else 10.0  # minutos
        residence_time_min = residence_time / 60.0
        eff_residence = 1.0 - np.exp(-residence_time_min / 3.0)  # 3 min = constante de tempo

        # Fator de temperatura (viscosidade do óleo diminui, facilita separação)
        # Correlação simplificada: ganho de ~0.5% por cada 10°C acima de 50°C
        eff_temp = 1.0 + 0.005 * (temperature - 50.0) / 10.0

        # Eficiência combinada
        efficiency = 0.99 * eff_velocity * eff_residence * min(eff_temp, 1.02)

        return np.clip(efficiency, 0.70, 0.995)
    
    def separation_efficiency_oa(self, flow_rate, temperature, water_cut, viscosity):
        """
        Modelo de eficiência de separação óleo-água
        Baseado na Lei de Stokes para sedimentação gravitacional
        e correlações empíricas de Bradley (1965) e Veil et al. (2004).

        A separação óleo-água depende fundamentalmente de:
        - Tempo de residência vs tempo de sedimentação (Stokes)
        - Viscosidade do óleo (forte dependência exponencial com temperatura)
        - Fração de água (emulsões mais estáveis em faixas intermediárias)
        - Tamanho de gota (distribuição log-normal típica)
        """
        # Viscosidade do óleo corrigida pela temperatura (correlação de Beggs-Robinson simplificada)
        # mu(T) = mu_ref * exp(B * (1/T - 1/T_ref))
        T_ref = 60.0  # °C referência
        B_visc = 2500.0  # coeficiente para óleo médio
        mu_eff = viscosity * np.exp(B_visc * (1.0 / (temperature + 273.15) - 1.0 / (T_ref + 273.15)))

        # Velocidade de Stokes para gota de água média
        # d50 ~ 500 μm com coalescedor de placas (sem coalescedor: ~100-200 μm)
        # Ref: Hartland & Jeelani (1994) - droplet growth with coalescing internals
        d_drop = 500e-6  # m (diâmetro médio da gota com coalescedor)
        delta_rho = 1020.0 - 870.0  # kg/m³ (água - óleo)
        v_stokes = (2.0 * self.g * (d_drop / 2.0)**2 * delta_rho) / (9.0 * mu_eff * 1e-3)

        # Tempo de residência na seção de separação óleo-água
        # Volume da seção de separação: ~50% do volume total do separador
        volume_oa = 15.0 * 0.5  # m³
        t_residence = volume_oa / (flow_rate / 86400.0) if flow_rate > 0 else 600.0  # segundos

        # Distância efetiva de sedimentação com placas coalescedoras (~0.15m entre placas)
        # Ref: Lyons & Plisga (2005) - Standard Handbook of Petroleum Engineering
        h_emulsion = 0.15  # m (distância entre placas)
        t_settling = h_emulsion / v_stokes if v_stokes > 0 else 1e6

        # Razão tempo de residência / tempo de sedimentação
        settling_ratio = t_residence / t_settling

        # Eficiência baseada na razão de sedimentação
        # settling_ratio > 2: boa separação; < 0.5: separação pobre
        eff_settling = 1.0 - np.exp(-0.8 * settling_ratio)

        # Penalidade por emulsão estável em faixas intermediárias de water_cut
        # Emulsões mais difíceis de quebrar entre 30-60% de água (inversão de fase)
        # Ref: Kokal (2005, SPE) - penalidade moderada com uso de desemulsificante
        wc_frac = water_cut / 100.0
        emulsion_penalty = 1.0 - 0.06 * np.exp(-((wc_frac - 0.45) / 0.15)**2)

        # Eficiência combinada
        efficiency = 0.96 * eff_settling * emulsion_penalty

        return np.clip(efficiency, 0.60, 0.96)
    
    def energy_consumption(self, flow_rate, pressure, temperature):
        """
        Modelo de consumo energético (MWh/1000m³)
        Componentes reais de consumo em um separador de produção:

        1. Bombeamento: proporcional à vazão e pressão diferencial
        2. Aquecimento: proporcional à vazão e delta de temperatura
        3. Compressão de gás: proporcional à razão de compressão
        4. Instrumentação e auxiliares: consumo base fixo

        Referência: SPE-187412 e dados típicos de UEP (Unidade Estacionária de Produção)
        """
        # 1. Bombeamento de fluidos (bomba centrífuga, ~70% eficiência)
        # P_bomba = Q * ΔP / (η * 3.6e6) [MWh]
        delta_p_bar = 3.0  # queda de pressão típica no separador (bar)
        eta_bomba = 0.70
        q_m3s = flow_rate / 86400.0  # m³/s
        rho_fluid = 900.0  # kg/m³ (mistura)
        p_bomba = (q_m3s * delta_p_bar * 1e5) / (eta_bomba * 1e6)  # MW
        e_bomba = p_bomba * 24.0 / (flow_rate / 1000.0) if flow_rate > 0 else 0  # MWh/1000m³

        # 2. Aquecimento (elevar temperatura da mistura)
        # O fluido chega ao separador a uma temperatura próxima da operação;
        # o aquecedor fornece apenas o delta necessário (tipicamente 5-15°C)
        # Ref: Arnold & Stewart (2008) - Surface Production Operations
        cp_fluid = 2100.0  # J/(kg·K) para mistura óleo-água
        t_inlet = max(40.0, temperature - 12.0)  # entrada tipicamente 5-12°C abaixo da operação
        delta_t = max(0, temperature - t_inlet)
        mass_flow = rho_fluid * q_m3s  # kg/s
        heat_recovery = 0.5  # 50% recuperação com trocador de calor
        p_aquec = (mass_flow * cp_fluid * delta_t * (1.0 - heat_recovery)) / (0.85 * 1e6)  # MW
        e_aquec = p_aquec * 24.0 / (flow_rate / 1000.0) if flow_rate > 0 else 0  # MWh/1000m³

        # 3. Compressão de gás (compressor, ~75% eficiência isentrópica)
        # Compressão de pressure_sep até pressure_export (~25 bar)
        p_export = 25.0  # bar (pressão de exportação)
        ratio_comp = p_export / pressure if pressure > 0 else 2.0
        # Trabalho isentrópico simplificado: W = (k/(k-1)) * P1*V1 * ((P2/P1)^((k-1)/k) - 1)
        k_gas = 1.3  # razão de calores específicos do gás
        if ratio_comp > 1:
            comp_work_factor = (k_gas / (k_gas - 1)) * (ratio_comp**((k_gas - 1) / k_gas) - 1) / 0.75
        else:
            comp_work_factor = 0
        e_comp = 0.15 * comp_work_factor  # MWh/1000m³ (escalado para contribuição típica)

        # 4. Instrumentação, iluminação e auxiliares (consumo base)
        e_aux = 0.08  # MWh/1000m³ (valor fixo)

        total = e_bomba + e_aquec + e_comp + e_aux
        return max(0.5, total)  # mínimo realista
    
    def reynolds_number(self, velocity, diameter, density, viscosity):
        """
        Número de Reynolds: Re = ρvD/μ
        """
        return (density * velocity * diameter) / viscosity
    
    def weber_number(self, velocity, length, density, surface_tension):
        """
        Número de Weber: We = ρv²L/σ
        """
        return (density * velocity**2 * length) / surface_tension
    
    def bond_number(self, density_diff, length, surface_tension):
        """
        Número de Bond: Bo = Δρ·g·L²/σ
        """
        return (density_diff * self.g * length**2) / surface_tension
    
    def capillary_number(self, velocity, viscosity, surface_tension):
        """
        Número Capilar: Ca = μv/σ
        """
        return (viscosity * velocity) / surface_tension

# Classe para algoritmos de otimização
class OptimizationAlgorithms:
    def __init__(self):
        self.separator_model = SeparatorModel()
    
    def nsga_ii_optimization(self, bounds, pop_size=50, generations=100,
                              mutation_rate=0.1, crossover_rate=0.9):
        """
        Implementação do NSGA-II (Deb et al., 2002) para otimização multiobjetivo.
        Inclui: classificação não-dominada, crowding distance, cruzamento SBX e mutação polinomial.
        """
        n_vars = len(bounds)
        lower = np.array([b[0] for b in bounds])
        upper = np.array([b[1] for b in bounds])

        # Inicialização da população
        population = np.random.uniform(lower, upper, (pop_size, n_vars))

        best_solutions = []
        for gen in range(generations):
            # Avaliação dos objetivos
            objectives = np.array([self.evaluate_objectives(ind) for ind in population])

            # Gerar filhos via cruzamento e mutação
            offspring = self.create_offspring(population, objectives, bounds,
                                             crossover_rate, mutation_rate)
            offspring_objectives = np.array([self.evaluate_objectives(ind) for ind in offspring])

            # Combinar pais + filhos
            combined_pop = np.vstack([population, offspring])
            combined_obj = np.vstack([objectives, offspring_objectives])

            # Classificação não-dominada com crowding distance
            fronts = self.fast_non_dominated_sort_full(combined_obj)

            # Selecionar próxima geração
            new_population = []
            for front in fronts:
                if len(new_population) + len(front) <= pop_size:
                    new_population.extend(front)
                else:
                    # Preencher com base em crowding distance
                    remaining = pop_size - len(new_population)
                    distances = self.crowding_distance(combined_obj[front])
                    sorted_by_dist = np.argsort(-distances)  # Maior distância primeiro
                    new_population.extend([front[i] for i in sorted_by_dist[:remaining]])
                    break

            population = combined_pop[new_population]
            objectives = combined_obj[new_population]

            # Armazenar melhor solução da geração (menor objetivo 0 = maior eficiência)
            best_idx = np.argmin(objectives[:, 0])
            best_solutions.append({
                'generation': gen,
                'solution': population[best_idx].copy(),
                'objectives': objectives[best_idx].copy()
            })

        return best_solutions
    
    def evaluate_objectives(self, solution):
        """
        Avalia múltiplos objetivos: eficiência, energia, emissões
        """
        try:
            flow_rate, pressure, temperature, water_cut = solution
            
            # Garantir que os valores estão dentro dos limites válidos
            flow_rate = max(150, min(2400, flow_rate))
            pressure = max(8.5, min(15.2, pressure))
            temperature = max(45, min(85, temperature))
            water_cut = max(15, min(78, water_cut))
            
            # Objetivo 1: Maximizar eficiência (convertido para minimização)
            eff_gl = self.separator_model.separation_efficiency_gl(flow_rate, pressure, temperature, 100)
            eff_oa = self.separator_model.separation_efficiency_oa(flow_rate, temperature, water_cut, 15)
            efficiency_obj = -(eff_gl + eff_oa) / 2  # Negativo para minimização
            
            # Objetivo 2: Minimizar consumo energético
            energy_obj = self.separator_model.energy_consumption(flow_rate, pressure, temperature)
            
            # Objetivo 3: Minimizar emissões (correlacionado com energia)
            emissions_obj = energy_obj * 0.5 + 0.1 * pressure
            
            return np.array([efficiency_obj, energy_obj, emissions_obj])
        
        except Exception as e:
            # Retornar valores penalizantes em caso de erro
            return np.array([0.0, 10.0, 10.0])
    
    def fast_non_dominated_sort_full(self, objectives):
        """
        Classificação não-dominada rápida (Deb et al., 2002).
        Retorna lista de fronts, cada front é uma lista de índices.
        """
        n = len(objectives)
        dominated_count = np.zeros(n, dtype=int)
        dominated_solutions = [[] for _ in range(n)]
        rank = np.zeros(n, dtype=int)
        fronts = [[]]

        for i in range(n):
            for j in range(i + 1, n):
                if self.dominates(objectives[i], objectives[j]):
                    dominated_solutions[i].append(j)
                    dominated_count[j] += 1
                elif self.dominates(objectives[j], objectives[i]):
                    dominated_solutions[j].append(i)
                    dominated_count[i] += 1

            if dominated_count[i] == 0:
                rank[i] = 0
                fronts[0].append(i)

        if not fronts[0]:
            fronts[0] = list(range(n))
            return fronts

        current_front = 0
        while fronts[current_front]:
            next_front = []
            for i in fronts[current_front]:
                for j in dominated_solutions[i]:
                    dominated_count[j] -= 1
                    if dominated_count[j] == 0:
                        rank[j] = current_front + 1
                        next_front.append(j)
            current_front += 1
            if next_front:
                fronts.append(next_front)
            else:
                break

        return fronts

    def dominates(self, obj1, obj2):
        """
        Verifica se obj1 domina obj2 (minimização)
        """
        return np.all(obj1 <= obj2) and np.any(obj1 < obj2)

    def crowding_distance(self, objectives):
        """
        Calcula a crowding distance para um conjunto de soluções.
        Soluções extremas recebem distância infinita.
        """
        n = len(objectives)
        if n <= 2:
            return np.full(n, np.inf)

        n_obj = objectives.shape[1]
        distances = np.zeros(n)

        for m in range(n_obj):
            sorted_idx = np.argsort(objectives[:, m])
            obj_range = objectives[sorted_idx[-1], m] - objectives[sorted_idx[0], m]

            distances[sorted_idx[0]] = np.inf
            distances[sorted_idx[-1]] = np.inf

            if obj_range > 0:
                for i in range(1, n - 1):
                    distances[sorted_idx[i]] += (
                        (objectives[sorted_idx[i + 1], m] - objectives[sorted_idx[i - 1], m]) / obj_range
                    )

        return distances

    def tournament_selection(self, objectives, fronts_flat_rank, crowding_dist):
        """
        Seleção por torneio binário baseada em rank e crowding distance.
        """
        n = len(objectives)
        i, j = np.random.randint(0, n, 2)

        # Preferir menor rank; se igual, preferir maior crowding distance
        if fronts_flat_rank[i] < fronts_flat_rank[j]:
            return i
        elif fronts_flat_rank[i] > fronts_flat_rank[j]:
            return j
        elif crowding_dist[i] > crowding_dist[j]:
            return i
        else:
            return j

    def sbx_crossover(self, parent1, parent2, bounds, eta_c=20):
        """
        Cruzamento Simulated Binary Crossover (SBX) - Deb & Agrawal (1995).
        eta_c: índice de distribuição (maior = filhos mais próximos dos pais).
        """
        child1 = parent1.copy()
        child2 = parent2.copy()

        for i in range(len(parent1)):
            if np.random.random() < 0.5:
                if abs(parent1[i] - parent2[i]) > 1e-14:
                    if parent1[i] < parent2[i]:
                        x1, x2 = parent1[i], parent2[i]
                    else:
                        x1, x2 = parent2[i], parent1[i]

                    lb, ub = bounds[i]

                    # Cálculo do beta
                    rand = np.random.random()
                    beta = 1.0 + (2.0 * (x1 - lb) / (x2 - x1))
                    alpha = 2.0 - beta**(-(eta_c + 1))
                    if rand <= 1.0 / alpha:
                        betaq = (rand * alpha)**(1.0 / (eta_c + 1))
                    else:
                        betaq = (1.0 / (2.0 - rand * alpha))**(1.0 / (eta_c + 1))

                    child1[i] = 0.5 * ((x1 + x2) - betaq * (x2 - x1))
                    child2[i] = 0.5 * ((x1 + x2) + betaq * (x2 - x1))

                    child1[i] = np.clip(child1[i], lb, ub)
                    child2[i] = np.clip(child2[i], lb, ub)

        return child1, child2

    def polynomial_mutation(self, individual, bounds, mutation_rate, eta_m=20):
        """
        Mutação polinomial (Deb & Goyal, 1996).
        eta_m: índice de distribuição (maior = mutação mais localizada).
        """
        mutant = individual.copy()

        for i in range(len(individual)):
            if np.random.random() < mutation_rate:
                lb, ub = bounds[i]
                delta_max = ub - lb
                if delta_max <= 0:
                    continue

                rand = np.random.random()
                if rand < 0.5:
                    deltaq = (2.0 * rand)**(1.0 / (eta_m + 1)) - 1.0
                else:
                    deltaq = 1.0 - (2.0 * (1.0 - rand))**(1.0 / (eta_m + 1))

                mutant[i] = individual[i] + deltaq * delta_max
                mutant[i] = np.clip(mutant[i], lb, ub)

        return mutant

    def create_offspring(self, population, objectives, bounds, crossover_rate, mutation_rate):
        """
        Cria população de filhos usando seleção por torneio, SBX e mutação polinomial.
        """
        pop_size = len(population)
        n_vars = population.shape[1]
        offspring = np.zeros((pop_size, n_vars))

        # Calcular ranks e crowding distances para seleção
        fronts = self.fast_non_dominated_sort_full(objectives)
        rank = np.zeros(pop_size, dtype=int)
        for front_idx, front in enumerate(fronts):
            for i in front:
                if i < pop_size:
                    rank[i] = front_idx

        all_distances = np.zeros(pop_size)
        for front in fronts:
            valid_front = [i for i in front if i < pop_size]
            if valid_front:
                dists = self.crowding_distance(objectives[valid_front])
                for idx, i in enumerate(valid_front):
                    all_distances[i] = dists[idx]

        for i in range(0, pop_size, 2):
            p1 = self.tournament_selection(objectives, rank, all_distances)
            p2 = self.tournament_selection(objectives, rank, all_distances)

            if np.random.random() < crossover_rate:
                c1, c2 = self.sbx_crossover(population[p1], population[p2], bounds)
            else:
                c1, c2 = population[p1].copy(), population[p2].copy()

            c1 = self.polynomial_mutation(c1, bounds, mutation_rate)
            c2 = self.polynomial_mutation(c2, bounds, mutation_rate)

            offspring[i] = c1
            if i + 1 < pop_size:
                offspring[i + 1] = c2

        return offspring

# Classe para rede neural
class NeuralNetworkPredictor:
    def __init__(self):
        self.model = None
        self.scaler_X = StandardScaler()
        self.scaler_y = StandardScaler()
        self.is_trained = False
    
    def generate_training_data(self, n_samples=2000):
        """
        Gera dados sintéticos baseados no modelo físico com ruído realista.

        NOTA: Em aplicação real, estes dados devem ser substituídos por
        dados históricos de planta (SCADA/PIMS). Os dados sintéticos servem
        apenas para demonstração e validação da arquitetura do modelo.
        O ruído adicionado simula incertezas de medição típicas:
        - Eficiência: ±2% (erro de medição de vazímetros)
        - Energia: ±5% (erro de medição de potência)
        """
        separator_model = SeparatorModel()

        # Faixas das variáveis baseadas em condições operacionais típicas
        flow_rates = np.random.uniform(150, 2400, n_samples)
        pressures = np.random.uniform(8.5, 15.2, n_samples)
        temperatures = np.random.uniform(45, 85, n_samples)
        water_cuts = np.random.uniform(15, 78, n_samples)
        gors = np.random.uniform(45, 180, n_samples)
        viscosities = np.random.uniform(10, 25, n_samples)

        # Features
        X = np.column_stack([flow_rates, pressures, temperatures, water_cuts, gors, viscosities])

        # Targets calculados pelo modelo físico
        y_eff_gl = np.array([separator_model.separation_efficiency_gl(fr, p, t, g)
                            for fr, p, t, g in zip(flow_rates, pressures, temperatures, gors)])
        y_eff_oa = np.array([separator_model.separation_efficiency_oa(fr, t, wc, v)
                            for fr, t, wc, v in zip(flow_rates, temperatures, water_cuts, viscosities)])
        y_energy = np.array([separator_model.energy_consumption(fr, p, t)
                            for fr, p, t in zip(flow_rates, pressures, temperatures)])

        # Adicionar ruído de medição realista (simula incertezas instrumentais)
        noise_eff_gl = np.random.normal(0, 0.02 * y_eff_gl)  # ±2% erro relativo
        noise_eff_oa = np.random.normal(0, 0.02 * y_eff_oa)  # ±2% erro relativo
        noise_energy = np.random.normal(0, 0.05 * y_energy)   # ±5% erro relativo

        y_eff_gl = np.clip(y_eff_gl + noise_eff_gl, 0.60, 0.995)
        y_eff_oa = np.clip(y_eff_oa + noise_eff_oa, 0.50, 0.96)
        y_energy = np.maximum(y_energy + noise_energy, 0.3)

        y = np.column_stack([y_eff_gl, y_eff_oa, y_energy])

        return X, y
    
    def train(self, X=None, y=None):
        """
        Treina a rede neural
        """
        if X is None or y is None:
            X, y = self.generate_training_data()

        # Normalização de features e targets (melhora convergência)
        X_scaled = self.scaler_X.fit_transform(X)
        y_scaled = self.scaler_y.fit_transform(y)

        # Divisão treino/teste
        X_train, X_test, y_train, y_test = train_test_split(X_scaled, y_scaled, test_size=0.2, random_state=42)
        
        # Modelo neural - mais capacidade para capturar não-linearidades
        # dos modelos físicos (Stokes, Souders-Brown, etc.)
        self.model = nn.MLPRegressor(
            hidden_layer_sizes=(128, 64, 32),
            activation='relu',
            solver='adam',
            alpha=0.0001,
            learning_rate='adaptive',
            max_iter=3000,
            random_state=42,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=50
        )
        
        self.model.fit(X_train, y_train)
        self.is_trained = True

        # Score do modelo (R² na escala normalizada - equivalente ao R² na escala original)
        train_score = self.model.score(X_train, y_train)
        test_score = self.model.score(X_test, y_test)
        
        return train_score, test_score
    
    def predict(self, features):
        """
        Faz predições
        """
        try:
            if not self.is_trained:
                self.train()
            
            # Validar features
            if len(features) != 6:
                raise ValueError("Features deve ter exatamente 6 valores")
            
            # Garantir que features são numéricas
            features = [float(f) for f in features]
            
            features_scaled = self.scaler_X.transform([features])
            prediction_scaled = self.model.predict(features_scaled)
            prediction = self.scaler_y.inverse_transform(prediction_scaled)[0]

            # Validar predições dentro de faixas fisicamente possíveis
            prediction[0] = max(0.70, min(0.995, prediction[0]))  # Eficiência G-L
            prediction[1] = max(0.60, min(0.96, prediction[1]))   # Eficiência O-A
            prediction[2] = max(0.5, min(8.0, prediction[2]))     # Energia
            
            return prediction
            
        except Exception as e:
            st.error(f"Erro na predição: {str(e)}")
            # Retornar valores padrão em caso de erro
            return [0.94, 0.89, 2.4]

# Classe para controle fuzzy
class FuzzyController:
    def __init__(self):
        self.rules = self.define_fuzzy_rules()
    
    def triangular_membership(self, x, a, b, c):
        """
        Função de pertinência triangular
        """
        if x <= a or x >= c:
            return 0
        elif a < x <= b:
            return (x - a) / (b - a)
        else:
            return (c - x) / (c - b)
    
    def gaussian_membership(self, x, center, sigma):
        """
        Função de pertinência gaussiana
        """
        return np.exp(-0.5 * ((x - center) / sigma) ** 2)
    
    def define_fuzzy_rules(self):
        """
        Define regras fuzzy baseadas no conhecimento especialista
        """
        return [
            {"condition": "low_efficiency_high_water", "action": "increase_temperature"},
            {"condition": "high_energy_normal_flow", "action": "reduce_pressure"},
            {"condition": "foam_formation", "action": "add_antifoam"},
            {"condition": "emulsion_stable", "action": "increase_heating"}
        ]
    
    def fuzzify_efficiency(self, efficiency):
        """
        Fuzzificação da eficiência
        """
        low = self.triangular_membership(efficiency, 0.8, 0.85, 0.9)
        medium = self.triangular_membership(efficiency, 0.85, 0.9, 0.95)
        high = self.triangular_membership(efficiency, 0.9, 0.95, 1.0)
        
        return {"low": low, "medium": medium, "high": high}
    
    def defuzzify_control_action(self, fuzzy_output):
        """
        Defuzzificação usando centro de gravidade
        """
        # Mapeamento das ações para valores numéricos (centro de gravidade)
        action_values = {
            "aumentar_temperatura": 1.0,
            "reduzir_pressão": 0.5,
            "manter_atual": 0.0,
            "adicionar_antiespumante": 0.8,
            "aumentar_aquecimento": 0.9
        }
        
        numerator = sum(action_values.get(action, 0) * weight 
                       for action, weight in fuzzy_output.items())
        denominator = sum(fuzzy_output.values())
        
        return numerator / denominator if denominator != 0 else 0

# Função para calculadora de parâmetros avançados
def advanced_calculator():
    """
    Calculadora para parâmetros avançados de processo
    """
    st.subheader("🧮 Calculadora de Parâmetros Avançados")
    
    # Adicionar mais fórmulas
    st.markdown("#### 📐 Fórmulas Fundamentais")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.markdown('<div class="enhanced-formula"><strong>Número de Reynolds</strong><br>Re = ρvD/μ</div>', unsafe_allow_html=True)
        st.markdown('<div class="enhanced-formula"><strong>Número de Weber</strong><br>We = ρv²L/σ</div>', unsafe_allow_html=True)
    
    with col2:
        st.markdown('<div class="enhanced-formula"><strong>Número de Bond</strong><br>Bo = Δρ·g·L²/σ</div>', unsafe_allow_html=True)
        st.markdown('<div class="enhanced-formula"><strong>Número Capilar</strong><br>Ca = μv/σ</div>', unsafe_allow_html=True)
    
    with col3:
        st.markdown('<div class="enhanced-formula"><strong>Fração de Vazio</strong><br>α = Vgas/(Vgas + Vliq)</div>', unsafe_allow_html=True)
        st.markdown('<div class="enhanced-formula"><strong>Velocidade Superficial</strong><br>vs = Q/A</div>', unsafe_allow_html=True)
    
    separator_model = SeparatorModel()
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("#### Reynolds Number")
        
        rho_calc = st.number_input("Densidade (kg/m³)", 800, 1100, 870, key="rho_reynolds")
        velocity_calc = st.number_input("Velocidade (m/s)", 0.1, 5.0, 1.2, key="vel_reynolds")
        diameter_calc = st.number_input("Diâmetro (m)", 0.1, 2.0, 0.8, key="dia_reynolds")
        mu_calc = st.number_input("Viscosidade (Pa.s)", 0.001, 0.1, 0.015, key="mu_reynolds")
        
        reynolds = separator_model.reynolds_number(velocity_calc, diameter_calc, rho_calc, mu_calc)
        st.success(f"**Re = {reynolds:.0f}**")
        
        if reynolds < 2300:
            flow_type = "🌊 Laminar"
            color = "blue"
        elif reynolds > 4000:
            flow_type = "🌪️ Turbulento"
            color = "red"
        else:
            flow_type = "⚡ Transição"
            color = "orange"
        
        st.markdown(f'<div style="color: {color}; font-weight: bold;">Regime: {flow_type}</div>', unsafe_allow_html=True)
    
    with col2:
        st.markdown("#### Weber Number")
        
        rho_weber = st.number_input("Densidade (kg/m³)", 800, 1100, 870, key="rho_weber")
        vel_weber = st.number_input("Velocidade (m/s)", 0.1, 5.0, 1.2, key="vel_weber")
        length_weber = st.number_input("Comprimento característico (m)", 0.001, 0.1, 0.01, key="length_weber")
        sigma_weber = st.number_input("Tensão superficial (N/m)", 0.01, 0.08, 0.025, key="sigma_weber")
        
        weber = separator_model.weber_number(vel_weber, length_weber, rho_weber, sigma_weber)
        st.success(f"**We = {weber:.2f}**")
        
        if weber < 1:
            droplet_behavior = "💧 Gotas estáveis"
            color = "green"
        elif weber < 10:
            droplet_behavior = "🔄 Deformação moderada"
            color = "orange"
        else:
            droplet_behavior = "💥 Fragmentação de gotas"
            color = "red"
        
        st.markdown(f'<div style="color: {color}; font-weight: bold;">{droplet_behavior}</div>', unsafe_allow_html=True)
    
    # Gráfico de comportamento de gotas melhorado
    st.markdown("#### 📊 Análise de Comportamento de Gotas")
    
    # Dados para gráfico
    weber_range = np.logspace(-1, 2, 50)
    reynolds_range = np.logspace(1, 5, 50)
    
    fig_flow_map = go.Figure()
    
    # Mapear regimes de escoamento
    regimes = []
    colors = []
    for we in weber_range:
        for re in reynolds_range:
            if we < 1 and re < 2300:
                regime = "Laminar-Estável"
                color = "#2E8B57"
            elif we < 10 and re < 4000:
                regime = "Transição"
                color = "#FF8C00"
            elif we > 10 and re > 4000:
                regime = "Turbulento-Fragmentação"
                color = "#DC143C"
            else:
                regime = "Misto"
                color = "#4169E1"
            
            regimes.append(regime)
            colors.append(color)
    
    # Criar scatter plot melhorado
    We_mesh, Re_mesh = np.meshgrid(weber_range[:10], reynolds_range[:10])
    
    fig_flow_map.add_trace(go.Scatter(
        x=We_mesh.flatten(),
        y=Re_mesh.flatten(),
        mode='markers',
        marker=dict(
            size=8,
            color=colors[:100],
            opacity=0.7,
            line=dict(width=1, color='white')
        ),
        name="Regimes de Escoamento",
        hovertemplate="We: %{x:.2f}<br>Re: %{y:.0f}<br>Regime: %{text}<extra></extra>",
        text=regimes[:100]
    ))
    
    # Adicionar linhas de demarcação
    fig_flow_map.add_hline(y=2300, line_dash="dash", line_color="gray", 
                          annotation_text="Re = 2300 (Início Transição)")
    fig_flow_map.add_hline(y=4000, line_dash="dash", line_color="gray", 
                          annotation_text="Re = 4000 (Início Turbulento)")
    fig_flow_map.add_vline(x=1, line_dash="dash", line_color="red", 
                          annotation_text="We = 1 (Início Deformação)")
    fig_flow_map.add_vline(x=10, line_dash="dash", line_color="red", 
                          annotation_text="We = 10 (Início Fragmentação)")
    
    fig_flow_map.update_layout(
        title="🗺️ Mapa de Regimes: Weber vs Reynolds",
        xaxis_title="Número de Weber (We)",
        yaxis_title="Número de Reynolds (Re)",
        xaxis_type="log",
        yaxis_type="log",
        template="plotly_white",
        height=500,
        showlegend=True,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1
        )
    )
    
    st.plotly_chart(fig_flow_map, use_container_width=True)

# Função principal do aplicativo
def main():
    # Cabeçalho principal
    st.markdown('<div class="main-header">🛢️ Sistema Inteligente de Otimização de Separadores de Petróleo</div>', 
                unsafe_allow_html=True)
    
    # Sidebar para parâmetros
    st.sidebar.title("⚙️ Parâmetros de Processo")
    
    # Parâmetros de entrada
    col1, col2 = st.sidebar.columns(2)
    
    with col1:
        flow_rate = st.slider("Vazão (m³/dia)", 150, 2400, 1250, help="Vazão de entrada do separador")
        pressure = st.slider("Pressão (bar)", 8.5, 15.2, 11.3, help="Pressão de operação")
        temperature = st.slider("Temperatura (°C)", 45, 85, 62, help="Temperatura de operação")
    
    with col2:
        water_cut = st.slider("Corte de Água (%)", 15, 78, 42, help="Percentual de água no fluido")
        gor = st.slider("GOR (m³/m³)", 45, 180, 95, help="Razão gás-óleo")
        viscosity = st.slider("Viscosidade (cP)", 10, 30, 15, help="Viscosidade do óleo")
    
    # Densidade dos fluidos
    st.sidebar.subheader("Propriedades dos Fluidos")
    rho_oil = st.sidebar.number_input("Densidade Óleo (kg/m³)", 800, 950, 870)
    rho_water = st.sidebar.number_input("Densidade Água (kg/m³)", 1000, 1100, 1020)
    rho_gas = st.sidebar.number_input("Densidade Gás (kg/m³)", 0.7, 2.0, 1.2)
    
    # Inicializar modelos
    separator_model = SeparatorModel()
    nn_predictor = NeuralNetworkPredictor()
    fuzzy_controller = FuzzyController()
    optimizer = OptimizationAlgorithms()
    
    # Abas principais
    tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
        "📊 Dashboard Principal", 
        "🧮 Modelagem Matemática", 
        "🤖 Redes Neurais", 
        "🎯 Otimização", 
        "🔧 Controle Fuzzy",
        "💰 Análise Econômica",
        "⚙️ Calculadora Avançada"
    ])
    
    with tab1:
        st.subheader("Dashboard de Monitoramento em Tempo Real")
        
        # Calcular métricas principais
        eff_gl = separator_model.separation_efficiency_gl(flow_rate, pressure, temperature, gor)
        eff_oa = separator_model.separation_efficiency_oa(flow_rate, temperature, water_cut, viscosity)
        energy_consumption = separator_model.energy_consumption(flow_rate, pressure, temperature)
        
        # Métricas em cards
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            st.metric(
                label="🔸 Eficiência G-L",
                value=f"{eff_gl:.1%}",
                delta=f"{(eff_gl - 0.90)*100:.1f}% vs baseline"
            )

        with col2:
            st.metric(
                label="🔹 Eficiência O-A",
                value=f"{eff_oa:.1%}",
                delta=f"{(eff_oa - 0.85)*100:.1f}% vs baseline"
            )

        with col3:
            baseline_e = separator_model.energy_consumption(flow_rate, 11.3, 60)
            st.metric(
                label="⚡ Energia",
                value=f"{energy_consumption:.2f} MWh/1000m³",
                delta=f"{(energy_consumption - baseline_e):.2f} vs ref."
            )
        
        with col4:
            # Estimativa de impacto econômico (conservadora)
            avg_eff = (eff_gl + eff_oa) / 2
            baseline_eff = 0.90
            eff_gain = max(0, avg_eff - baseline_eff)
            # Estimativa simplificada: ganho proporcional à produção recuperada
            est_daily_prod = flow_rate * (1 - water_cut / 100)  # m³/dia
            est_annual_gain = est_daily_prod * 335 * 6.29 * (1 - baseline_eff) * (eff_gain / (1 - baseline_eff)) * 80  # USD
            st.metric(
                label="💰 Impacto Econômico (est.)",
                value=f"${est_annual_gain:,.0f}/ano",
                delta=f"+{eff_gain:.1%} vs baseline"
            )
        
        # Gráficos de monitoramento
        st.caption("📌 *Dados simulados para demonstração. Em produção, conectar ao sistema SCADA/PIMS da planta.*")
        col1, col2 = st.columns(2)

        with col1:
            # Gráfico de eficiência ao longo do tempo (dados simulados)
            time_data = pd.date_range(start='2024-01-01', periods=100, freq='D')
            efficiency_trend = eff_gl * 0.5 + eff_oa * 0.5 + 0.02 * np.sin(np.arange(100) * 0.1) + np.random.normal(0, 0.005, 100)
            
            fig_trend = go.Figure()
            
            # Adicionar linha principal
            fig_trend.add_trace(go.Scatter(
                x=time_data, 
                y=efficiency_trend,
                mode='lines+markers',
                name='Eficiência Total (%)',
                line=dict(color='#1f77b4', width=3),
                marker=dict(size=4, color='#1f77b4'),
                hovertemplate="<b>Data:</b> %{x}<br><b>Eficiência:</b> %{y:.2%}<extra></extra>"
            ))
            
            # Adicionar banda de confiança
            upper_bound = efficiency_trend + 0.02
            lower_bound = efficiency_trend - 0.02
            
            fig_trend.add_trace(go.Scatter(
                x=time_data,
                y=upper_bound,
                mode='lines',
                line=dict(width=0),
                showlegend=False,
                hoverinfo='skip'
            ))
            
            fig_trend.add_trace(go.Scatter(
                x=time_data,
                y=lower_bound,
                mode='lines',
                line=dict(width=0),
                fill='tonexty',
                fillcolor='rgba(31, 119, 180, 0.2)',
                name='Banda de Confiança (±2%)',
                hoverinfo='skip'
            ))
            
            # Adicionar linha de meta
            fig_trend.add_hline(y=0.95, line_dash="dash", line_color="red", 
                               annotation_text="Meta: 95%", annotation_position="top right")
            
            fig_trend.update_layout(
                title="📈 Tendência de Eficiência ao Longo do Tempo",
                xaxis_title="Data",
                yaxis_title="Eficiência (%)",
                template="plotly_white",
                height=400,
                hovermode='x unified',
                yaxis=dict(tickformat='.1%'),
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            
            st.plotly_chart(fig_trend, use_container_width=True)
        
        with col2:
            # Gráfico radar de performance - MELHORADO
            categories = ['Eficiência G-L', 'Eficiência O-A', 'Economia Energia', 'Estabilidade', 'Qualidade']
            current_values = [eff_gl*100, eff_oa*100, (3-energy_consumption)*33.3, 85, 92]
            benchmark_values = [97, 92, 80, 90, 95]
            target_values = [99, 96, 95, 95, 98]
            
            fig_radar = go.Figure()
            
            # Adicionar trace atual
            fig_radar.add_trace(go.Scatterpolar(
                r=current_values,
                theta=categories,
                fill='toself',
                name='🔵 Atual',
                line=dict(color='#ff7f0e', width=3),
                fillcolor='rgba(255, 127, 14, 0.3)',
                hovertemplate="<b>%{theta}</b><br>Valor: %{r:.1f}%<extra></extra>"
            ))
            
            # Adicionar trace benchmark
            fig_radar.add_trace(go.Scatterpolar(
                r=benchmark_values,
                theta=categories,
                fill='toself',
                name='🟢 Benchmark',
                line=dict(color='#2ca02c', width=3),
                fillcolor='rgba(44, 160, 44, 0.2)',
                hovertemplate="<b>%{theta}</b><br>Benchmark: %{r:.1f}%<extra></extra>"
            ))
            
            # Adicionar trace meta
            fig_radar.add_trace(go.Scatterpolar(
                r=target_values,
                theta=categories,
                fill=None,
                name='🎯 Meta',
                line=dict(color='#d62728', width=2, dash='dash'),
                hovertemplate="<b>%{theta}</b><br>Meta: %{r:.1f}%<extra></extra>"
            ))
            
            fig_radar.update_layout(
                polar=dict(
                    radialaxis=dict(
                        visible=True, 
                        range=[0, 100],
                        ticksuffix='%',
                        gridcolor='lightgray'
                    ),
                    angularaxis=dict(
                        gridcolor='lightgray'
                    )
                ),
                title="🎯 Performance vs Benchmark vs Meta",
                template="plotly_white",
                height=400,
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            st.plotly_chart(fig_radar, use_container_width=True)
        
        # Painel de status em tempo real - NOVO
        st.markdown("#### 🚦 Status Operacional em Tempo Real")
        
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            status_color = "🟢" if eff_gl > 0.93 else "🟡" if eff_gl > 0.90 else "🔴"
            st.markdown(f"**Separação G-L:** {status_color} {eff_gl:.1%}")
        
        with col2:
            status_color = "🟢" if eff_oa > 0.87 else "🟡" if eff_oa > 0.84 else "🔴"
            st.markdown(f"**Separação O-A:** {status_color} {eff_oa:.1%}")
        
        with col3:
            status_color = "🟢" if energy_consumption < 2.5 else "🟡" if energy_consumption < 3.0 else "🔴"
            st.markdown(f"**Energia:** {status_color} {energy_consumption:.2f} MWh/1000m³")
        
        with col4:
            overall_status = "🟢 ÓTIMO" if eff_gl > 0.93 and eff_oa > 0.87 else "🟡 BOM" if eff_gl > 0.90 and eff_oa > 0.84 else "🔴 CRÍTICO"
            st.markdown(f"**Status Geral:** {overall_status}")
    
    with tab2:
        st.subheader("🧮 Modelagem Matemática Avançada")
        
        # Adicionar mais fórmulas - MELHORADO
        st.markdown("#### 📐 Equações Fundamentais do Processo")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown('<div class="enhanced-formula"><strong>Lei de Stokes</strong><br>v = 2gr²(ρₚ - ρf)/(9μ)</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Souders-Brown</strong><br>vg = K√((ρₗ - ρg)/ρg)</div>', unsafe_allow_html=True)
        
        with col2:
            st.markdown('<div class="enhanced-formula"><strong>Eficiência Total</strong><br>η = (Qout,sep/Qin,total) × 100%</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Tempo de Residência</strong><br>τ = V/Q</div>', unsafe_allow_html=True)
        
        with col3:
            st.markdown('<div class="enhanced-formula"><strong>Balanço de Massa</strong><br>∂(αᵢρᵢ)/∂t + ∇·(αᵢρᵢvᵢ) = Γᵢ</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Critério de Arraste</strong><br>CD = 24/Re (Re < 1)</div>', unsafe_allow_html=True)
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("#### Lei de Stokes - Velocidade Terminal")
            
            # Parâmetros para cálculo de Stokes
            radius = st.number_input("Raio da gota (μm)", 10, 1000, 100) * 1e-6
            mu_oil = viscosity * 1e-3  # Converter cP para Pa.s
            
            v_stokes = separator_model.stokes_velocity(radius, rho_water, rho_oil, mu_oil)
            st.success(f"**Velocidade terminal: {v_stokes*1000:.2f} mm/s**")
            
            st.markdown("#### Correlação de Souders-Brown")
            
            v_sb = separator_model.souders_brown_velocity(rho_oil, rho_gas)
            st.success(f"**Velocidade crítica do gás: {v_sb:.3f} m/s**")
            
            # Análise adicional - NOVO
            st.markdown("#### Análise Dimensional")
            
            reynolds_drop = separator_model.reynolds_number(v_stokes, radius*2, rho_oil, mu_oil)
            st.info(f"🔢 Reynolds da gota: {reynolds_drop:.2e}")
            
            if reynolds_drop < 1:
                st.success("✅ Lei de Stokes aplicável (Re < 1)")
            else:
                st.warning("⚠️ Considerar correções para Re > 1")
        
        with col2:
            # Visualização da distribuição de tamanho de gotas - MELHORADO
            drop_sizes = np.logspace(1, 3, 100)  # μm
            velocities = [separator_model.stokes_velocity(d*1e-6, rho_water, rho_oil, mu_oil)*1000 
                         for d in drop_sizes]
            
            # Adicionar velocidades críticas
            v_critical = v_sb * 1000  # Converter para mm/s
            
            fig_stokes = go.Figure()
            
            # Curva principal
            fig_stokes.add_trace(go.Scatter(
                x=drop_sizes,
                y=velocities,
                mode='lines',
                name='📉 Velocidade de Sedimentação',
                line=dict(color='#d62728', width=3),
                hovertemplate="<b>Diâmetro:</b> %{x:.0f} μm<br><b>Velocidade:</b> %{y:.2f} mm/s<extra></extra>"
            ))
            
            # Linha crítica
            fig_stokes.add_hline(y=v_critical, line_dash="dash", line_color="orange", line_width=2,
                                annotation_text=f"Velocidade Crítica: {v_critical:.2f} mm/s")
            
            # Zona de separação eficiente
            fig_stokes.add_hrect(y0=0, y1=v_critical*0.8, fillcolor="green", opacity=0.2)
            
            # Zona crítica
            fig_stokes.add_hrect(y0=v_critical*0.8, y1=v_critical*1.2, fillcolor="yellow", opacity=0.2)
            
            # Zona de arraste
            fig_stokes.add_hrect(y0=v_critical*1.2, y1=max(velocities), fillcolor="red", opacity=0.2)
            
            # Adicionar anotações de texto separadamente
            fig_stokes.add_annotation(
                x=np.log10(drop_sizes[50]), y=v_critical*0.4,
                text="✅ Zona de Separação Eficiente",
                showarrow=False,
                font=dict(color="darkgreen", size=10),
                bgcolor="rgba(255,255,255,0.8)",
                bordercolor="green"
            )
            
            fig_stokes.add_annotation(
                x=np.log10(drop_sizes[70]), y=v_critical*1.0,
                text="⚠️ Zona Crítica",
                showarrow=False,
                font=dict(color="darkorange", size=10),
                bgcolor="rgba(255,255,255,0.8)",
                bordercolor="orange"
            )
            
            fig_stokes.add_annotation(
                x=np.log10(drop_sizes[30]), y=v_critical*1.5,
                text="🚨 Zona de Arraste",
                showarrow=False,
                font=dict(color="darkred", size=10),
                bgcolor="rgba(255,255,255,0.8)",
                bordercolor="red"
            )
            
            fig_stokes.update_layout(
                title="🎯 Lei de Stokes - Análise de Separabilidade",
                xaxis_title="Diâmetro da Gota (μm)",
                yaxis_title="Velocidade de Sedimentação (mm/s)",
                xaxis_type="log",
                template="plotly_white",
                height=400,
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            st.plotly_chart(fig_stokes, use_container_width=True)
        
        # Equações de conservação - MELHORADO
        st.markdown("#### 📊 Visualização das Equações de Conservação")
        
        # Parâmetros para simulação
        x_pos = np.linspace(0, 10, 100)  # Posição ao longo do separador (m)
        
        col1, col2 = st.columns(2)
        
        with col1:
            # Gráfico de Conservação de Massa - Perfis de Densidade - MELHORADO
            st.markdown("**🌊 Conservação de Massa - Perfis de Densidade**")
            
            # Simular perfis de densidade ao longo do separador
            rho_oil_profile = rho_oil * (1 - 0.05 * np.exp(-x_pos/3))
            rho_water_profile = rho_water * (1 + 0.02 * np.sin(x_pos/2))
            rho_gas_profile = rho_gas * (1 + 0.1 * x_pos/10)
            
            fig_mass = go.Figure()
            
            # Óleo
            fig_mass.add_trace(go.Scatter(
                x=x_pos, y=rho_oil_profile,
                mode='lines+markers',
                name='🛢️ Óleo',
                line=dict(color='#8B4513', width=3),
                marker=dict(size=4),
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>Densidade Óleo:</b> %{y:.0f} kg/m³<extra></extra>"
            ))
            
            # Água
            fig_mass.add_trace(go.Scatter(
                x=x_pos, y=rho_water_profile,
                mode='lines+markers',
                name='💧 Água',
                line=dict(color='#4169E1', width=3),
                marker=dict(size=4),
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>Densidade Água:</b> %{y:.0f} kg/m³<extra></extra>"
            ))
            
            # Gás
            fig_mass.add_trace(go.Scatter(
                x=x_pos, y=rho_gas_profile,
                mode='lines+markers',
                name='💨 Gás',
                line=dict(color='#32CD32', width=3),
                marker=dict(size=4),
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>Densidade Gás:</b> %{y:.1f} kg/m³<extra></extra>"
            ))
            
            fig_mass.update_layout(
                title="📈 Perfis de Densidade ao Longo do Separador",
                xaxis_title="Posição Longitudinal (m)",
                yaxis_title="Densidade (kg/m³)",
                template="plotly_white",
                height=400,
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            st.plotly_chart(fig_mass, use_container_width=True)
            
            # Gráfico de Eficiência de Separação - MELHORADO
            st.markdown("**📊 Eficiência de Separação vs Parâmetros**")
            
            # Variar temperatura e mostrar eficiência
            temp_range = np.linspace(45, 85, 50)
            eff_gl_temp = [separator_model.separation_efficiency_gl(flow_rate, pressure, t, gor) for t in temp_range]
            eff_oa_temp = [separator_model.separation_efficiency_oa(flow_rate, t, water_cut, viscosity) for t in temp_range]
            eff_total = [(eff_gl + eff_oa)/2 for eff_gl, eff_oa in zip(eff_gl_temp, eff_oa_temp)]
            
            fig_eff = go.Figure()
            
            # Eficiência G-L
            fig_eff.add_trace(go.Scatter(
                x=temp_range, y=eff_gl_temp,
                mode='lines+markers', 
                name='🔸 Eficiência G-L',
                line=dict(color='#FF6B6B', width=3),
                marker=dict(size=6),
                hovertemplate="<b>Temperatura:</b> %{x:.1f}°C<br><b>Eficiência G-L:</b> %{y:.2%}<extra></extra>"
            ))
            
            # Eficiência O-A
            fig_eff.add_trace(go.Scatter(
                x=temp_range, y=eff_oa_temp,
                mode='lines+markers', 
                name='🔹 Eficiência O-A',
                line=dict(color='#4ECDC4', width=3),
                marker=dict(size=6),
                hovertemplate="<b>Temperatura:</b> %{x:.1f}°C<br><b>Eficiência O-A:</b> %{y:.2%}<extra></extra>"
            ))
            
            # Eficiência Total
            fig_eff.add_trace(go.Scatter(
                x=temp_range, y=eff_total,
                mode='lines+markers', 
                name='⭐ Eficiência Total',
                line=dict(color='#9b59b6', width=4, dash='dash'),
                marker=dict(size=8, symbol='star'),
                hovertemplate="<b>Temperatura:</b> %{x:.1f}°C<br><b>Eficiência Total:</b> %{y:.2%}<extra></extra>"
            ))
            
            # Adicionar linha da temperatura atual
            fig_eff.add_vline(x=temperature, line_dash="dot", line_color="red", line_width=2,
                             annotation_text=f"Atual: {temperature}°C")
            
            fig_eff.update_layout(
                title="📈 Eficiência vs Temperatura de Operação",
                xaxis_title="Temperatura (°C)",
                yaxis_title="Eficiência",
                template="plotly_white",
                height=400,
                yaxis=dict(tickformat='.1%'),
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            st.plotly_chart(fig_eff, use_container_width=True)
        
        with col2:
            # Gráfico de Conservação de Momento - Perfis de Velocidade - MELHORADO
            st.markdown("**⚡ Conservação de Momento - Perfis de Velocidade**")
            
            # Simular perfis de velocidade
            v_oil = 1.2 * (1 - np.exp(-x_pos/2))
            v_water = 0.8 * (1 - 0.3 * np.exp(-x_pos/3))
            v_gas = 5.0 * (1 + 0.2 * np.sin(x_pos/4))
            
            fig_momentum = go.Figure()
            
            # Óleo
            fig_momentum.add_trace(go.Scatter(
                x=x_pos, y=v_oil,
                mode='lines+markers',
                name='🛢️ Óleo',
                line=dict(color='#8B4513', width=3),
                marker=dict(size=4),
                fill='tonexty',
                fillcolor='rgba(139, 69, 19, 0.2)',
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>Velocidade Óleo:</b> %{y:.2f} m/s<extra></extra>"
            ))
            
            # Água
            fig_momentum.add_trace(go.Scatter(
                x=x_pos, y=v_water,
                mode='lines+markers',
                name='💧 Água',
                line=dict(color='#4169E1', width=3),
                marker=dict(size=4),
                fill='tonexty',
                fillcolor='rgba(65, 105, 225, 0.2)',
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>Velocidade Água:</b> %{y:.2f} m/s<extra></extra>"
            ))
            
            # Gás
            fig_momentum.add_trace(go.Scatter(
                x=x_pos, y=v_gas,
                mode='lines+markers',
                name='💨 Gás',
                line=dict(color='#32CD32', width=3),
                marker=dict(size=4),
                fill='tonexty',
                fillcolor='rgba(50, 205, 50, 0.2)',
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>Velocidade Gás:</b> %{y:.2f} m/s<extra></extra>"
            ))
            
            fig_momentum.update_layout(
                title="🌊 Perfis de Velocidade ao Longo do Separador",
                xaxis_title="Posição Longitudinal (m)",
                yaxis_title="Velocidade (m/s)",
                template="plotly_white",
                height=400,
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            st.plotly_chart(fig_momentum, use_container_width=True)
            
            # Gráfico de Pressão ao Longo do Separador - MELHORADO
            st.markdown("**📉 Perfil de Pressão e Queda de Pressão**")
            
            # Simular queda de pressão ao longo do separador
            pressure_profile = pressure - 0.5 * (1 - np.exp(-x_pos/5))
            pressure_drop = pressure - pressure_profile
            
            fig_pressure = make_subplots(
                rows=2, cols=1,
                subplot_titles=('Pressão Absoluta', 'Queda de Pressão Acumulada'),
                vertical_spacing=0.15
            )
            
            # Pressão absoluta
            fig_pressure.add_trace(go.Scatter(
                x=x_pos, y=pressure_profile,
                mode='lines+markers',
                name='📊 Pressão Absoluta',
                line=dict(color='#E74C3C', width=3),
                marker=dict(size=4),
                fill='tonexty',
                fillcolor='rgba(231, 76, 60, 0.3)',
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>Pressão:</b> %{y:.2f} bar<extra></extra>"
            ), row=1, col=1)
            
            # Queda de pressão
            fig_pressure.add_trace(go.Scatter(
                x=x_pos, y=pressure_drop,
                mode='lines+markers',
                name='📉 Queda de Pressão',
                line=dict(color='#9b59b6', width=3),
                marker=dict(size=4),
                fill='tozeroy',
                fillcolor='rgba(155, 89, 182, 0.3)',
                hovertemplate="<b>Posição:</b> %{x:.1f} m<br><b>ΔP:</b> %{y:.3f} bar<extra></extra>"
            ), row=2, col=1)
            
            # Linha da pressão de entrada
            fig_pressure.add_hline(y=pressure, line_dash="dash", line_color="gray", row=1, col=1,
                                 annotation_text=f"Entrada: {pressure:.1f} bar")
            
            fig_pressure.update_layout(
                title="📊 Análise de Pressão no Separador",
                template="plotly_white",
                height=400,
                showlegend=True,
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            
            fig_pressure.update_xaxes(title_text="Posição (m)", row=2, col=1)
            fig_pressure.update_yaxes(title_text="Pressão (bar)", row=1, col=1)
            fig_pressure.update_yaxes(title_text="ΔP (bar)", row=2, col=1)
            
            st.plotly_chart(fig_pressure, use_container_width=True)
        
        # Campo de Velocidades 2D - MELHORADO
        st.markdown("#### 🌊 Campo de Velocidades 2D no Separador")
        
        # Criar grade 2D para o campo de velocidades
        x_2d = np.linspace(0, 10, 20)
        y_2d = np.linspace(0, 3, 15)
        X, Y = np.meshgrid(x_2d, y_2d)
        
        # Simular componentes de velocidade com mais realismo
        U = 1.5 * (1 - Y/3) * (1 + 0.1 * np.sin(X)) * np.exp(-0.1*X)  # Velocidade horizontal
        V = 0.2 * np.sin(X/2) * (Y/3) * (1 - Y/3)  # Velocidade vertical
        
        # Magnitude da velocidade
        magnitude = np.sqrt(U**2 + V**2)
        
        # Criar subplot para visualização melhorada
        fig_field = make_subplots(
            rows=1, cols=2,
            subplot_titles=('Campo de Velocidades com Vetores', 'Linhas de Corrente'),
            horizontal_spacing=0.1
        )
        
        # Gráfico 1: Contorno + Vetores
        fig_field.add_trace(go.Contour(
            x=x_2d, y=y_2d, z=magnitude,
            colorscale='Viridis',
            name="Magnitude (m/s)",
            contours=dict(
                showlabels=True,
                labelfont=dict(size=8, color='white')
            ),
            colorbar=dict(title="Velocidade (m/s)", x=0.45)
        ), row=1, col=1)
        
        # Adicionar vetores (subsampling para clareza)
        x_arrows = x_2d[::3]
        y_arrows = y_2d[::2]
        X_arrows, Y_arrows = np.meshgrid(x_arrows, y_arrows)
        U_arrows = U[::2, ::3]
        V_arrows = V[::2, ::3]
        
        # Adicionar vetores como anotações
        scale = 0.4
        for i in range(len(x_arrows)):
            for j in range(len(y_arrows)):
                if i < U_arrows.shape[1] and j < U_arrows.shape[0]:
                    fig_field.add_annotation(
                        x=X_arrows[j, i], y=Y_arrows[j, i],
                        ax=X_arrows[j, i] + U_arrows[j, i] * scale,
                        ay=Y_arrows[j, i] + V_arrows[j, i] * scale,
                        xref="x", yref="y", axref="x", ayref="y",
                        arrowhead=2, arrowsize=1, arrowwidth=1.5,
                        arrowcolor="white", row=1, col=1
                    )
        
        # Gráfico 2: Linhas de corrente
        fig_field.add_trace(go.Contour(
            x=x_2d, y=y_2d, z=magnitude,
            colorscale='RdYlBu_r',
            name="Linhas de Corrente",
            line=dict(width=2),
            contours=dict(
                coloring='lines',
                showlabels=False
            ),
            showscale=False
        ), row=1, col=2)
        
        # Adicionar algumas linhas de corrente manuais para melhor visualização
        for y_start in [0.5, 1.0, 1.5, 2.0, 2.5]:
            x_stream = np.linspace(0, 9, 50)
            y_stream = y_start + 0.3 * np.sin(x_stream/2) * np.exp(-x_stream/8)
            
            fig_field.add_trace(go.Scatter(
                x=x_stream, y=y_stream,
                mode='lines',
                line=dict(color='red', width=2),
                name=f"Corrente {y_start}m" if y_start == 0.5 else "",
                showlegend=True if y_start == 0.5 else False
            ), row=1, col=2)
        
        fig_field.update_layout(
            title="🌊 Análise Completa do Campo de Velocidades",
            template="plotly_white",
            height=500,
            showlegend=True,
            legend=dict(
                orientation="h",
                yanchor="bottom",
                y=1.02,
                xanchor="right",
                x=1
            )
        )
        
        fig_field.update_xaxes(title_text="Posição Longitudinal (m)")
        fig_field.update_yaxes(title_text="Altura (m)")
        
        st.plotly_chart(fig_field, use_container_width=True)
    
    with tab3:
        st.subheader("🤖 Predição com Redes Neurais Artificiais")
        
        # Mostrar fórmulas da rede neural - MELHORADO
        st.markdown("#### 📐 Formulação Matemática da Rede Neural")
        
        col1, col2, col3 = st.columns(3)
        with col1:
            st.markdown('<div class="enhanced-formula"><strong>Função de Ativação (ReLU)</strong><br>f(x) = max(0, x)</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Propagação Direta</strong><br>y = f(W · x + b)</div>', unsafe_allow_html=True)
        
        with col2:
            st.markdown('<div class="enhanced-formula"><strong>Função de Custo (MSE)</strong><br>MSE = (1/n)Σ(yᵢ - ŷᵢ)²</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Backpropagation</strong><br>∂E/∂wᵢⱼ = ∂E/∂yⱼ · ∂yⱼ/∂wᵢⱼ</div>', unsafe_allow_html=True)
        
        with col3:
            st.markdown('<div class="enhanced-formula"><strong>Gradiente Descendente</strong><br>w(t+1) = w(t) - η∇E</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Regularização L2</strong><br>E = MSE + λΣwᵢ²</div>', unsafe_allow_html=True)
        
        # Aviso sobre dados sintéticos
        st.warning(
            "⚠️ **Dados sintéticos:** Este modelo é treinado com dados gerados pelo modelo físico "
            "(com ruído de medição simulado). Para aplicação real, substitua por dados históricos "
            "de planta (SCADA/PIMS). Os scores refletem a capacidade de aprender o modelo físico, "
            "não a precisão em dados reais."
        )

        # Treinar modelo neural
        col1, col2 = st.columns([1, 2])

        with col1:
            if st.button("🚀 Treinar Rede Neural", type="primary"):
                with st.spinner("Treinando rede neural..."):
                    train_score, test_score = nn_predictor.train()
                    st.success(f"✅ Modelo treinado!\n\n📊 **Score treino (R²):** {train_score:.3f}\n📈 **Score teste (R²):** {test_score:.3f}")

                    # Avaliar qualidade do modelo
                    if test_score > 0.90:
                        st.success("🏆 Boa qualidade de ajuste ao modelo físico")
                    elif test_score > 0.80:
                        st.info("👍 Qualidade aceitável - ruído de medição limita o score")
                    else:
                        st.warning("⚠️ Score baixo - considere aumentar iterações ou ajustar hiperparâmetros")
            
            # Fazer predições
            features = [flow_rate, pressure, temperature, water_cut, gor, viscosity]
            
            if st.button("🔮 Fazer Predição"):
                if not nn_predictor.is_trained:
                    with st.spinner("Treinando modelo primeiro..."):
                        nn_predictor.train()
                
                predictions = nn_predictor.predict(features)
                eff_gl_pred, eff_oa_pred, energy_pred = predictions
                
                st.session_state.predictions = predictions
                
                col1a, col2a, col3a = st.columns(3)
                
                with col1a:
                    delta_gl = eff_gl_pred - 0.94
                    st.metric("🔸 Predição Eff. G-L", f"{eff_gl_pred:.1%}", f"{delta_gl:+.1%}")
                with col2a:
                    delta_oa = eff_oa_pred - 0.89
                    st.metric("🔹 Predição Eff. O-A", f"{eff_oa_pred:.1%}", f"{delta_oa:+.1%}")
                with col3a:
                    delta_energy = energy_pred - 2.4
                    st.metric("⚡ Predição Energia", f"{energy_pred:.2f} MWh/1000m³", f"{delta_energy:+.2f}")
        
        with col2:
            # Visualização da arquitetura da rede - MELHORADO
            st.markdown("#### 🏗️ Arquitetura da Rede Neural")
            
            # Criar visualização mais sofisticada da arquitetura
            layers = [6, 64, 32, 16, 3]
            layer_names = ["Entrada\n(6 neurônios)", "Oculta 1\n(64 neurônios)", 
                          "Oculta 2\n(32 neurônios)", "Oculta 3\n(16 neurônios)", "Saída\n(3 neurônios)"]
            layer_colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7']
            
            fig_arch = go.Figure()
            
            for i, (neurons, name, color) in enumerate(zip(layers, layer_names, layer_colors)):
                # Criar posições dos neurônios
                if neurons <= 10:
                    y_positions = np.linspace(-neurons/2, neurons/2, neurons)
                else:
                    # Para camadas grandes, mostrar apenas alguns neurônios representativos
                    y_positions = np.linspace(-5, 5, min(neurons, 10))
                
                # Adicionar neurônios
                fig_arch.add_trace(go.Scatter(
                    x=[i] * len(y_positions),
                    y=y_positions,
                    mode='markers+text',
                    marker=dict(
                        size=20 if neurons <= 10 else 15,
                        color=color,
                        line=dict(width=2, color='white'),
                        opacity=0.8
                    ),
                    name=name,
                    text=[''] * len(y_positions),
                    hovertemplate=f"<b>{name}</b><br>Camada {i+1}<br>Neurônios: {neurons}<extra></extra>",
                    showlegend=True
                ))
                
                # Adicionar conexões entre camadas
                if i < len(layers) - 1:
                    next_neurons = min(layers[i+1], 10)
                    next_y = np.linspace(-5, 5, next_neurons) if layers[i+1] > 10 else np.linspace(-layers[i+1]/2, layers[i+1]/2, layers[i+1])
                    
                    # Conectar alguns neurônios para visualização
                    for y1 in y_positions[::max(1, len(y_positions)//3)]:
                        for y2 in next_y[::max(1, len(next_y)//3)]:
                            fig_arch.add_trace(go.Scatter(
                                x=[i, i+1],
                                y=[y1, y2],
                                mode='lines',
                                line=dict(color='gray', width=0.5, dash='dot'),
                                showlegend=False,
                                hoverinfo='skip'
                            ))
                
                # Adicionar labels das camadas
                fig_arch.add_annotation(
                    x=i, y=6,
                    text=f"<b>{name.split('(')[0]}</b><br>{neurons} neurônios",
                    showarrow=False,
                    font=dict(size=10, color=color),
                    bgcolor="white",
                    bordercolor=color,
                    borderwidth=1
                )
            
            fig_arch.update_layout(
                title="🧠 Arquitetura da Rede Neural - MLPRegressor",
                xaxis_title="Camadas",
                yaxis_title="Neurônios",
                showlegend=False,
                template="plotly_white",
                height=400,
                xaxis=dict(tickmode='array', tickvals=list(range(5)), ticktext=layer_names),
                yaxis=dict(range=[-7, 8])
            )
            st.plotly_chart(fig_arch, use_container_width=True)
        
        # Gráfico de predição vs real (se houver predições) - MELHORADO
        if hasattr(st.session_state, 'predictions'):
            st.markdown("#### 📊 Análise Comparativa das Predições")
            
            # Valores reais calculados pelo modelo físico
            real_eff_gl = separator_model.separation_efficiency_gl(flow_rate, pressure, temperature, gor)
            real_eff_oa = separator_model.separation_efficiency_oa(flow_rate, temperature, water_cut, viscosity)
            real_energy = separator_model.energy_consumption(flow_rate, pressure, temperature)
            
            pred_eff_gl, pred_eff_oa, pred_energy = st.session_state.predictions
            
            # Criar subplot para comparação melhorada
            fig_comparison = make_subplots(
                rows=2, cols=2,
                subplot_titles=('Comparação Geral', 'Eficiência G-L', 'Eficiência O-A', 'Consumo de Energia'),
                specs=[[{"colspan": 2}, None], [{}, {}]],
                vertical_spacing=0.12
            )
            
            # Gráfico 1: Comparação geral
            categories = ['Eficiência G-L (%)', 'Eficiência O-A (%)', 'Energia (MWh/1000m³)']
            real_values = [real_eff_gl*100, real_eff_oa*100, real_energy]
            pred_values = [pred_eff_gl*100, pred_eff_oa*100, pred_energy]
            
            fig_comparison.add_trace(go.Bar(
                x=categories, y=real_values,
                name='🔬 Modelo Físico',
                marker_color='#2ca02c',
                text=[f'{v:.1f}' for v in real_values],
                textposition='outside',
                hovertemplate="<b>%{x}</b><br>Valor: %{y:.2f}<extra></extra>"
            ), row=1, col=1)
            
            fig_comparison.add_trace(go.Bar(
                x=categories, y=pred_values,
                name='🤖 Rede Neural',
                marker_color='#ff7f0e',
                text=[f'{v:.1f}' for v in pred_values],
                textposition='outside',
                hovertemplate="<b>%{x}</b><br>Predição: %{y:.2f}<extra></extra>"
            ), row=1, col=1)
            
            # Gráficos 2-4: Análise individual
            metrics = [
                ('Eficiência G-L', real_eff_gl*100, pred_eff_gl*100, '%'),
                ('Eficiência O-A', real_eff_oa*100, pred_eff_oa*100, '%'),
                ('Energia', real_energy, pred_energy, 'MWh/1000m³')
            ]
            
            positions = [(2, 1), (2, 2), (2, 1)]  # Ajustado para subplot layout
            
            for i, (metric, real_val, pred_val, unit) in enumerate(metrics[:2]):  # Apenas 2 por limitação de espaço
                row, col = positions[i]
                
                # Gauge chart para cada métrica
                error = abs(real_val - pred_val) / real_val * 100
                
                gauge_fig = go.Indicator(
                    mode="gauge+number+delta",
                    value=pred_val,
                    domain={'x': [0, 1], 'y': [0, 1]},
                    title={'text': f"{metric}"},
                    delta={'reference': real_val, 'relative': True, 'valueformat': '.1%'},
                    gauge={
                        'axis': {'range': [None, max(real_val, pred_val) * 1.2]},
                        'bar': {'color': "darkblue"},
                        'steps': [
                            {'range': [0, real_val * 0.9], 'color': "lightgray"},
                            {'range': [real_val * 0.9, real_val * 1.1], 'color': "gray"}],
                        'threshold': {
                            'line': {'color': "red", 'width': 4},
                            'thickness': 0.75,
                            'value': real_val}
                    }
                )
                
                fig_comparison.add_trace(gauge_fig, row=row, col=col)
            
            fig_comparison.update_layout(
                title="📊 Análise Comparativa: Modelo Físico vs Rede Neural",
                template="plotly_white",
                height=600,
                showlegend=True,
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                ),
                barmode='group'
            )
            
            st.plotly_chart(fig_comparison, use_container_width=True)
            
            # Métricas de erro
            col1, col2, col3 = st.columns(3)
            
            with col1:
                error_gl = abs(real_eff_gl - pred_eff_gl) / real_eff_gl * 100
                st.metric("🎯 Erro Eff. G-L", f"{error_gl:.2f}%")
            
            with col2:
                error_oa = abs(real_eff_oa - pred_eff_oa) / real_eff_oa * 100
                st.metric("🎯 Erro Eff. O-A", f"{error_oa:.2f}%")
            
            with col3:
                error_energy = abs(real_energy - pred_energy) / real_energy * 100
                st.metric("🎯 Erro Energia", f"{error_energy:.2f}%")
    
    with tab4:
        st.subheader("🎯 Otimização Multiobjetivo (NSGA-II)")
        
        # Mostrar fórmulas do NSGA-II - MELHORADO
        st.markdown("#### 📐 Formulação Matemática do NSGA-II")
        
        col1, col2, col3 = st.columns(3)
        with col1:
            st.markdown('<div class="enhanced-formula"><strong>Dominância de Pareto</strong><br>x₁ ≺ x₂ ⟺ fᵢ(x₁) ≤ fᵢ(x₂) ∀i</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Função Multi-Objetivo</strong><br>min F(x) = [f₁(x), f₂(x), f₃(x)]ᵀ</div>', unsafe_allow_html=True)
        
        with col2:
            st.markdown('<div class="enhanced-formula"><strong>Crowding Distance</strong><br>dᵢ = Σ(fₘⁱ⁺¹ - fₘⁱ⁻¹)/(fₘᵐᵃˣ - fₘᵐⁱⁿ)</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Seleção NSGA-II</strong><br>rank(x₁) < rank(x₂) OR d₁ > d₂</div>', unsafe_allow_html=True)
        
        with col3:
            st.markdown('<div class="enhanced-formula"><strong>Cruzamento SBX</strong><br>cᵢ = 0.5[(1±βq)p₁ᵢ + (1∓βq)p₂ᵢ]</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Mutação Polinomial</strong><br>x\' = x + δq·(xu - xl), δq ~ P(ηm)</div>', unsafe_allow_html=True)
        
        col1, col2 = st.columns([1, 2])
        
        with col1:
            st.markdown("#### ⚙️ Parâmetros de Otimização")
            pop_size = st.slider("👥 Tamanho da População", 20, 100, 50)
            generations = st.slider("🔄 Gerações", 50, 200, 100)
            
            # Adicionar parâmetros adicionais
            mutation_rate = st.slider("🧬 Taxa de Mutação", 0.01, 0.3, 0.1)
            crossover_rate = st.slider("🔀 Taxa de Cruzamento", 0.6, 1.0, 0.9)
            
            st.markdown("#### 🎯 Objetivos")
            st.markdown("✅ **Maximizar:** Eficiência de Separação")
            st.markdown("✅ **Minimizar:** Consumo de Energia")
            st.markdown("✅ **Minimizar:** Emissões de CO₂")
            
            if st.button("🚀 Executar Otimização", type="primary"):
                with st.spinner("Executando algoritmo NSGA-II..."):
                    # Progress bar simples
                    progress_bar = st.progress(0)
                    status_text = st.empty()
                    
                    # Simular progresso sem usar time.sleep
                    for i in range(0, 101, 25):
                        progress_bar.progress(i)
                        status_text.text(f'Progresso: {i}% - Avaliando soluções...')
                    
                    # Bounds: [flow_rate, pressure, temperature, water_cut]
                    bounds = [(150, 2400), (8.5, 15.2), (45, 85), (15, 78)]
                    
                    best_solutions = optimizer.nsga_ii_optimization(
                        bounds, pop_size, generations, mutation_rate, crossover_rate)
                    
                    if best_solutions:
                        # Armazenar resultados na sessão
                        st.session_state.optimization_results = best_solutions
                        progress_bar.progress(100)
                        status_text.text('✅ Otimização concluída!')
                        st.success(f"🎉 Otimização concluída! **{len(best_solutions)} soluções** encontradas na Fronteira de Pareto.")
                        
                        # Estatísticas da otimização
                        best_eff = max([-sol['objectives'][0] for sol in best_solutions])
                        best_energy = min([sol['objectives'][1] for sol in best_solutions])
                        
                        col1a, col2a = st.columns(2)
                        with col1a:
                            st.metric("🏆 Melhor Eficiência", f"{best_eff:.1%}")
                        with col2a:
                            st.metric("⚡ Menor Energia", f"{best_energy:.2f} MWh/1000m³")
        
        with col2:
            # Visualizar resultados da otimização - MELHORADO
            if hasattr(st.session_state, 'optimization_results'):
                results = st.session_state.optimization_results
                
                # Gráfico de convergência melhorado
                generations_data = [r['generation'] for r in results]
                efficiency_data = [-r['objectives'][0] for r in results]  # Converter de volta para maximização
                energy_data = [r['objectives'][1] for r in results]
                emissions_data = [r['objectives'][2] for r in results]
                
                fig_conv = make_subplots(
                    rows=3, cols=1,
                    subplot_titles=('Convergência - Eficiência (%)', 'Convergência - Energia (MWh/1000m³)', 'Convergência - Emissões (kg CO₂/m³)'),
                    vertical_spacing=0.08
                )
                
                # Eficiência
                fig_conv.add_trace(go.Scatter(
                    x=generations_data, y=[e*100 for e in efficiency_data],
                    mode='lines+markers', 
                    name='📈 Eficiência',
                    line=dict(color='#2ca02c', width=3),
                    marker=dict(size=4),
                    hovertemplate="<b>Geração:</b> %{x}<br><b>Eficiência:</b> %{y:.1f}%<extra></extra>"
                ), row=1, col=1)
                
                # Energia
                fig_conv.add_trace(go.Scatter(
                    x=generations_data, y=energy_data,
                    mode='lines+markers', 
                    name='⚡ Energia',
                    line=dict(color='#d62728', width=3),
                    marker=dict(size=4),
                    hovertemplate="<b>Geração:</b> %{x}<br><b>Energia:</b> %{y:.2f} MWh/1000m³<extra></extra>"
                ), row=2, col=1)
                
                # Emissões
                fig_conv.add_trace(go.Scatter(
                    x=generations_data, y=emissions_data,
                    mode='lines+markers', 
                    name='🌍 Emissões',
                    line=dict(color='#ff7f0e', width=3),
                    marker=dict(size=4),
                    hovertemplate="<b>Geração:</b> %{x}<br><b>Emissões:</b> %{y:.2f} kg CO₂/m³<extra></extra>"
                ), row=3, col=1)
                
                # Adicionar linhas de tendência
                if len(generations_data) > 5:
                    # Linha de tendência para eficiência
                    z_eff = np.polyfit(generations_data, efficiency_data, 1)
                    p_eff = np.poly1d(z_eff)
                    fig_conv.add_trace(go.Scatter(
                        x=generations_data, y=[p*100 for p in p_eff(generations_data)],
                        mode='lines',
                        name='Tendência Eficiência',
                        line=dict(color='#2ca02c', width=2, dash='dash'),
                        showlegend=False
                    ), row=1, col=1)
                
                fig_conv.update_layout(
                    title="📊 Convergência do Algoritmo NSGA-II",
                    template="plotly_white",
                    height=500,
                    showlegend=True,
                    legend=dict(
                        orientation="h",
                        yanchor="bottom",
                        y=1.02,
                        xanchor="right",
                        x=1
                    )
                )
                
                fig_conv.update_xaxes(title_text="Geração", row=3, col=1)
                
                st.plotly_chart(fig_conv, use_container_width=True)
            else:
                # Mostrar gráfico explicativo do NSGA-II
                st.markdown("#### 📚 Conceitos do NSGA-II")
                
                # Gráfico de exemplo da Fronteira de Pareto
                np.random.seed(42)
                n_points = 50
                
                # Gerar pontos aleatórios para demonstração
                obj1 = np.random.uniform(0.85, 0.98, n_points)  # Eficiência
                obj2 = 4 - obj1 * 2 + np.random.normal(0, 0.1, n_points)  # Energia (trade-off)
                
                # Encontrar fronteira de Pareto aproximada
                pareto_indices = []
                for i in range(n_points):
                    is_pareto = True
                    for j in range(n_points):
                        if i != j:
                            if obj1[j] >= obj1[i] and obj2[j] <= obj2[i] and (obj1[j] > obj1[i] or obj2[j] < obj2[i]):
                                is_pareto = False
                                break
                    if is_pareto:
                        pareto_indices.append(i)
                
                fig_pareto = go.Figure()
                
                # Pontos dominados
                fig_pareto.add_trace(go.Scatter(
                    x=obj1, y=obj2,
                    mode='markers',
                    name='🔵 Soluções Dominadas',
                    marker=dict(color='lightblue', size=8, opacity=0.6),
                    hovertemplate="<b>Eficiência:</b> %{x:.1%}<br><b>Energia:</b> %{y:.2f} MWh/1000m³<extra></extra>"
                ))
                
                # Fronteira de Pareto
                pareto_obj1 = [obj1[i] for i in pareto_indices]
                pareto_obj2 = [obj2[i] for i in pareto_indices]
                
                # Ordenar para linha contínua
                sorted_pairs = sorted(zip(pareto_obj1, pareto_obj2))
                pareto_obj1_sorted = [x for x, y in sorted_pairs]
                pareto_obj2_sorted = [y for x, y in sorted_pairs]
                
                fig_pareto.add_trace(go.Scatter(
                    x=pareto_obj1_sorted, y=pareto_obj2_sorted,
                    mode='markers+lines',
                    name='🔴 Fronteira de Pareto',
                    marker=dict(color='red', size=12),
                    line=dict(color='red', width=3),
                    hovertemplate="<b>Eficiência:</b> %{x:.1%}<br><b>Energia:</b> %{y:.2f} MWh/1000m³<br><b>Status:</b> Não-dominado<extra></extra>"
                ))
                
                fig_pareto.update_layout(
                    title="🎯 Exemplo de Fronteira de Pareto - Eficiência vs Energia",
                    xaxis_title="Eficiência de Separação",
                    yaxis_title="Consumo de Energia (MWh/1000m³)",
                    template="plotly_white",
                    height=400,
                    xaxis=dict(tickformat='.1%'),
                    legend=dict(
                        orientation="h",
                        yanchor="bottom",
                        y=1.02,
                        xanchor="right",
                        x=1
                    )
                )
                
                st.plotly_chart(fig_pareto, use_container_width=True)
        
        # Melhor solução encontrada com gráfico - MELHORADO
        if hasattr(st.session_state, 'optimization_results'):
            results = st.session_state.optimization_results
            best_solution = max(results, key=lambda x: -x['objectives'][0])
            
            st.markdown("#### 🏆 Melhor Solução Encontrada")
            
            col1, col2 = st.columns(2)
            
            with col1:
                st.markdown("##### 📊 Parâmetros Operacionais Ótimos")
                
                col1a, col2a, col3a, col4a = st.columns(4)
                with col1a:
                    delta_flow = best_solution['solution'][0] - flow_rate
                    st.metric("🌊 Vazão Ótima", f"{best_solution['solution'][0]:.0f} m³/dia", f"{delta_flow:+.0f}")
                with col2a:
                    delta_press = best_solution['solution'][1] - pressure
                    st.metric("🔧 Pressão Ótima", f"{best_solution['solution'][1]:.1f} bar", f"{delta_press:+.1f}")
                with col3a:
                    delta_temp = best_solution['solution'][2] - temperature
                    st.metric("🌡️ Temperatura Ótima", f"{best_solution['solution'][2]:.1f} °C", f"{delta_temp:+.1f}")
                with col4a:
                    delta_water = best_solution['solution'][3] - water_cut
                    st.metric("💧 Corte Água Ótimo", f"{best_solution['solution'][3]:.1f} %", f"{delta_water:+.1f}")
                
                # Objetivos otimizados - MELHORADO
                st.markdown("##### 🎯 Objetivos Otimizados")
                
                col1b, col2b, col3b = st.columns(3)
                with col1b:
                    eff_gain = (-best_solution['objectives'][0] - (eff_gl + eff_oa)/2) * 100
                    st.metric("📈 Eficiência Total", f"{-best_solution['objectives'][0]:.1%}", f"+{eff_gain:.1f}%")
                with col2b:
                    energy_reduction = energy_consumption - best_solution['objectives'][1]
                    st.metric("⚡ Energia", f"{best_solution['objectives'][1]:.2f} MWh/1000m³", f"{-energy_reduction:.2f}")
                with col3b:
                    st.metric("🌍 Emissões", f"{best_solution['objectives'][2]:.2f} kg CO₂/m³", "📉")
            
            with col2:
                # Gráfico radar da melhor solução - MELHORADO
                current_vals = [flow_rate, pressure, temperature, water_cut]
                optimal_vals = best_solution['solution']
                
                params = ['Vazão\n(m³/dia)', 'Pressão\n(bar)', 'Temperatura\n(°C)', 'Corte Água\n(%)']
                
                # Normalizar valores para 0-100 para o gráfico radar
                bounds_radar = [(150, 2400), (8.5, 15.2), (45, 85), (15, 78)]
                current_norm = [(val - bounds_radar[i][0])/(bounds_radar[i][1] - bounds_radar[i][0]) * 100 
                               for i, val in enumerate(current_vals)]
                optimal_norm = [(val - bounds_radar[i][0])/(bounds_radar[i][1] - bounds_radar[i][0]) * 100 
                               for i, val in enumerate(optimal_vals)]
                
                fig_radar_opt = go.Figure()
                
                # Configuração atual
                fig_radar_opt.add_trace(go.Scatterpolar(
                    r=current_norm,
                    theta=params,
                    fill='toself',
                    name='⚙️ Configuração Atual',
                    line=dict(color='#ff7f0e', width=3),
                    fillcolor='rgba(255, 127, 14, 0.3)',
                    hovertemplate="<b>%{theta}</b><br>Atual: %{r:.1f}%<br>Valor real: " + 
                                 "<br>".join([f"{current_vals[i]:.1f}" for i in range(len(current_vals))]) + "<extra></extra>"
                ))
                
                # Configuração otimizada
                fig_radar_opt.add_trace(go.Scatterpolar(
                    r=optimal_norm,
                    theta=params,
                    fill='toself',
                    name='🎯 Configuração Otimizada',
                    line=dict(color='#2ca02c', width=3),
                    fillcolor='rgba(44, 160, 44, 0.3)',
                    hovertemplate="<b>%{theta}</b><br>Otimizado: %{r:.1f}%<br>Valor real: " + 
                                 "<br>".join([f"{optimal_vals[i]:.1f}" for i in range(len(optimal_vals))]) + "<extra></extra>"
                ))
                
                fig_radar_opt.update_layout(
                    polar=dict(
                        radialaxis=dict(
                            visible=True, 
                            range=[0, 100],
                            ticksuffix='%',
                            gridcolor='lightgray'
                        ),
                        angularaxis=dict(
                            gridcolor='lightgray'
                        )
                    ),
                    title="🔄 Configuração Atual vs Otimizada",
                    template="plotly_white",
                    height=400,
                    legend=dict(
                        orientation="h",
                        yanchor="bottom",
                        y=1.02,
                        xanchor="right",
                        x=1
                    )
                )
                st.plotly_chart(fig_radar_opt, use_container_width=True)
            
            # Análise de sensibilidade da solução ótima - NOVO
            st.markdown("#### 📊 Análise de Sensibilidade da Solução Ótima")
            
            # Variar cada parâmetro e ver impacto nos objetivos
            param_names = ['Vazão', 'Pressão', 'Temperatura', 'Corte de Água']
            param_ranges = [
                np.linspace(150, 2400, 20),
                np.linspace(8.5, 15.2, 20),
                np.linspace(45, 85, 20),
                np.linspace(15, 78, 20)
            ]
            
            fig_sensitivity = make_subplots(
                rows=2, cols=2,
                subplot_titles=param_names,
                vertical_spacing=0.12,
                horizontal_spacing=0.1
            )
            
            for i, (param_name, param_range) in enumerate(zip(param_names, param_ranges)):
                row = (i // 2) + 1
                col = (i % 2) + 1
                
                efficiencies = []
                energies = []
                
                for param_val in param_range:
                    # Criar solução temporária variando apenas um parâmetro
                    temp_solution = best_solution['solution'].copy()
                    temp_solution[i] = param_val
                    
                    # Calcular objetivos
                    objectives = optimizer.evaluate_objectives(temp_solution)
                    efficiencies.append(-objectives[0])  # Converter para maximização
                    energies.append(objectives[1])
                
                # Adicionar eficiência
                fig_sensitivity.add_trace(go.Scatter(
                    x=param_range, y=efficiencies,
                    mode='lines+markers',
                    name=f'Eficiência - {param_name}' if i == 0 else '',
                    line=dict(color='#2ca02c', width=2),
                    marker=dict(size=4),
                    showlegend=True if i == 0 else False,
                    yaxis='y',
                    hovertemplate=f"<b>{param_name}:</b> %{{x:.1f}}<br><b>Eficiência:</b> %{{y:.2%}}<extra></extra>"
                ), row=row, col=col)
                
                # Marcar valor ótimo
                optimal_idx = min(range(len(param_range)), key=lambda x: abs(param_range[x] - best_solution['solution'][i]))
                fig_sensitivity.add_trace(go.Scatter(
                    x=[param_range[optimal_idx]], y=[efficiencies[optimal_idx]],
                    mode='markers',
                    name=f'Ótimo - {param_name}' if i == 0 else '',
                    marker=dict(color='red', size=10, symbol='star'),
                    showlegend=True if i == 0 else False,
                    hovertemplate=f"<b>Valor Ótimo:</b> %{{x:.1f}}<br><b>Eficiência:</b> %{{y:.2%}}<extra></extra>"
                ), row=row, col=col)
            
            fig_sensitivity.update_layout(
                title="📈 Sensibilidade dos Parâmetros na Eficiência",
                template="plotly_white",
                height=500,
                showlegend=True,
                yaxis=dict(tickformat='.1%', title="Eficiência"),
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            
            st.plotly_chart(fig_sensitivity, use_container_width=True)
    
    with tab5:
        st.subheader("🔧 Sistema de Controle Fuzzy")
        
        # Mostrar fórmulas do controle fuzzy - MELHORADO
        st.markdown("#### 📐 Formulação Matemática do Controle Fuzzy")
        
        col1, col2, col3 = st.columns(3)
        with col1:
            st.markdown('<div class="enhanced-formula"><strong>Função Triangular</strong><br>μ_A(x) = max(0, min((x-a)/(b-a), (c-x)/(c-b)))</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Função Gaussiana</strong><br>μ_A(x) = exp(-0.5((x-c)/σ)²)</div>', unsafe_allow_html=True)
        
        with col2:
            st.markdown('<div class="enhanced-formula"><strong>Operador AND (Mínimo)</strong><br>μ_A∩B(x) = min(μ_A(x), μ_B(x))</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Operador OR (Máximo)</strong><br>μ_A∪B(x) = max(μ_A(x), μ_B(x))</div>', unsafe_allow_html=True)
        
        with col3:
            st.markdown('<div class="enhanced-formula"><strong>Defuzzificação (COG)</strong><br>x* = Σ(xᵢ·μ(xᵢ)) / Σμ(xᵢ)</div>', unsafe_allow_html=True)
            st.markdown('<div class="enhanced-formula"><strong>Regra Fuzzy</strong><br>SE A E B ENTÃO C (força = min(μ_A, μ_B))</div>', unsafe_allow_html=True)
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("#### 🔍 Fuzzificação da Eficiência")
            
            efficiency_test = st.slider("Eficiência para Teste", 0.8, 1.0, eff_gl, step=0.01)
            
            # Calcular graus de pertinência
            fuzzy_eff = fuzzy_controller.fuzzify_efficiency(efficiency_test)
            
            # Mostrar resultados com cores
            col1a, col2a, col3a = st.columns(3)
            with col1a:
                st.metric("🔴 Baixa", f"{fuzzy_eff['low']:.3f}")
            with col2a:
                st.metric("🟡 Média", f"{fuzzy_eff['medium']:.3f}")
            with col3a:
                st.metric("🟢 Alta", f"{fuzzy_eff['high']:.3f}")
            
            # Visualizar funções de pertinência melhoradas
            x_range = np.linspace(0.8, 1.0, 200)
            low_values = [fuzzy_controller.triangular_membership(x, 0.8, 0.85, 0.9) for x in x_range]
            medium_values = [fuzzy_controller.triangular_membership(x, 0.85, 0.9, 0.95) for x in x_range]
            high_values = [fuzzy_controller.triangular_membership(x, 0.9, 0.95, 1.0) for x in x_range]
            
            fig_fuzzy = go.Figure()
            
            # Baixa
            fig_fuzzy.add_trace(go.Scatter(
                x=x_range, y=low_values, 
                name='🔴 Baixa', 
                fill='tozeroy', 
                fillcolor='rgba(255, 99, 132, 0.3)',
                line=dict(color='#ff6384', width=3),
                hovertemplate="<b>Eficiência:</b> %{x:.3f}<br><b>Pertinência Baixa:</b> %{y:.3f}<extra></extra>"
            ))
            
            # Média
            fig_fuzzy.add_trace(go.Scatter(
                x=x_range, y=medium_values, 
                name='🟡 Média', 
                fill='tozeroy', 
                fillcolor='rgba(255, 206, 86, 0.3)',
                line=dict(color='#ffce56', width=3),
                hovertemplate="<b>Eficiência:</b> %{x:.3f}<br><b>Pertinência Média:</b> %{y:.3f}<extra></extra>"
            ))
            
            # Alta
            fig_fuzzy.add_trace(go.Scatter(
                x=x_range, y=high_values, 
                name='🟢 Alta', 
                fill='tozeroy', 
                fillcolor='rgba(75, 192, 192, 0.3)',
                line=dict(color='#4bc0c0', width=3),
                hovertemplate="<b>Eficiência:</b> %{x:.3f}<br><b>Pertinência Alta:</b> %{y:.3f}<extra></extra>"
            ))
            
            # Linha vertical para valor atual
            fig_fuzzy.add_vline(
                x=efficiency_test, 
                line_dash="dash", 
                line_color="black", 
                line_width=3,
                annotation_text=f"Atual: {efficiency_test:.3f}",
                annotation_position="top"
            )
            
            # Adicionar pontos de intersecção
            current_low = fuzzy_controller.triangular_membership(efficiency_test, 0.8, 0.85, 0.9)
            current_medium = fuzzy_controller.triangular_membership(efficiency_test, 0.85, 0.9, 0.95)
            current_high = fuzzy_controller.triangular_membership(efficiency_test, 0.9, 0.95, 1.0)
            
            fig_fuzzy.add_trace(go.Scatter(
                x=[efficiency_test, efficiency_test, efficiency_test],
                y=[current_low, current_medium, current_high],
                mode='markers',
                name='📍 Valores Atuais',
                marker=dict(color=['red', 'orange', 'green'], size=12, symbol='circle'),
                hovertemplate="<b>Pertinência:</b> %{y:.3f}<extra></extra>"
            ))
            
            fig_fuzzy.update_layout(
                title="🎯 Funções de Pertinência - Eficiência de Separação",
                xaxis_title="Eficiência",
                yaxis_title="Grau de Pertinência",
                template="plotly_white",
                height=400,
                xaxis=dict(tickformat='.2%'),
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            st.plotly_chart(fig_fuzzy, use_container_width=True)
        
        with col2:
            st.markdown("#### 📋 Base de Regras Fuzzy")
            
            # Base de regras expandida
            rules_df = pd.DataFrame([
                ["🔴 SE Eficiência BAIXA E 💧 Água ALTA", "🌡️ ENTÃO Aumentar Temperatura"],
                ["⚡ SE Energia ALTA E 🌊 Vazão NORMAL", "📉 ENTÃO Reduzir Pressão"],
                ["🫧 SE Espuma DETECTADA", "🧪 ENTÃO Adicionar Antiespumante"],
                ["🔄 SE Emulsão ESTÁVEL", "🔥 ENTÃO Aumentar Aquecimento"],
                ["📈 SE Pressão ALTA E 💨 GOR ALTO", "⚙️ ENTÃO Ajustar Válvula Gas"],
                ["🌡️ SE Temperatura BAIXA E ⏱️ Tempo ALTO", "🔥 ENTÃO Aumentar Aquecimento"],
                ["💧 SE Corte Água EXTREMO", "🔧 ENTÃO Ajustar Tempo Residência"]
            ], columns=["🔍 Condição", "⚡ Ação"])
            
            # Estilizar o dataframe
            st.dataframe(
                rules_df, 
                use_container_width=True,
                height=280
            )
            
            # Sistema de inferência melhorado
            st.markdown("#### 🧠 Inferência Fuzzy")
            
            # Simular algumas condições com base nos parâmetros atuais
            conditions = {
                "eficiência_baixa": max(0, min(1, (0.9 - efficiency_test) * 4)),
                "água_alta": max(0, min(1, (water_cut - 40) / 30)),
                "energia_alta": max(0, min(1, (energy_consumption - 2.0) / 1.0)),
                "pressão_alta": max(0, min(1, (pressure - 10) / 5)),
                "temperatura_baixa": max(0, min(1, (70 - temperature) / 25))
            }
            
            # Calcular ações baseadas nas regras
            actions = {
                "aumentar_temperatura": max(
                    conditions["eficiência_baixa"] * conditions["água_alta"],
                    conditions["temperatura_baixa"]
                ),
                "reduzir_pressão": conditions["energia_alta"] * 0.8,
                "adicionar_antiespumante": 0.3 if water_cut > 60 else 0.1,
                "aumentar_aquecimento": conditions["eficiência_baixa"] * 0.7,
                "manter_atual": max(0, 1 - max(conditions.values()))
            }
            
            # Defuzzificação
            control_output = fuzzy_controller.defuzzify_control_action(actions)
            
            # Mostrar resultado da defuzzificação
            col1a, col2a = st.columns(2)
            with col1a:
                st.metric("🎯 Saída de Controle", f"{control_output:.3f}")
            with col2a:
                # Interpretar a saída
                if control_output > 0.7:
                    action_desc = "🔥 Ação Agressiva"
                    color = "red"
                elif control_output > 0.4:
                    action_desc = "⚡ Ação Moderada"
                    color = "orange"
                else:
                    action_desc = "🟢 Manter Estável"
                    color = "green"
                
                st.markdown(f'<div style="color: {color}; font-weight: bold; font-size: 1.2em;">{action_desc}</div>', unsafe_allow_html=True)
            
            # Gráfico das ações melhorado
            fig_actions = go.Figure()
            
            actions_list = list(actions.keys())
            values_list = list(actions.values())
            colors = ['#ff9999', '#66b3ff', '#99ff99', '#ffcc99', '#ff99cc']
            
            # Criar gráfico de barras horizontais
            fig_actions.add_trace(go.Bar(
                y=actions_list,
                x=values_list,
                orientation='h',
                marker=dict(
                    color=colors[:len(actions_list)],
                    line=dict(color='white', width=2)
                ),
                text=[f'{v:.3f}' for v in values_list],
                textposition='auto',
                hovertemplate="<b>Ação:</b> %{y}<br><b>Ativação:</b> %{x:.3f}<extra></extra>"
            ))
            
            # Adicionar linha de limiar
            fig_actions.add_vline(x=0.5, line_dash="dash", line_color="red", line_width=2,
                                 annotation_text="Limiar de Ação")
            
            fig_actions.update_layout(
                title="📊 Ativação das Regras de Controle",
                xaxis_title="Grau de Ativação",
                yaxis_title="Ações de Controle",
                template="plotly_white",
                height=400,
                showlegend=False
            )
            st.plotly_chart(fig_actions, use_container_width=True)
        
        # Superfície de controle 3D - MELHORADO
        st.markdown("#### 🌐 Superfície de Controle Fuzzy 3D")
        
        col1, col2 = st.columns(2)
        
        with col1:
            # Parâmetros para superfície
            st.markdown("##### ⚙️ Parâmetros da Superfície")
            x_param = st.selectbox("Parâmetro X", ["Eficiência", "Corte de Água", "Temperatura"], index=0)
            y_param = st.selectbox("Parâmetro Y", ["Corte de Água", "Temperatura", "Pressão"], index=0)
            
            # Gerar superfície de controle
            if x_param == "Eficiência":
                x_range = np.linspace(0.8, 1.0, 25)
            elif x_param == "Corte de Água":
                x_range = np.linspace(15, 78, 25)
            else:  # Temperatura
                x_range = np.linspace(45, 85, 25)
            
            if y_param == "Corte de Água":
                y_range = np.linspace(15, 78, 25)
            elif y_param == "Temperatura":
                y_range = np.linspace(45, 85, 25)
            else:  # Pressão
                y_range = np.linspace(8.5, 15.2, 25)
            
            control_surface = np.zeros((25, 25))
            
            for i, x_val in enumerate(x_range):
                for j, y_val in enumerate(y_range):
                    # Simular condições para cada ponto
                    if x_param == "Eficiência":
                        cond_eff = max(0, min(1, (0.9 - x_val) * 4))
                    else:
                        cond_eff = 0.3
                    
                    if y_param == "Corte de Água":
                        cond_water = max(0, min(1, (y_val - 40) / 30))
                    elif y_param == "Temperatura":
                        cond_temp = max(0, min(1, (70 - y_val) / 25))
                    else:
                        cond_temp = 0.3
                        cond_water = 0.3
                    
                    # Calcular ação resultante
                    if y_param == "Corte de Água":
                        action_strength = cond_eff * cond_water
                    elif y_param == "Temperatura":
                        action_strength = cond_eff + cond_temp
                    else:
                        action_strength = cond_eff * 0.7
                    
                    control_surface[i, j] = min(action_strength, 1.0)
        
        with col2:
            # Plotar superfície 3D
            X_surf, Y_surf = np.meshgrid(x_range, y_range)
            
            fig_surface = go.Figure(data=[go.Surface(
                z=control_surface.T,
                x=X_surf,
                y=Y_surf,
                colorscale='Viridis',
                hovertemplate=f"<b>{x_param}:</b> %{{x:.2f}}<br><b>{y_param}:</b> %{{y:.2f}}<br><b>Ação:</b> %{{z:.3f}}<extra></extra>",
                colorbar=dict(title="Intensidade<br>da Ação")
            )])
            
            # Adicionar ponto atual
            if x_param == "Eficiência":
                current_x = efficiency_test
            elif x_param == "Corte de Água":
                current_x = water_cut
            else:  # Temperatura
                current_x = temperature
            
            if y_param == "Corte de Água":
                current_y = water_cut
            elif y_param == "Temperatura":
                current_y = temperature
            else:  # Pressão
                current_y = pressure
            
            # Encontrar z correspondente
            x_idx = min(range(len(x_range)), key=lambda i: abs(x_range[i] - current_x))
            y_idx = min(range(len(y_range)), key=lambda j: abs(y_range[j] - current_y))
            current_z = control_surface[x_idx, y_idx]
            
            fig_surface.add_trace(go.Scatter3d(
                x=[current_x],
                y=[current_y],
                z=[current_z],
                mode='markers',
                marker=dict(color='red', size=10, symbol='diamond'),
                name='📍 Ponto Atual',
                hovertemplate=f"<b>Condição Atual</b><br>{x_param}: %{{x:.2f}}<br>{y_param}: %{{y:.2f}}<br>Ação: %{{z:.3f}}<extra></extra>"
            ))
            
            fig_surface.update_layout(
                title=f"🎮 Superfície de Controle: {x_param} vs {y_param}",
                scene=dict(
                    xaxis_title=x_param,
                    yaxis_title=y_param,
                    zaxis_title="Ação de Controle",
                    camera=dict(eye=dict(x=1.2, y=1.2, z=0.8))
                ),
                height=500,
                template="plotly_white"
            )
            
            st.plotly_chart(fig_surface, use_container_width=True)
        
        # Sistema de controle adaptativo - NOVO
        st.markdown("#### 🤖 Sistema de Controle Adaptativo")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown("##### 📊 Monitoramento Contínuo")
            
            # Simular histórico de controle
            time_points = pd.date_range(start='2024-01-01', periods=50, freq='H')
            control_history = 0.5 + 0.3 * np.sin(np.arange(50) * 0.1) + np.random.normal(0, 0.05, 50)
            setpoint = [0.6] * 50
            
            fig_control = go.Figure()
            
            fig_control.add_trace(go.Scatter(
                x=time_points, y=control_history,
                mode='lines+markers',
                name='🎯 Saída de Controle',
                line=dict(color='#1f77b4', width=2),
                marker=dict(size=4)
            ))
            
            fig_control.add_trace(go.Scatter(
                x=time_points, y=setpoint,
                mode='lines',
                name='📋 Setpoint',
                line=dict(color='red', width=2, dash='dash')
            ))
            
            fig_control.update_layout(
                title="Histórico de Controle",
                xaxis_title="Tempo",
                yaxis_title="Saída de Controle",
                template="plotly_white",
                height=300,
                legend=dict(orientation="h", y=1.02)
            )
            
            st.plotly_chart(fig_control, use_container_width=True)
        
        with col2:
            st.markdown("##### 🎯 Performance do Controlador")
            
            # Métricas de performance
            mse = np.mean((np.array(control_history) - np.array(setpoint))**2)
            mae = np.mean(np.abs(np.array(control_history) - np.array(setpoint)))
            stability = 1 - np.std(control_history) / np.mean(control_history)
            
            st.metric("📊 MSE", f"{mse:.4f}")
            st.metric("📈 MAE", f"{mae:.4f}")
            st.metric("⚖️ Estabilidade", f"{stability:.1%}")
            
            # Status do controlador
            if mse < 0.01:
                status = "🟢 EXCELENTE"
                color = "green"
            elif mse < 0.05:
                status = "🟡 BOM"
                color = "orange"
            else:
                status = "🔴 REQUER AJUSTE"
                color = "red"
            
            st.markdown(f'<div style="color: {color}; font-weight: bold; font-size: 1.1em; text-align: center; padding: 10px; border: 2px solid {color}; border-radius: 5px;">Status: {status}</div>', unsafe_allow_html=True)
        
        with col3:
            st.markdown("##### 🔧 Parâmetros Adaptativos")
            
            # Parâmetros que se adaptam
            learning_rate = st.slider("🎓 Taxa de Aprendizado", 0.01, 0.3, 0.1)
            adaptation_factor = st.slider("🔄 Fator de Adaptação", 0.5, 2.0, 1.0)
            memory_factor = st.slider("🧠 Fator de Memória", 0.1, 0.9, 0.7)
            
            # Mostrar efeito dos parâmetros
            st.markdown("**Efeitos dos Parâmetros:**")
            st.markdown(f"• Taxa de Aprendizado: {'Rápida' if learning_rate > 0.15 else 'Moderada' if learning_rate > 0.08 else 'Lenta'}")
            st.markdown(f"• Adaptação: {'Alta' if adaptation_factor > 1.5 else 'Moderada' if adaptation_factor > 1.0 else 'Baixa'}")
            st.markdown(f"• Memória: {'Longa' if memory_factor > 0.7 else 'Média' if memory_factor > 0.4 else 'Curta'}")
    
    with tab6:
        st.subheader("💰 Análise Econômica Detalhada")

        st.info(
            "📝 **Todos os valores econômicos devem ser inseridos manualmente** com base nos dados "
            "reais da sua planta/projeto. Os valores padrão são apenas referências iniciais."
        )

        # --- Seção 1: Investimento e Parâmetros Financeiros ---
        st.markdown("#### 💼 Investimento e Parâmetros Financeiros")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            investment_cost = st.number_input(
                "💵 Investimento Total (USD)", 0, 10_000_000, 450_000, step=10_000,
                help="Custo total do projeto de otimização (equipamentos, instalação, comissionamento)")
        with col2:
            discount_rate = st.number_input(
                "📈 Taxa de Desconto (%/ano)", 0.0, 30.0, 12.0, step=0.5,
                help="Taxa mínima de atratividade (TMA) ou WACC da empresa") / 100
        with col3:
            years = st.number_input(
                "📅 Horizonte de Análise (anos)", 1, 30, 15, step=1,
                help="Período de análise do fluxo de caixa")
        with col4:
            operating_days = st.number_input(
                "🏭 Dias Operacionais/Ano", 200, 365, 335, step=5,
                help="Dias efetivos de operação por ano (descontar paradas)")

        # --- Seção 2: Receitas Anuais ---
        st.markdown("#### 📈 Receitas Anuais (USD/ano)")
        st.caption("Informe as receitas adicionais esperadas com a otimização do separador.")

        col1, col2, col3 = st.columns(3)

        with col1:
            revenue_increase = st.number_input(
                "🛢️ Receita Adicional de Óleo (USD/ano)", 0, 50_000_000, 120_000, step=5_000,
                help="Receita extra pela recuperação de óleo antes perdido na separação")
        with col2:
            annual_gas_revenue = st.number_input(
                "💨 Receita de Gás Natural (USD/ano)", 0, 10_000_000, 50_000, step=5_000,
                help="Receita pela melhor recuperação/aproveitamento do gás separado")
        with col3:
            other_revenue = st.number_input(
                "📊 Outras Receitas (USD/ano)", 0, 10_000_000, 0, step=5_000,
                help="Créditos de carbono, venda de subprodutos, etc.")

        # --- Seção 3: Economias Anuais ---
        st.markdown("#### 📉 Economias Anuais (USD/ano)")
        st.caption("Informe as reduções de custo esperadas com a otimização.")

        col1, col2, col3, col4 = st.columns(4)

        with col1:
            annual_energy_savings = st.number_input(
                "⚡ Economia de Energia (USD/ano)", 0, 5_000_000, 30_000, step=1_000,
                help="Redução no consumo de energia elétrica e gás combustível")
        with col2:
            annual_chemical_savings = st.number_input(
                "🧪 Economia de Químicos (USD/ano)", 0, 2_000_000, 15_000, step=1_000,
                help="Redução na dosagem de desemulsificante, antiespumante, etc.")
        with col3:
            annual_maintenance_savings = st.number_input(
                "🛠️ Economia de Manutenção (USD/ano)", 0, 3_000_000, 20_000, step=1_000,
                help="Redução em paradas não-programadas e peças de reposição")
        with col4:
            annual_water_savings = st.number_input(
                "💧 Economia Tratamento de Água (USD/ano)", 0, 5_000_000, 10_000, step=1_000,
                help="Redução no custo de tratamento da água produzida (menor TOG)")

        # --- Cálculos Financeiros ---
        total_annual_benefits = (revenue_increase + annual_gas_revenue + other_revenue +
                                annual_energy_savings + annual_chemical_savings +
                                annual_maintenance_savings + annual_water_savings)

        # Fluxo de caixa: investimento no ano 0, benefícios dos anos 1 ao horizonte
        cash_flows = [-investment_cost] + [total_annual_benefits for _ in range(years)]

        # VPL
        npv = sum(cf / (1 + discount_rate)**i for i, cf in enumerate(cash_flows))

        # TIR
        def npv_func(rate):
            if rate <= -1:
                return 1e10
            return sum(cf / (1 + rate)**i for i, cf in enumerate(cash_flows))

        try:
            irr = opt.brentq(npv_func, -0.5, 10.0) if total_annual_benefits > 0 else 0.0
        except Exception:
            irr = 0.0

        # Payback simples
        payback_period = investment_cost / total_annual_benefits if total_annual_benefits > 0 else float('inf')
        
        # Visualização dos resultados - MELHORADO
        st.markdown("#### 📊 Resultados da Análise Econômica")
        
        col1, col2 = st.columns(2)
        
        with col1:
            # Métricas financeiras principais
            st.markdown("##### 📈 Indicadores Financeiros Principais")
            
            col1a, col2a, col3a, col4a = st.columns(4)
            with col1a:
                npv_color = "normal" if npv > 0 else "inverse"
                st.metric("💰 VPL (15 anos)", f"${npv:,.0f}", delta_color=npv_color)
            with col2a:
                st.metric("📊 TIR", f"{irr:.1%}")
            with col3a:
                payback_color = "inverse" if payback_period > 5 else "normal"
                st.metric("⏱️ Payback", f"{payback_period:.1f} anos", delta_color=payback_color)
            with col4a:
                # ROI descontado: soma dos fluxos descontados em 10 anos / investimento
                npv_10y = sum(total_annual_benefits / (1 + discount_rate)**i for i in range(1, 11))
                roi = (npv_10y - investment_cost) / investment_cost * 100 if investment_cost > 0 else 0
                st.metric("📈 ROI (10 anos)", f"{roi:.1f}%")
            
            # Breakdown detalhado dos benefícios
            all_categories = [
                'Receita Adicional Óleo',
                'Receita Gás Natural',
                'Outras Receitas',
                'Economia Energia',
                'Economia Químicos',
                'Economia Manutenção',
                'Economia Tratamento Água'
            ]
            all_values = [
                revenue_increase,
                annual_gas_revenue,
                other_revenue,
                annual_energy_savings,
                annual_chemical_savings,
                annual_maintenance_savings,
                annual_water_savings
            ]
            all_colors = ['#FF6B6B', '#4ECDC4', '#A8E6CF', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']

            # Filtrar categorias com valor zero para não poluir o gráfico
            benefits_cats = [c for c, v in zip(all_categories, all_values) if v > 0]
            benefits_vals = [v for v in all_values if v > 0]
            benefits_colors = [c for c, v in zip(all_colors, all_values) if v > 0]

            total_benefits = sum(benefits_vals)

            # Gráfico de pizza
            fig_benefits = go.Figure(data=[go.Pie(
                labels=benefits_cats,
                values=benefits_vals,
                hole=0.4,
                textinfo='label+percent',
                textfont_size=10,
                marker=dict(
                    colors=benefits_colors,
                    line=dict(color='white', width=2)
                ),
                hovertemplate="<b>%{label}</b><br>Valor: $%{value:,.0f}<br>Percentual: %{percent}<extra></extra>"
            )])
            
            fig_benefits.update_layout(
                title="🥧 Distribuição dos Benefícios Anuais",
                template="plotly_white",
                height=400,
                showlegend=True,
                legend=dict(
                    orientation="v",
                    yanchor="middle",
                    y=0.5,
                    xanchor="left",
                    x=1.05
                ),
                annotations=[dict(text=f'Total<br>${total_benefits:,.0f}', x=0.5, y=0.5, font_size=12, showarrow=False)]
            )
            st.plotly_chart(fig_benefits, use_container_width=True)
        
        with col2:
            # Fluxo de caixa acumulado - MELHORADO
            years_range = list(range(years + 1))
            cumulative_cf = [0]
            running_total = -investment_cost
            annual_cf = [running_total]
            
            for year in range(1, years + 1):
                running_total += total_annual_benefits
                cumulative_cf.append(running_total)
                annual_cf.append(total_annual_benefits)
            
            fig_cf = make_subplots(
                rows=2, cols=1,
                subplot_titles=('Fluxo de Caixa Acumulado', 'Fluxo de Caixa Anual'),
                vertical_spacing=0.12
            )
            
            # Fluxo acumulado
            fig_cf.add_trace(go.Scatter(
                x=years_range,
                y=cumulative_cf,
                mode='lines+markers',
                name='💰 Fluxo Acumulado',
                line=dict(width=3, color='#2E8B57'),
                marker=dict(size=6),
                fill='tonexty',
                fillcolor='rgba(46, 139, 87, 0.2)',
                hovertemplate="<b>Ano:</b> %{x}<br><b>Valor Acumulado:</b> $%{y:,.0f}<extra></extra>"
            ), row=1, col=1)
            
            # Fluxo anual
            colors = ['red' if cf < 0 else 'green' for cf in annual_cf]
            fig_cf.add_trace(go.Bar(
                x=years_range,
                y=annual_cf,
                name='📊 Fluxo Anual',
                marker=dict(color=colors, opacity=0.7),
                hovertemplate="<b>Ano:</b> %{x}<br><b>Fluxo:</b> $%{y:,.0f}<extra></extra>"
            ), row=2, col=1)
            
            # Linha de break-even
            fig_cf.add_hline(y=0, line_dash="dash", line_color="red",
                           annotation_text="Break-even", row=1, col=1)
            
            # Marcar payback
            if payback_period < years:
                fig_cf.add_vline(x=payback_period, line_dash="dot", line_color="blue",
                               annotation_text=f"Payback: {payback_period:.1f} anos", row=1, col=1)
            
            fig_cf.update_layout(
                title=f"💹 Análise de Fluxo de Caixa ({years} anos)",
                template="plotly_white",
                height=500,
                showlegend=True,
                legend=dict(
                    orientation="h",
                    yanchor="bottom",
                    y=1.02,
                    xanchor="right",
                    x=1
                )
            )
            
            fig_cf.update_xaxes(title_text="Anos", row=2, col=1)
            fig_cf.update_yaxes(title_text="Valor Acumulado (USD)", row=1, col=1)
            fig_cf.update_yaxes(title_text="Fluxo Anual (USD)", row=2, col=1)
            
            st.plotly_chart(fig_cf, use_container_width=True)
        
        # Análise de sensibilidade
        st.markdown("#### 📈 Análise de Sensibilidade")
        st.caption("Varia cada componente em ±20% e mostra o impacto no VPL.")

        col1, col2 = st.columns(2)

        with col1:
            st.markdown("##### 🌪️ Diagrama Tornado - Sensibilidade do VPL")

            # Componentes do benefício para análise de sensibilidade
            sensitivity_items = {
                'Receita Óleo': revenue_increase,
                'Receita Gás': annual_gas_revenue,
                'Economia Energia': annual_energy_savings,
                'Economia Químicos': annual_chemical_savings,
                'Economia Manutenção': annual_maintenance_savings,
                'Economia Água': annual_water_savings,
                'Investimento': investment_cost,
                'Taxa Desconto': discount_rate,
            }

            tornado_data = []
            variations_pct = [-20, -10, 0, 10, 20]

            for var_name, base_value in sensitivity_items.items():
                npv_variations = []
                for var_pct in variations_pct:
                    if var_name == 'Taxa Desconto':
                        temp_rate = base_value + var_pct / 100  # variação absoluta em pontos percentuais / 10
                        temp_rate = max(0.01, base_value * (1 + var_pct / 100))
                        temp_cf = [-investment_cost] + [total_annual_benefits for _ in range(years)]
                        temp_npv = sum(cf / (1 + temp_rate)**i for i, cf in enumerate(temp_cf))
                    elif var_name == 'Investimento':
                        temp_inv = base_value * (1 + var_pct / 100)
                        temp_cf = [-temp_inv] + [total_annual_benefits for _ in range(years)]
                        temp_npv = sum(cf / (1 + discount_rate)**i for i, cf in enumerate(temp_cf))
                    else:
                        # Variar este componente do benefício
                        delta = base_value * (var_pct / 100)
                        temp_benefits = total_annual_benefits + delta
                        temp_cf = [-investment_cost] + [temp_benefits for _ in range(years)]
                        temp_npv = sum(cf / (1 + discount_rate)**i for i, cf in enumerate(temp_cf))

                    npv_variations.append(temp_npv)

                tornado_data.append({
                    'variable': var_name,
                    'low': min(npv_variations),
                    'high': max(npv_variations),
                    'range': max(npv_variations) - min(npv_variations)
                })

            # Ordenar por impacto
            tornado_data.sort(key=lambda x: x['range'], reverse=True)

            fig_tornado = go.Figure()

            for data in tornado_data:
                fig_tornado.add_trace(go.Bar(
                    y=[data['variable']],
                    x=[data['low'] - npv],
                    orientation='h',
                    marker=dict(color='#e74c3c', opacity=0.7),
                    showlegend=False,
                    hovertemplate=f"<b>{data['variable']}</b><br>VPL (-20%): ${data['low']:,.0f}<extra></extra>"
                ))
                fig_tornado.add_trace(go.Bar(
                    y=[data['variable']],
                    x=[data['high'] - npv],
                    orientation='h',
                    marker=dict(color='#2ecc71', opacity=0.7),
                    showlegend=False,
                    hovertemplate=f"<b>{data['variable']}</b><br>VPL (+20%): ${data['high']:,.0f}<extra></extra>"
                ))

            fig_tornado.add_vline(x=0, line_dash="dash", line_color="black", line_width=2,
                                 annotation_text=f"VPL Base: ${npv:,.0f}")

            fig_tornado.update_layout(
                title="Sensibilidade do VPL (variação ±20%)",
                xaxis_title="Variação do VPL (USD)",
                template="plotly_white",
                height=400,
                barmode='relative'
            )

            st.plotly_chart(fig_tornado, use_container_width=True)

        with col2:
            # Análise de cenários com multiplicadores sobre os inputs manuais
            st.markdown("##### 🎭 Análise de Cenários")
            st.caption("Cenários aplicam multiplicadores sobre os valores informados.")

            scenarios = {
                '🟢 Otimista': {'benefit_mult': 1.20, 'invest_mult': 0.90},
                '🟡 Realista': {'benefit_mult': 1.00, 'invest_mult': 1.00},
                '🔴 Pessimista': {'benefit_mult': 0.70, 'invest_mult': 1.15},
            }

            scenario_results = []
            for scenario_name, params in scenarios.items():
                temp_benefits = total_annual_benefits * params['benefit_mult']
                temp_investment = investment_cost * params['invest_mult']
                temp_cf = [-temp_investment] + [temp_benefits for _ in range(years)]
                temp_npv = sum(cf / (1 + discount_rate)**i for i, cf in enumerate(temp_cf))
                temp_payback = temp_investment / temp_benefits if temp_benefits > 0 else float('inf')

                scenario_results.append({
                    'Cenário': scenario_name,
                    'VPL': temp_npv,
                    'Payback': temp_payback,
                    'Benefícios Anuais': temp_benefits
                })

            scenarios_df = pd.DataFrame(scenario_results)

            fig_scenarios = make_subplots(
                rows=2, cols=1,
                subplot_titles=('VPL por Cenário', 'Payback por Cenário'),
                vertical_spacing=0.15
            )

            colors_sc = ['green', 'orange', 'red']

            fig_scenarios.add_trace(go.Bar(
                x=scenarios_df['Cenário'],
                y=scenarios_df['VPL'],
                name='VPL',
                marker=dict(color=colors_sc),
                text=[f'${v:,.0f}' for v in scenarios_df['VPL']],
                textposition='outside',
                hovertemplate="<b>%{x}</b><br>VPL: $%{y:,.0f}<extra></extra>"
            ), row=1, col=1)

            payback_values = [min(p, float(years)) for p in scenarios_df['Payback']]
            fig_scenarios.add_trace(go.Bar(
                x=scenarios_df['Cenário'],
                y=payback_values,
                name='Payback',
                marker=dict(color=['darkgreen', 'darkorange', 'darkred']),
                text=[f'{v:.1f}a' if v < years else f'>{years}a' for v in scenarios_df['Payback']],
                textposition='outside',
                hovertemplate="<b>%{x}</b><br>Payback: %{text}<extra></extra>"
            ), row=2, col=1)

            fig_scenarios.update_layout(
                title="Comparação de Cenários Econômicos",
                template="plotly_white",
                height=500,
                showlegend=False
            )

            fig_scenarios.update_yaxes(title_text="VPL (USD)", row=1, col=1)
            fig_scenarios.update_yaxes(title_text="Payback (anos)", row=2, col=1)

            st.plotly_chart(fig_scenarios, use_container_width=True)

            # Tabela resumo
            st.markdown("##### 📋 Resumo dos Cenários")

            scenarios_summary = pd.DataFrame(scenario_results)
            scenarios_summary['VPL'] = scenarios_summary['VPL'].apply(lambda x: f"${x:,.0f}")
            scenarios_summary['Payback'] = scenarios_summary['Payback'].apply(
                lambda x: f"{x:.1f} anos" if x < 50 else ">50 anos")
            scenarios_summary['Benefícios Anuais'] = scenarios_summary['Benefícios Anuais'].apply(lambda x: f"${x:,.0f}")

            st.dataframe(scenarios_summary, use_container_width=True, height=150)
        
        # Análise de risco - NOVO
        st.markdown("#### ⚠️ Análise de Risco")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("##### 🎲 Simulação Monte Carlo")
            
            # Parâmetros da simulação
            n_simulations = st.slider("🔢 Número de Simulações", 100, 1000, 500)
            
            mc_uncertainty = st.slider(
                "📊 Incerteza dos Benefícios (%)", 5, 50, 20,
                help="Desvio padrão como % do valor informado. Maior = mais incerteza nos dados.")

            if st.button("🚀 Executar Simulação", type="secondary"):
                with st.spinner("Executando simulação Monte Carlo..."):
                    np.random.seed(42)

                    # Simular variação nos benefícios totais e no investimento
                    benefits_sim = np.random.normal(
                        total_annual_benefits,
                        total_annual_benefits * mc_uncertainty / 100,
                        n_simulations
                    )
                    investment_sim = np.random.normal(
                        investment_cost,
                        investment_cost * 0.10,  # 10% de incerteza no investimento
                        n_simulations
                    )

                    npv_simulation = []

                    for idx in range(n_simulations):
                        temp_cf = [-max(0, investment_sim[idx])] + [
                            benefits_sim[idx] for _ in range(years)]
                        temp_npv = sum(cf / (1 + discount_rate)**j for j, cf in enumerate(temp_cf))
                        npv_simulation.append(temp_npv)
                    
                    # Armazenar resultados
                    st.session_state.monte_carlo_results = npv_simulation
                    
                    # Estatísticas
                    npv_mean = np.mean(npv_simulation)
                    npv_std = np.std(npv_simulation)
                    prob_positive = sum(1 for x in npv_simulation if x > 0) / n_simulations
                    var_95 = np.percentile(npv_simulation, 5)  # Value at Risk 95%
                    
                    col1a, col2a = st.columns(2)
                    with col1a:
                        st.metric("📊 VPL Médio", f"${npv_mean:,.0f}")
                        st.metric("📈 Desvio Padrão", f"${npv_std:,.0f}")
                    with col2a:
                        st.metric("✅ Prob. VPL > 0", f"{prob_positive:.1%}")
                        st.metric("⚠️ VaR 95%", f"${var_95:,.0f}")
        
        with col2:
            # Visualização dos resultados Monte Carlo
            if hasattr(st.session_state, 'monte_carlo_results'):
                npv_sim = st.session_state.monte_carlo_results
                
                fig_mc = make_subplots(
                    rows=2, cols=1,
                    subplot_titles=('Distribuição do VPL', 'Percentis de Risco'),
                    vertical_spacing=0.15
                )
                
                # Histograma
                fig_mc.add_trace(go.Histogram(
                    x=npv_sim,
                    nbinsx=30,
                    name='Distribuição VPL',
                    marker=dict(color='skyblue', opacity=0.7, line=dict(color='navy', width=1)),
                    hovertemplate="<b>VPL:</b> $%{x:,.0f}<br><b>Frequência:</b> %{y}<extra></extra>"
                ), row=1, col=1)
                
                # Linha do VPL médio
                fig_mc.add_vline(x=np.mean(npv_sim), line_dash="dash", line_color="red",
                               annotation_text=f"Média: ${np.mean(npv_sim):,.0f}", row=1, col=1)
                
                # Percentis
                percentiles = [5, 10, 25, 50, 75, 90, 95]
                perc_values = [np.percentile(npv_sim, p) for p in percentiles]
                
                fig_mc.add_trace(go.Scatter(
                    x=percentiles,
                    y=perc_values,
                    mode='lines+markers',
                    name='Percentis',
                    line=dict(color='green', width=3),
                    marker=dict(size=8, color='darkgreen'),
                    hovertemplate="<b>Percentil:</b> %{x}%<br><b>VPL:</b> $%{y:,.0f}<extra></extra>"
                ), row=2, col=1)
                
                # Zona de risco
                fig_mc.add_hrect(y0=min(perc_values), y1=0, fillcolor="red", opacity=0.2,
                               annotation_text="Zona de Risco", row=2, col=1)
                
                fig_mc.update_layout(
                    title="🎲 Resultados da Simulação Monte Carlo",
                    template="plotly_white",
                    height=500,
                    showlegend=True
                )
                
                fig_mc.update_xaxes(title_text="VPL (USD)", row=1, col=1)
                fig_mc.update_xaxes(title_text="Percentil (%)", row=2, col=1)
                fig_mc.update_yaxes(title_text="Frequência", row=1, col=1)
                fig_mc.update_yaxes(title_text="VPL (USD)", row=2, col=1)
                
                st.plotly_chart(fig_mc, use_container_width=True)
            else:
                st.info("👆 Execute a simulação Monte Carlo para ver os resultados de risco")
    
    with tab7:
        advanced_calculator()
    
    # Footer com informações da tese - MELHORADO
    st.markdown("---")
    st.markdown("""
    <div style="background: linear-gradient(90deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 10px; color: white; margin-top: 20px;">
        <h3 style="color: white; text-align: center;">📚 Sistema baseado na tese:</h3>
        <h4 style="color: white; text-align: center; font-style: italic;">"Aplicação da Inteligência Artificial na Otimização da Produção de Petróleo a partir do Separador de Produção"</h4>
        
        <div style="display: flex; justify-content: space-around; margin-top: 20px;">
            <div style="text-align: center;">
                <h4 style="color: #FFE4B5;">🔬 Técnicas Implementadas</h4>
                <ul style="text-align: left; color: white;">
                    <li>🧠 Redes Neurais Artificiais (MLPRegressor)</li>
                    <li>🧬 Algoritmos Genéticos (NSGA-II)</li>
                    <li>🔧 Controle Fuzzy Adaptativo</li>
                    <li>📊 Modelagem Matemática CFD</li>
                    <li>💰 Análise Econômica Monte Carlo</li>
                    <li>📈 Otimização Multiobjetivo</li>
                </ul>
            </div>
            <div style="text-align: center;">
                <h4 style="color: #FFE4B5;">🎯 Resultados Esperados</h4>
                <ul style="text-align: left; color: white;">
                    <li>📈 Melhoria de eficiência: <strong>2-5%</strong> (tipicamente)</li>
                    <li>⚡ Redução de energia: <strong>3-8%</strong></li>
                    <li>🌍 Redução de emissões: <strong>3-10%</strong> (proporcional à energia)</li>
                    <li>💰 ROI: <strong>depende das condições operacionais</strong></li>
                    <li>🛠️ Redução manutenção: <strong>3-6%</strong></li>
                    <li>📊 Aumento produção: <strong>1-4%</strong> (via recuperação)</li>
                </ul>
            </div>
            <div style="text-align: center;">
                <h4 style="color: #FFE4B5;">🔧 Fundamentos dos Modelos</h4>
                <ul style="text-align: left; color: white;">
                    <li>🔬 Eficiência G-L: Souders-Brown + tempo de residência</li>
                    <li>💧 Eficiência O-A: Lei de Stokes + Beggs-Robinson</li>
                    <li>⚡ Energia: bombeamento + aquecimento + compressão</li>
                    <li>🧬 NSGA-II: SBX + mutação polinomial + crowding</li>
                    <li>📊 Economia: 335 dias/ano, correlações SPE</li>
                    <li>⚠️ Dados sintéticos (requer calibração com planta)</li>
                </ul>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

if __name__ == "__main__":
    main()