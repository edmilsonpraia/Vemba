"""
VPO · Vemba Process Optimizer — Separador tri-fásico horizontal paramétrico
===========================================================================
Script Blender (>= 3.0) que gera a mesma geometria do viewport Three.js
(vessel3d.js), mas com modificadores Blender reais: útil para renders
foto-realísticos, exportação .glb/.fbx e modificações artísticas.

COMO USAR
---------
Opção A · dentro do Blender:
    1. Blender → janela "Scripting"
    2. "Open" → selecionar este ficheiro
    3. Ajustar PARAMS no topo se quiser outro cenário
    4. "Run Script" (Alt+P)

Opção B · headless (linha de comando):
    blender -b -P separator_model.py
    # Depois para exportar .glb:
    blender -b -P separator_model.py -- --export out/separator.glb

PARÂMETROS
----------
Correspondem 1-para-1 aos do app (calculateSeparatorDesign). Se alterar os
sliders do app, copie os specs impressos no cabeçalho da aba Vaso 3D e cole
abaixo em PARAMS.
"""

# Nota: bpy, bmesh e mathutils são fornecidos APENAS pelo runtime Python
# embarcado no Blender. Avisos "Import could not be resolved" do pyright/pylance
# são esperados fora do Blender e podem ser ignorados — o script não corre em
# Python standalone de qualquer forma.
import bpy       # type: ignore[import-not-found]
import bmesh    # type: ignore[import-not-found]
import math
import sys
from mathutils import Vector  # type: ignore[import-not-found]

# ---------------------------------------------------------------------------
# Parâmetros (ajustar aqui — defaults = baseline operacional do app)
# ---------------------------------------------------------------------------
PARAMS = {
    "D_final": 1.52,        # m — diâmetro interno
    "L_eff":   5.33,        # m — comprimento efectivo T/T
    "t_total": 12,          # mm — espessura da parede (ASME)
    "waterCut": 42,         # % — fracção de água no líquido
    "pressure": 11.3,       # bar — operacional
    "temperature": 62,      # °C
    "liquid_fill_frac": 0.55,  # fracção do vaso ocupada por líquido (típico 50-60%)
    "is_horizontal": True,
}

# Paleta sincronizada com o viewport Three.js do app
# Água azul · Óleo preto crude · Bolhas de gás vermelho vivo
MATERIALS = {
    "shell":   {"color": (0.54, 0.60, 0.69, 0.20), "metallic": 0.9,  "roughness": 0.28, "alpha_blend": True},
    "oil":     {"color": (0.027, 0.027, 0.031, 0.98), "metallic": 0.0, "roughness": 0.35, "alpha_blend": True},   # CRUDE PRETO
    "water":   {"color": (0.145, 0.388, 0.922, 0.88), "metallic": 0.0, "roughness": 0.08, "alpha_blend": True},   # ÁGUA AZUL
    "gas_bubble": {"color": (1.0, 0.32, 0.32, 0.90), "metallic": 0.0, "roughness": 0.10, "alpha_blend": True, "emission": (0.94, 0.27, 0.27), "emission_strength": 2.5},  # BOLHA VERMELHA
    "weir":    {"color": (0.28, 0.33, 0.41, 1.0),  "metallic": 0.85, "roughness": 0.25, "alpha_blend": False},
    "nozzle":  {"color": (0.28, 0.33, 0.41, 1.0),  "metallic": 0.80, "roughness": 0.30, "alpha_blend": False},
    "mesh":    {"color": (0.66, 0.55, 0.98, 1.0),  "metallic": 0.4,  "roughness": 0.50, "alpha_blend": False},
    "saddle":  {"color": (0.20, 0.25, 0.33, 1.0),  "metallic": 0.5,  "roughness": 0.60, "alpha_blend": False},
    "flange":  {"color": (0.12, 0.16, 0.22, 1.0),  "metallic": 0.85, "roughness": 0.25, "alpha_blend": False},
    "psv":     {"color": (0.94, 0.27, 0.27, 1.0),  "metallic": 0.6,  "roughness": 0.40, "alpha_blend": False},
}


# ---------------------------------------------------------------------------
# Utilitários
# ---------------------------------------------------------------------------
def clear_scene():
    """Remove todos os meshes da cena por default (mantém câmara e luzes)."""
    for obj in list(bpy.data.objects):
        if obj.type in {"MESH", "EMPTY", "CURVE"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    for mat in list(bpy.data.materials):
        if mat.name.startswith("VPO_"):
            bpy.data.materials.remove(mat)


def make_material(name, spec):
    """Cria/obtém um material PBR Principled baseado em spec."""
    mat_name = f"VPO_{name}"
    mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return mat
    r, g, b, a = spec["color"]
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Metallic"].default_value = spec.get("metallic", 0.0)
    bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.5)
    bsdf.inputs["Alpha"].default_value = a
    # Emission (para bolhas vermelhas luminosas)
    em = spec.get("emission")
    if em is not None and "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = (em[0], em[1], em[2], 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = spec.get("emission_strength", 1.0)
    # Clearcoat para fluidos (superfície molhada brilhante)
    if name in ("oil", "water") and "Clearcoat" in bsdf.inputs:
        bsdf.inputs["Clearcoat"].default_value = 1.0 if name == "oil" else 0.6
        if "Clearcoat Roughness" in bsdf.inputs:
            bsdf.inputs["Clearcoat Roughness"].default_value = 0.05
    if spec.get("alpha_blend"):
        mat.blend_method = "BLEND"
        mat.shadow_method = "HASHED"
    else:
        mat.blend_method = "OPAQUE"
    return mat


def assign_material(obj, mat_name):
    """Atribui material a um objecto mesh."""
    spec = MATERIALS[mat_name]
    mat = make_material(mat_name, spec)
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def add_cylinder_capped(radius, depth, location, rotation=(0, 0, 0), vertices=48, name="Shell"):
    """Cilindro fechado padrão (usa primitivo Blender)."""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=vertices,
        location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.name = name
    return obj


def add_elliptical_head(radius, axial_ratio=0.5, segments=48, rings=12):
    """
    Cria um cabeçote ASME 2:1 elíptico via lathe/screw de uma curva 2D.
    axial_ratio: semi-eixo axial / raio (0.5 ⇒ cabeçote 2:1).
    Retorna o objecto mesh posicionado em (0,0,0), eixo ao longo de Z.
    """
    # Gera meia-elipse (90 graus em Z positivo)
    curve = bpy.data.curves.new("VPO_HeadProfile", type="CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("POLY")
    pts = []
    for i in range(rings + 1):
        theta = (math.pi / 2) * (i / rings)
        r = radius * math.cos(theta)
        z = (radius * axial_ratio) * math.sin(theta)
        pts.append((r, 0, z))
    spline.points.add(len(pts) - 1)
    for i, (x, y, z) in enumerate(pts):
        spline.points[i].co = (x, y, z, 1.0)

    curve_obj = bpy.data.objects.new("VPO_HeadCurve", curve)
    bpy.context.collection.objects.link(curve_obj)
    bpy.context.view_layer.objects.active = curve_obj
    curve_obj.select_set(True)

    # Converter curva em mesh e aplicar screw ao redor do eixo Z
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.object
    mesh_obj.name = "VPO_Head"

    mod = mesh_obj.modifiers.new("Screw", "SCREW")
    mod.axis = "Z"
    mod.steps = segments
    mod.render_steps = segments
    mod.use_merge_vertices = True
    bpy.ops.object.modifier_apply(modifier="Screw")
    return mesh_obj


def add_phase_mesh(radius, length, y_bot, y_top, name, mat_name):
    """
    Cria uma fase líquida (óleo ou água) como extrusão de uma secção circular
    truncada entre y_bot e y_top ao longo de X (comprimento do vaso).
    """
    if y_top - y_bot < 1e-4:
        return None
    # Construir perfil 2D (plano YZ) via bmesh
    bm = bmesh.new()
    verts_section = []

    # Helpers
    def clamp(v): return max(-1.0, min(1.0, v))
    ang_bot = math.acos(clamp(y_bot / radius))  # ângulo desde eixo +Y
    ang_top = math.acos(clamp(y_top / radius))

    steps_side = 24
    # Lado esquerdo (z negativo): topo → fundo pelo arco do shell (lado -z)
    for i in range(steps_side + 1):
        t = i / steps_side
        a = ang_top + (ang_bot - ang_top) * t
        z = -radius * math.sin(a)
        y = radius * math.cos(a)
        verts_section.append((0, y, z))
    # Arco inferior (fundo do shell, de ang_bot a -ang_bot, passando por y=-R)
    steps_bot = 32
    for i in range(1, steps_bot):
        t = i / steps_bot
        a = ang_bot + (-2 * ang_bot) * t
        z = radius * math.sin(a)
        y = radius * math.cos(a)
        if y <= y_bot + 1e-3:
            verts_section.append((0, y, z))
    # Lado direito (z positivo): fundo → topo
    for i in range(steps_side + 1):
        t = i / steps_side
        a = ang_bot + (ang_top - ang_bot) * t
        z = radius * math.sin(a)
        y = radius * math.cos(a)
        verts_section.append((0, y, z))

    # Criar perfil 2D (face plana em x=0)
    bm_verts = [bm.verts.new(v) for v in verts_section]
    try:
        bm.faces.new(bm_verts)
    except ValueError:
        pass  # pode falhar se degenerado; ignorar
    bm.verts.ensure_lookup_table()

    # Criar mesh temporário e aplicar extrude via objeto + modifier SOLIDIFY não,
    # usamos operator bmesh.ops.extrude_face_region
    extruded = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    translate_verts = [v for v in extruded["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(length, 0, 0), verts=translate_verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (-length / 2, 0, 0)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, mat_name)
    return obj


def add_nozzle(location, direction, length=0.45, diameter=0.22, mat="nozzle", with_flange=True, name="Nozzle"):
    """Cria um bocal cilíndrico com flange opcional."""
    # Orientação por rotação
    rotations = {
        "y":  (0, 0, 0),
        "-y": (math.pi, 0, 0),
        "x":  (0, math.pi/2, 0),
        "-x": (0, -math.pi/2, 0),
        "z":  (math.pi/2, 0, 0),
        "-z": (-math.pi/2, 0, 0),
    }
    rot = rotations.get(direction, (0, 0, 0))

    bpy.ops.mesh.primitive_cylinder_add(
        radius=diameter, depth=length, vertices=16, location=location, rotation=rot
    )
    noz = bpy.context.object
    noz.name = name
    assign_material(noz, mat)

    if with_flange:
        fl_loc = list(location)
        axis_map = {"y": (0, 0, 1), "-y": (0, 0, -1), "x": (1, 0, 0), "-x": (-1, 0, 0), "z": (0, 1, 0), "-z": (0, -1, 0)}
        a = axis_map.get(direction, (0, 0, 1))
        fl_loc = (location[0] + a[0] * (length/2 + 0.025),
                  location[1] + a[1] * (length/2 + 0.025),
                  location[2] + a[2] * (length/2 + 0.025))
        bpy.ops.mesh.primitive_cylinder_add(
            radius=diameter * 1.6, depth=0.05, vertices=16, location=fl_loc, rotation=rot
        )
        fl = bpy.context.object
        fl.name = name + "_Flange"
        assign_material(fl, "flange")
    return noz


def add_saddle(x_pos, radius):
    """Saddle support (base trapezoidal + alma)."""
    y = -radius - 0.15
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos, y, 0))
    saddle = bpy.context.object
    saddle.scale = (0.2, 0.3, 1.8)
    saddle.name = f"Saddle_x{x_pos:.2f}"
    assign_material(saddle, "saddle")
    return saddle


def add_weir(radius, length, x_pos=None):
    """Weir plate (placa vertical perpendicular ao eixo)."""
    if x_pos is None:
        x_pos = length / 2 * 0.30
    weir_height = 2 * radius * 0.45
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos, -radius + weir_height/2, 0))
    weir = bpy.context.object
    weir.scale = (0.04, weir_height, 2 * radius * 0.95)
    weir.name = "Weir"
    assign_material(weir, "weir")
    return weir


def add_mist_extractor(radius, x_pos, mist_y, grid_n=8):
    """Grade mist extractor (disco + grid wireframe)."""
    # Disco translúcido violeta
    bpy.ops.mesh.primitive_circle_add(
        radius=radius * 0.80, fill_type="NGON",
        location=(x_pos, mist_y, 0), rotation=(math.pi/2, 0, 0), vertices=32
    )
    disc = bpy.context.object
    disc.name = "MistExtractor_Disc"
    assign_material(disc, "mesh")

    # Linhas da grade (meshes finos)
    r_mist = radius * 0.80
    for i in range(grid_n + 1):
        u = (i / grid_n - 0.5) * 2 * r_mist
        w = math.sqrt(max(0, r_mist**2 - u**2))
        # linha em Z
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos, mist_y + 0.002, u))
        l1 = bpy.context.object
        l1.scale = (0.01, 0.005, w)
        l1.name = f"Mist_Line_Z_{i}"
        assign_material(l1, "mesh")
        # linha em X
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos + u, mist_y + 0.002, 0))
        l2 = bpy.context.object
        l2.scale = (w, 0.005, 0.01)
        l2.name = f"Mist_Line_X_{i}"
        assign_material(l2, "mesh")


def add_studio_lighting():
    """Configuração de iluminação tipo studio para render agradável."""
    # Apagar luzes existentes
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)
    # Key light
    key = bpy.data.lights.new("VPO_Key", "AREA")
    key.energy = 800
    key.size = 3
    key_obj = bpy.data.objects.new("VPO_Key", key)
    key_obj.location = (5, 6, 5)
    key_obj.rotation_euler = (math.radians(-40), math.radians(35), math.radians(10))
    bpy.context.collection.objects.link(key_obj)
    # Fill light (ciano)
    fill = bpy.data.lights.new("VPO_Fill", "AREA")
    fill.energy = 220
    fill.size = 4
    fill.color = (0.4, 0.9, 1.0)
    fill_obj = bpy.data.objects.new("VPO_Fill", fill)
    fill_obj.location = (-5, 3, -2)
    fill_obj.rotation_euler = (math.radians(-20), math.radians(-30), 0)
    bpy.context.collection.objects.link(fill_obj)
    # Ambiente (mundo)
    world = bpy.context.scene.world
    if world and world.use_nodes:
        bg = world.node_tree.nodes.get("Background")
        if bg:
            bg.inputs["Color"].default_value = (0.03, 0.05, 0.08, 1.0)
            bg.inputs["Strength"].default_value = 0.8


def add_isometric_camera(bbox_center, bbox_radius):
    """Câmara em isométrica, apontada ao centro, enquadrando o bbox."""
    for obj in list(bpy.data.objects):
        if obj.type == "CAMERA":
            bpy.data.objects.remove(obj, do_unlink=True)
    cam_data = bpy.data.cameras.new("VPO_Camera")
    cam_data.lens = 50  # 50mm equivalente
    cam = bpy.data.objects.new("VPO_Camera", cam_data)
    dist = bbox_radius * 2.8
    direction = Vector((1, 1, 0.6)).normalized()
    cam.location = Vector(bbox_center) + direction * dist
    # Apontar para o centro
    look_at = Vector(bbox_center) - cam.location
    cam.rotation_euler = look_at.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam


# ---------------------------------------------------------------------------
# Construção principal
# ---------------------------------------------------------------------------
def build_separator(params=PARAMS):
    clear_scene()

    D = params["D_final"]
    L = params["L_eff"]
    R = D / 2
    half_L = L / 2
    water_cut = params["waterCut"] / 100.0
    fill = params["liquid_fill_frac"]

    liquid_h = 2 * R * fill
    water_h = liquid_h * water_cut
    y_water_lvl = -R + water_h
    y_oil_lvl   = -R + liquid_h

    # 1. Shell cilíndrico (horizontal: eixo ao longo de X)
    shell = add_cylinder_capped(
        radius=R, depth=L, vertices=64,
        location=(0, 0, 0), rotation=(0, math.pi/2, 0), name="VPO_Shell"
    )
    # Remover faces de topo/base (vão ser substituídas pelos heads)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(shell.data)
    for face in bm.faces:
        if abs(face.normal.x) > 0.9:
            face.select = True
    bmesh.update_edit_mesh(shell.data)
    bpy.ops.mesh.delete(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    assign_material(shell, "shell")

    # 2. Cabeçotes 2:1 elípticos
    head_L = add_elliptical_head(R, axial_ratio=0.5, segments=48)
    head_L.name = "VPO_Head_L"
    head_L.location = (-half_L, 0, 0)
    head_L.rotation_euler = (0, -math.pi/2, 0)
    assign_material(head_L, "shell")

    head_R = add_elliptical_head(R, axial_ratio=0.5, segments=48)
    head_R.name = "VPO_Head_R"
    head_R.location = (half_L, 0, 0)
    head_R.rotation_euler = (0, math.pi/2, 0)
    assign_material(head_R, "shell")

    # 3. Fases fluidas (secção transversal extrudada)
    # ÁGUA azul (fundo) · ÓLEO preto crude (meio) — cores conforme app
    add_phase_mesh(R, L * 0.98, -R, y_water_lvl, "VPO_Water", "water")
    add_phase_mesh(R, L * 0.98, y_water_lvl, y_oil_lvl, "VPO_Oil", "oil")

    # 4. Weir
    if params.get("is_horizontal", True):
        add_weir(R, L, x_pos=half_L * 0.30)

    # 5. Mist extractor
    add_mist_extractor(R, x_pos=half_L * 0.55, mist_y=R * 0.70)

    # 6. Bocais
    # Inlet (lateral esquerda)
    add_nozzle((-half_L - 0.30, 0, 0), "-x", length=0.6, diameter=0.26, name="VPO_Noz_Inlet")
    # Gas outlet (topo acima do mist)
    add_nozzle((half_L * 0.55, R + 0.25, 0), "y", length=0.5, diameter=0.18, name="VPO_Noz_GasOut")
    # PSV (topo esquerdo)
    add_nozzle((-half_L * 0.65, R + 0.22, 0), "y", length=0.4, diameter=0.14, mat="psv", name="VPO_Noz_PSV")
    # Oil outlet (lateral direita)
    add_nozzle((half_L + 0.30, y_water_lvl + 0.15, 0), "x", length=0.5, diameter=0.18, name="VPO_Noz_OilOut")
    # Water outlet (fundo esquerda)
    add_nozzle((-half_L * 0.75, -R - 0.27, 0), "-y", length=0.5, diameter=0.18, name="VPO_Noz_WaterOut")

    # 7. Saddles (suportes)
    if params.get("is_horizontal", True):
        add_saddle(-half_L * 0.6, R)
        add_saddle( half_L * 0.6, R)

    # 8. Iluminação e câmara
    add_studio_lighting()
    bbox_radius = max(R * 1.5, half_L * 1.2)
    add_isometric_camera((0, 0, 0), bbox_radius)

    # Configurações de render (Eevee por omissão — rápido)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = False
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    # Eevee: activar bloom/SSR para destacar o vidro do shell
    if hasattr(scene.eevee, "use_bloom"):
        scene.eevee.use_bloom = True
    if hasattr(scene.eevee, "use_ssr"):
        scene.eevee.use_ssr = True
        scene.eevee.use_ssr_refraction = True

    print(f"[VPO] Separador construído: D={D:.2f}m · L={L:.2f}m · WC={params['waterCut']}% · "
          f"interfaces água={y_water_lvl:+.2f}m · óleo={y_oil_lvl:+.2f}m")
    return True


# ---------------------------------------------------------------------------
# CLI (opcional): exportação headless
# ---------------------------------------------------------------------------
def parse_args():
    argv = sys.argv
    if "--" not in argv:
        return {}
    extra = argv[argv.index("--") + 1:]
    args = {}
    i = 0
    while i < len(extra):
        if extra[i] == "--export" and i + 1 < len(extra):
            args["export"] = extra[i + 1]
            i += 2
        elif extra[i] == "--render" and i + 1 < len(extra):
            args["render"] = extra[i + 1]
            i += 2
        else:
            i += 1
    return args


if __name__ == "__main__":
    build_separator(PARAMS)
    args = parse_args()

    if "export" in args:
        path = args["export"]
        print(f"[VPO] Exportando GLB para {path} …")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True)
        print("[VPO] Export concluído.")

    if "render" in args:
        path = args["render"]
        print(f"[VPO] Rendering PNG para {path} …")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("[VPO] Render concluído.")
