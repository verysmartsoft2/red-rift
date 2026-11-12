# RED RIFT racer models for Blender 5.x.
# Builds the five airframes, cuts control surfaces / intakes / vents with booleans, bevels hard parts,
# bakes ambient occlusion and exports one GLB per ship (materials named rr_<role>, the game repaints them).
#
#   blender -b --factory-startup --python tools/blender/build_ships.py -- <out_dir> [render_dir|-] [ship ...]
#
# Geometry is written in game space (x = left wing, y = up, z = nose) and converted to Blender space
# (x, -z, y); the glTF exporter's +Y-up conversion turns it back into game space.
import bpy, bmesh, math, json, sys, os
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.abspath('models')
RENDER = argv[1] if len(argv) > 1 and argv[1] != '-' else None
ONLY = argv[2:]

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game -> blender
def T(x, y, z): return Matrix.Translation((x, y, z))
def R(x=0, y=0, z=0): return Euler((x, y, z), 'XYZ').to_matrix().to_4x4()
def S(x, y, z): return Matrix.Diagonal((x, y, z, 1))
V = lambda x, y, z: Vector((x, y, z))

LIVERY = {
    'kestrel': ('#2f8bff', '#e8eef8', '#ff3050', '#29f3ff'), 'mirage': ('#ff2fb0', '#1a1024', '#29f3ff', '#ff4fd8'),
    'bastion': ('#ffd400', '#2a2a30', '#ff5a00', '#ffb020'), 'arc': ('#a05cff', '#101018', '#b6ff00', '#b56bff'),
    'nomad': ('#ff8a1e', '#f2efe6', '#19beb6', '#4de9d2'),
}
def hexrgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1,)

# ---------------- materials ----------------
MAT = {}
def make_materials(key):
    MAT.clear()
    p, s, a, n = LIVERY[key]
    spec = {
        'primary': (p, 0.35, 0.25), 'secondary': (s, 0.35, 0.25), 'accent': (a, 0.35, 0.25), 'white': ('#e8eaf0', 0.2, 0.3),
        'dark': ('#1b1d23', 0.7, 0.42), 'gunmetal': ('#3c414b', 0.9, 0.3), 'metal': ('#c4cad4', 1.0, 0.16), 'inner': ('#0b0c10', 0.4, 0.75),
        'glass': ('#0a1424', 0.1, 0.03), 'neon': (n, 0, 0.5), 'core': (n, 0, 0.5),
    }
    for role, (col, met, rough) in spec.items():
        m = bpy.data.materials.new('rr_' + role)
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = hexrgb(col); b.inputs['Metallic'].default_value = met; b.inputs['Roughness'].default_value = rough
        if role in ('primary', 'secondary', 'accent', 'white'): b.inputs['Coat Weight'].default_value = 0.8
        if role in ('neon', 'core'): b.inputs['Emission Color'].default_value = hexrgb(col); b.inputs['Emission Strength'].default_value = 12 if role == 'neon' else 8
        if role == 'glass': b.inputs['Alpha'].default_value = 0.35
        MAT[role] = m

PARTS, CUTS = [], []
META = {}
def new_bm(): return bmesh.new()
def emit(bm, name, role, Mg=None, bevel=0.0, keep=False):
    if Mg is not None: bmesh.ops.transform(bm, matrix=Mg, verts=bm.verts)
    bmesh.ops.transform(bm, matrix=C, verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    me.materials.append(MAT[role])
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(35)
    if not keep: PARTS.append(ob)
    return ob
def mirror_bm(bm):
    bmesh.ops.transform(bm, matrix=S(-1, 1, 1), verts=bm.verts); bmesh.ops.reverse_faces(bm, faces=bm.faces); return bm
def merge_into(dst, src, M=None):
    if M is not None: bmesh.ops.transform(src, matrix=M, verts=src.verts)
    me = bpy.data.meshes.new('t'); src.to_mesh(me); dst.from_mesh(me); bpy.data.meshes.remove(me); src.free()

# ---------------- primitives (game space) ----------------
def box(w, h, d):
    bm = new_bm(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.transform(bm, matrix=S(w, h, d), verts=bm.verts); return bm
def cyl(r1, r2, L, seg=16, caps=True):  # along z, r1 at -z
    bm = new_bm(); bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=L); return bm
def sphere(r, u=24, v=14):
    bm = new_bm(); bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r); return bm
def disc(r, seg=24):
    bm = new_bm(); bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=True, segments=seg, radius=r); return bm
def torus(R0, r0, seg=36, sides=8):
    bm = new_bm(); rings = []
    for i in range(seg):
        a = i / seg * math.tau; ring = []
        for j in range(sides):
            b = j / sides * math.tau; rr = R0 + r0 * math.cos(b)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), r0 * math.sin(b))))
        rings.append(ring)
    for i in range(seg):
        for j in range(sides):
            a, b = rings[i][j], rings[i][(j + 1) % sides]; c, d = rings[(i + 1) % seg][(j + 1) % sides], rings[(i + 1) % seg][j]
            bm.faces.new((a, b, c, d))
    return bm
def orient(a, b):
    d = b - a; q = d.to_track_quat('Z', 'Y' if abs(d.normalized().y) < 0.98 else 'X')
    return T(*((a + b) / 2)) @ q.to_matrix().to_4x4(), d.length
def tube(name, role, a, b, r, seg=14, rb=None, bevel=0.0):
    M, L = orient(a, b); return emit(cyl(r, rb if rb is not None else r, L, seg), name, role, M, bevel)
def bar(name, role, a, b, w, h=None):
    M, L = orient(a, b); return emit(box(w, h or w, L), name, role, M)
def sweep(name, role, pts, r, sides=6):
    bm = new_bm(); rings = []; n = len(pts); prev = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev is None: nrm = (t.cross(V(0, 0, 1)) if abs(t.z) < 0.9 else t.cross(V(1, 0, 0))).normalized()
        else: nrm = (prev - t * prev.dot(t)).normalized()
        prev = nrm; bi = t.cross(nrm)
        rings.append([bm.verts.new(p + (nrm * math.cos(j / sides * math.tau) + bi * math.sin(j / sides * math.tau)) * r) for j in range(sides)])
    for i in range(n - 1):
        for j in range(sides):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return emit(bm, name, role)

def cr(a, b, c, d, t): return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
def resample(st, per):
    st = [list(s) + [0, 2.2, 1][len(s) - 3:] for s in st]
    out = []
    for i in range(len(st) - 1):
        for k in range(per):
            a, b, c, d = st[max(0, i - 1)], st[i], st[i + 1], st[min(len(st) - 1, i + 2)]
            out.append([cr(a[j], b[j], c[j], d[j], k / per) for j in range(6)])
    out.append(st[-1]); return out
# lofted body: stations [z, half width, half height, centre y, squareness, belly scale]
def hull_bm(stations, sides=40, per=7, off=(0, 0, 0)):
    st = resample(stations, per); bm = new_bm(); rings = []
    for z, w, h, y, p, bel in st:
        w = max(w, 0.004); h = max(h, 0.004); ex = 2 / max(1.2, p); ring = []
        for j in range(sides):
            a = j / sides * math.tau; c, s = math.cos(a), math.sin(a)
            ring.append(bm.verts.new((off[0] + math.copysign(abs(c) ** ex, c) * w, off[1] + y + math.copysign(abs(s) ** ex, s) * h * (bel if s < 0 else 1), off[2] + z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(sides):
            bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % sides], rings[i][(j + 1) % sides]))
    f = bm.verts.new((off[0], off[1] + st[0][3], off[2] + st[0][0])); k = bm.verts.new((off[0], off[1] + st[-1][3], off[2] + st[-1][0]))
    for j in range(sides):
        bm.faces.new((f, rings[0][j], rings[0][(j + 1) % sides]))
        bm.faces.new((k, rings[-1][(j + 1) % sides], rings[-1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, st
def hull(name, role, stations, off=(0, 0, 0), sides=40, per=7):
    bm, st = hull_bm(stations, sides, per, off); ob = emit(bm, name, role); return ob, st
def section_at(st, z): return min(st, key=lambda s: abs(s[0] - z))
# lifting surface: sections along +x { x, y, le, te, t }
def yt(x): return 5 * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
def wing_bm(sections, n=16, span_steps=4, u0=0.0, u1=1.0):
    """airfoil loft; u0/u1 keep only part of the chord (flat end faces where cut)"""
    um = lambda k: u0 + (u1 - u0) * (1 + math.cos(math.pi * k / n)) / 2  # k = 0 -> u1 (rear), k = n -> u0 (front)
    lo = n if u0 > 0 else n - 1   # keep the bottom point of a cut front
    hi = -1 if u1 < 1 else 0      # keep the bottom point of a cut rear
    prof = [(um(k), 1) for k in range(n + 1)] + [(um(k), -1) for k in range(lo, hi, -1)]
    secs = []
    for i in range(len(sections) - 1):
        a, b = sections[i], sections[i + 1]
        for k in range(span_steps):
            t = k / span_steps; secs.append({q: a.get(q, 0) * (1 - t) + b.get(q, 0) * t for q in ('x', 'y', 'le', 'te', 't')})
    secs.append({q: sections[-1].get(q, 0) for q in ('x', 'y', 'le', 'te', 't')})
    bm = new_bm(); rings = []
    for s in secs:
        ch = s['le'] - s['te']
        rings.append([bm.verts.new((s['x'], s['y'] + sg * max(yt(u), 0.0015) * s['t'] * ch, s['le'] - u * ch)) for u, sg in prof])
    Rn = len(prof)
    for i in range(len(rings) - 1):
        for j in range(Rn): bm.faces.new((rings[i][j], rings[i][(j + 1) % Rn], rings[i + 1][(j + 1) % Rn], rings[i + 1][j]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def wing_at(sections, x, u):  # (z, y) of chord fraction u at span x
    for a, b in zip(sections, sections[1:]):
        if min(a['x'], b['x']) <= x <= max(a['x'], b['x']):
            t = (x - a['x']) / ((b['x'] - a['x']) or 1)
            le = a['le'] + (b['le'] - a['le']) * t; te = a['te'] + (b['te'] - a['te']) * t; y = a.get('y', 0) + (b.get('y', 0) - a.get('y', 0)) * t
            return le - u * (le - te), y
    s = sections[-1]; return s['le'] - u * (s['le'] - s['te']), s.get('y', 0)
def slot_bm(sections, x0, x1, u=0.74, w=0.035):
    """cutter that separates a control surface between span x0..x1 behind chord fraction u"""
    cut = new_bm()
    def add(a, b):
        M, L = orient(a, b); merge_into(cut, box(w, 1.2, L + w), M)
    (z0, y0), (z1, y1) = wing_at(sections, x0, u), wing_at(sections, x1, u)
    add(V(x0, y0, z0), V(x1, y1, z1))
    for x in (x0, x1):
        zh, yh = wing_at(sections, x, u); zt, _ = wing_at(sections, x, 1.0)
        add(V(x, yh, zh), V(x, yh, zt - 0.3))
    return cut
def sec_at(sections, x):
    for a, b in zip(sections, sections[1:]):
        if min(a['x'], b['x']) <= x <= max(a['x'], b['x']):
            t = (x - a['x']) / ((b['x'] - a['x']) or 1)
            return {q: a.get(q, 0) + (b.get(q, 0) - a.get(q, 0)) * t for q in ('x', 'y', 'le', 'te', 't')}
    return dict(sections[-1])
def sub_secs(sections, xa, xb):
    return [sec_at(sections, xa)] + [s for s in sections if xa < s['x'] < xb] + [sec_at(sections, xb)]
def surface(name, role, sections, M=None, ctrl=None, sym=False):
    """wing / fin; M = game-space placement; ctrl = (x0, x1, u): a separate control surface with a hinge gap"""
    x_root, x_tip = sections[0]['x'], sections[-1]['x']
    if ctrl:
        x0, x1, u = ctrl; g = 0.05
        pieces = [(x_root, x0, 0, 1), (x0, x1, 0, u), (x1, x_tip, 0, 1), (x0 + g, x1 - g, u + 0.015, 1)]
    else:
        pieces = [(x_root, x_tip, 0, 1)]
    obs = []
    for side in ((1, -1) if sym else (1,)):
        for i, (xa, xb, ua, ub) in enumerate(pieces):
            if xb - xa < 0.05: continue
            bm = wing_bm(sub_secs(sections, xa, xb), 16, 3, ua, ub)
            if side < 0: mirror_bm(bm)
            obs.append(emit(bm, f'{name}{"_L" if side > 0 else "_R"}{i}', role, M.copy() if M is not None else None))
    return obs
def fin(name, role, sections, x, y, side=1, cant=0.0, ctrl=None):
    """vertical surface: built along +x then stood up; cant leans the tip outward"""
    return surface(name, role, sections, T(x, y, 0) @ R(z=math.pi / 2 - side * cant), ctrl)

def boolean(ob, cutter, op='DIFFERENCE'):
    m = ob.modifiers.new('cut', 'BOOLEAN'); m.object = cutter; m.operation = op; m.solver = 'EXACT'
    CUTS.append(cutter)

# ---------------- reusable assemblies ----------------
def engine(x, y, z, r, L, name='eng'):
    zb, zf = z - L / 2, z + L / 2
    hull(name + '_nac', 'dark', [[zf, r, r, 0, 2], [zf - 0.25, r * 1.1, r * 1.1, 0, 2], [zb + 0.3, r * 1.12, r * 1.12, 0, 2], [zb, r * 1.04, r * 1.04, 0, 2]], (x, y, 0), 36, 4)
    emit(torus(r * 1.03, r * 0.08, 40, 10), name + '_lip', 'metal', T(x, y, zf))
    petals, pr, pl = 16, r * 0.97, r * 0.8
    for k in range(petals):
        a = k / petals * math.tau
        Mg = T(x + math.cos(a) * pr, y + math.sin(a) * pr, zb - pl / 2 + 0.05) @ R(z=a - math.pi / 2) @ R(x=0.1)
        emit(box(r * 0.4, 0.05, pl), f'{name}_pet{k}', 'metal' if k % 2 == 0 else 'gunmetal', Mg, bevel=0.012)
    emit(torus(r * 1.06, 0.05, 40, 8), name + '_exit', 'gunmetal', T(x, y, zb - pl + 0.08))
    emit(cyl(r * 0.93, r * 0.93, r * 1.1, 32, caps=False), name + '_liner', 'inner', T(x, y, zb + 0.05))
    emit(torus(r * 0.84, 0.035, 36, 6), name + '_ab', 'neon', T(x, y, zb + 0.1))
    emit(disc(r * 0.88, 32), name + '_core', 'core', T(x, y, zb + 0.42) @ R(y=math.pi))
    emit(cyl(r * 0.26, 0.02, r * 0.75, 18), name + '_cone', 'gunmetal', T(x, y, zb + 0.05) @ R(y=math.pi))
    META['engines'].append({'turb': [x, y, zb + 0.26], 'exit': [x, y, zb - pl + 0.05], 'r': r})
def gun(x, y, z, L, r, name='gun'):
    tube(name + '_sh', 'dark', V(x, y, z - 0.25), V(x, y, z + L * 0.35), r * 1.9, 14, bevel=0.01)
    tube(name + '_b', 'gunmetal', V(x, y, z), V(x, y, z + L), r, 12)
    tube(name + '_mz', 'metal', V(x, y, z + L - 0.22), V(x, y, z + L), r * 1.55, 14, bevel=0.008)
    for k in range(3): emit(box(r * 3.2, 0.03, 0.03), f'{name}_vent{k}', 'inner', T(x, y + r * 1.5, z + L - 0.1 - k * 0.05))
    emit(disc(r * 0.7, 12), name + '_bore', 'inner', T(x, y, z + L + 0.003))
def missile(x, y, z, L, r, wing_y=None, name='msl'):
    tube(name + '_body', 'white', V(x, y, z - L / 2), V(x, y, z + L * 0.3), r, 18)
    emit(cyl(r, 0.01, L * 0.22, 18), name + '_nose', 'accent', T(x, y, z + L * 0.3 + L * 0.11))
    tube(name + '_nz', 'dark', V(x, y, z - L / 2 - 0.12), V(x, y, z - L / 2 + 0.02), r * 0.8, 14)
    tube(name + '_band', 'accent', V(x, y, z + L * 0.08), V(x, y, z + L * 0.14), r * 1.02, 18)
    for k in range(4): emit(box(0.025, r * 2.8, L * 0.16), f'{name}_fin{k}', 'dark', T(x, y, z - L / 2 + L * 0.1) @ R(z=math.pi / 4 + k * math.pi / 2), bevel=0.006)
    if wing_y is not None:
        h = wing_y - y - r; emit(box(0.09, h, L * 0.45), name + '_pyl', 'dark', T(x, y + r + h / 2, z), bevel=0.015)
def canopy(stations, bows, name='canopy'):
    ob, st = hull(name, 'glass', stations, sides=36, per=7)
    for i, z in enumerate(bows):
        _, w, h, y, _, _ = section_at(st, z)
        pts = [V(math.cos(math.pi * t / 20) * w * 1.02, y + math.sin(math.pi * t / 20) * h * 1.02, z) for t in range(21)]
        sweep(f'{name}_bow{i}', 'metal', pts, 0.035)
    for sd in (-1, 1):
        pts = [V(sd * q[1], q[3], q[0]) for q in st if q[1] > 0.05]
        if len(pts) > 2: sweep(f'{name}_sill{sd}', 'metal', pts, 0.035, 6)
    return st
def pilot(x, y, z):
    emit(sphere(0.2, 24, 16), 'helmet', 'accent', T(x, y, z))
    emit(sphere(0.205, 24, 16), 'visor', 'glass', T(x, y + 0.01, z + 0.04) @ S(0.9, 0.55, 0.9))
    emit(box(0.36, 0.55, 0.14), 'seat', 'dark', T(x, y - 0.12, z - 0.3), bevel=0.03)
    emit(box(0.5, 0.2, 0.35), 'dash', 'dark', T(x, y - 0.22, z + 0.72), bevel=0.03)
    emit(box(0.28, 0.12, 0.01), 'hud', 'neon', T(x, y - 0.02, z + 0.78) @ R(x=-0.6))
def vents(ob, y, z0, n=5, w=0.32, step=0.2):
    cut = new_bm()
    for k in range(n): merge_into(cut, box(w * 2, 0.12, 0.07), T(0, y, z0 - k * step))
    boolean(ob, emit(cut, 'vent_cut', 'dark', keep=True))
def blade(x, y, z, h=0.45):
    emit(wing_bm([{'x': 0, 'le': z + 0.25, 'te': z - 0.25, 't': 0.12}, {'x': h, 'le': z - 0.05, 'te': z - 0.3, 't': 0.1}], 8, 1), 'antenna', 'dark', T(x, y, 0) @ R(z=math.pi / 2))
def pitot(z, y=0):
    tube('pitot', 'metal', V(0, y, z - 0.3), V(0, y, z + 1.1), 0.03, 10, rb=0.012)
    tube('pitot_base', 'gunmetal', V(0, y, z - 0.1), V(0, y, z + 0.15), 0.06, 12)
def intake(x, y, z_front, z_back, w, h, role='primary', name='intake'):
    ob, _ = hull(name, role, [[z_front, w * 0.95, h * 0.95, 0, 2.6], [z_front - 0.3, w, h, 0, 2.8], [z_back + 1.4, w * 1.02, h * 1.02, 0, 2.8], [z_back, w * 0.3, h * 0.6, 0, 2.4]], (x, y, 0), 28, 4)
    cb, _ = hull_bm([[z_front + 0.5, w * 0.8, h * 0.8, 0, 2.8], [z_front - 1.2, w * 0.78, h * 0.78, 0, 2.8]], 24, 2, (x, y, 0))
    boolean(ob, emit(cb, name + '_cut', 'dark', keep=True))
    emit(disc(1, 24), name + '_duct', 'inner', T(x, y, z_front - 1.15) @ S(w * 0.8, h * 0.8, 1))
    emit(cyl(0.12, 0.01, 0.3, 14), name + '_spike', 'gunmetal', T(x, y, z_front - 1.0))
def light(p, color, kind='nav'): META['lights'].append({'p': list(p), 'color': color, 'kind': kind})
def sym_light(p, kind='nav'): light((p[0], p[1], p[2]), 0xff2030, kind); light((-p[0], p[1], p[2]), 0x20ff60, kind)

# ---------------- airframes ----------------
def kestrel():
    hull('fuselage', 'primary', [[8.9, 0, 0, 0], [8.2, 0.2, 0.14, 0], [6.8, 0.52, 0.36, 0.02, 2.4, 0.8], [4.8, 0.86, 0.6, 0.06, 2.6, 0.75], [2.6, 1.1, 0.8, 0.1, 2.8, 0.7], [0, 1.24, 0.9, 0.1, 2.8, 0.7], [-2.8, 1.24, 0.9, 0.08, 2.8, 0.72], [-5.0, 1.12, 0.92, 0.06, 2.5, 0.85], [-6.2, 1.02, 0.96, 0.04, 2.2, 0.95]])
    spine, _ = hull('spine', 'primary', [[0.8, 0.02, 0.02, 0.86], [-0.2, 0.34, 0.24, 0.86, 2.6], [-4.4, 0.24, 0.16, 0.86, 2.6], [-5.8, 0.02, 0.02, 0.84]], sides=28, per=5)
    vents(spine, 1.1, -0.9)
    canopy([[4.9, 0, 0, 0.8], [4.2, 0.36, 0.3, 0.82], [3.0, 0.54, 0.46, 0.85], [1.6, 0.52, 0.44, 0.86], [0.5, 0.3, 0.28, 0.86], [-0.1, 0.02, 0.02, 0.85]], [3.7, 2.0])
    pilot(0, 1.02, 2.4)
    W = [{'x': 0.9, 'y': 0, 'le': 2.9, 'te': -4.5, 't': 0.07}, {'x': 4.0, 'y': 0.07, 'le': -0.6, 'te': -4.6, 't': 0.06}, {'x': 7.2, 'y': 0.15, 'le': -3.5, 'te': -4.75, 't': 0.05}]
    surface('wing', 'secondary', W, ctrl=(3.4, 6.7, 0.76), sym=True)
    for sd in (1, -1):
        hull(f'tiprail{sd}', 'accent', [[-2.8, 0.02, 0.02], [-3.2, 0.13, 0.13], [-4.9, 0.14, 0.14], [-5.4, 0.03, 0.03]], (sd * 7.3, 0.15, 0), 20, 4)
        intake(sd * 1.05, -0.05, 3.3, -1.8, 0.36, 0.46, name=f'intake{sd}')
        bar(f'le_neon{sd}', 'neon', V(sd * 1.0, 0.13, 2.85), V(sd * 7.1, 0.2, -3.42), 0.05)
        gun(sd * 1.5, 0.02, 2.0, 1.6, 0.07, f'gun{sd}')
        missile(sd * 3.8, -0.34, -1.6, 2.0, 0.14, -0.02, f'msl{sd}')
        fin(f'ventral{sd}', 'accent', [{'x': 0, 'le': -3.5, 'te': -5.6, 't': 0.06}, {'x': 0.9, 'le': -4.6, 'te': -5.8, 't': 0.05}], sd * 0.65, -0.5, sd, math.pi - 0.5)
    surface('canard', 'accent', [{'x': 0.7, 'y': 0.18, 'le': 5.8, 'te': 4.0, 't': 0.08}, {'x': 2.7, 'y': 0.3, 'le': 4.6, 'te': 4.0, 't': 0.06}], sym=True)
    fin('fin', 'accent', [{'x': 0, 'le': -1.9, 'te': -6.3, 't': 0.08}, {'x': 2.9, 'le': -5.2, 'te': -6.55, 't': 0.05}], 0, 0.85, ctrl=(0.5, 2.5, 0.72))
    engine(0, 0.05, -6.6, 0.84, 2.4)
    pitot(8.7); blade(0, 1.08, -3.2); blade(0, -0.62, 1.5, -0.35)
    bar('spine_neon', 'neon', V(0, 1.11, -0.6), V(0, 1.03, -4.6), 0.07)
    sym_light((7.33, 0.3, -3.1)); light((0, 3.78, -6.2), 0xffffff, 'strobe'); light((0, -0.72, -1.0), 0xff2030, 'beacon')
    META['decals'] = [{'p': [0.26, 2.05, -5.25], 'ry': math.pi / 2}, {'p': [-0.26, 2.05, -5.25], 'ry': -math.pi / 2}]
    META.update(stripe=[0.14, 0.3, 0.5], band=[5.4, 5.9])

def mirage():
    hull('fuselage', 'primary', [[6.8, 0, 0, 0], [6.1, 0.2, 0.14, 0], [4.8, 0.55, 0.38, 0.02, 2.4, 0.8], [2.6, 0.95, 0.68, 0.06, 2.6, 0.75], [0, 1.2, 0.82, 0.06, 2.8, 0.75], [-2.4, 1.15, 0.78, 0.04, 2.6, 0.8], [-3.9, 0.75, 0.58, 0.02, 2.3, 0.9]])
    spine, _ = hull('spine', 'primary', [[0.6, 0.02, 0.02, 0.8], [-0.2, 0.3, 0.2, 0.8, 2.6], [-2.8, 0.22, 0.14, 0.8, 2.6], [-3.6, 0.02, 0.02, 0.78]], sides=24, per=5)
    vents(spine, 0.98, -0.6, 4, 0.26)
    canopy([[4.5, 0, 0, 0.72], [3.9, 0.38, 0.32, 0.74], [2.7, 0.58, 0.46, 0.78], [1.3, 0.52, 0.42, 0.8], [0.2, 0.02, 0.02, 0.78]], [3.4, 1.8])
    pilot(0, 0.95, 2.1)
    W = [{'x': 0.9, 'y': 0.02, 'le': 2.7, 'te': -3.4, 't': 0.07}, {'x': 3.2, 'y': 0.06, 'le': 1.8, 'te': -2.2, 't': 0.065}, {'x': 5.8, 'y': 0.12, 'le': 0.5, 'te': -2.2, 't': 0.06}, {'x': 8.3, 'y': 0.2, 'le': -0.9, 'te': -2.6, 't': 0.055}]
    surface('wing', 'secondary', W, ctrl=(4.6, 7.6, 0.74), sym=True)
    for sd in (1, -1):
        hull(f'pod{sd}', 'accent', [[1.7, 0.02, 0.02], [1.1, 0.4, 0.4, 0, 2.2], [0.2, 0.6, 0.6, 0, 2.3], [-2.4, 0.64, 0.64, 0, 2.3], [-3.2, 0.58, 0.58, 0, 2.3]], (sd * 8.7, 0.2, 0), 36, 5)
        engine(sd * 8.7, 0.2, -3.9, 0.52, 1.4, f'eng{sd}')
        fin(f'podfin{sd}', 'primary', [{'x': 0, 'le': -0.9, 'te': -3.0, 't': 0.07}, {'x': 1.5, 'le': -2.3, 'te': -3.3, 't': 0.05}], sd * 8.7, 0.7, sd, 0.12, ctrl=(0.3, 1.3, 0.7))
        fin(f'podkeel{sd}', 'primary', [{'x': 0, 'le': -1.6, 'te': -3.0, 't': 0.07}, {'x': 0.7, 'le': -2.4, 'te': -3.1, 't': 0.05}], sd * 8.7, -0.3, sd, math.pi - 0.15)
        gun(sd * 9.25, 0.05, 0.2, 1.4, 0.06, f'gun{sd}')
        missile(sd * 4.6, -0.3, -0.5, 1.8, 0.13, 0.05, f'msl{sd}')
        le = [V(sd * 0.9, 0.12, 2.7), V(sd * 3.2, 0.16, 1.8), V(sd * 5.8, 0.22, 0.5), V(sd * 8.2, 0.3, -0.85)]
        for k in range(3): bar(f'le{sd}{k}', 'neon', le[k], le[k + 1], 0.05)
        bar(f'podneon{sd}', 'neon', V(sd * 8.7, 0.85, 1.0), V(sd * 8.7, 0.86, -2.6), 0.05)
        intake(sd * 1.1, -0.18, 1.2, -2.6, 0.22, 0.3, name=f'intake{sd}')
    engine(0, 0.04, -4.3, 0.56, 1.2)
    pitot(6.6); blade(0, 0.96, -2.4, 0.4)
    bar('spine_neon', 'neon', V(0, 1.0, -0.2), V(0, 0.95, -3.0), 0.06)
    sym_light((9.36, 0.2, -0.6)); light((0, 0.95, -3.6), 0xffffff, 'strobe'); light((0, -0.58, 0.5), 0xff2030, 'beacon')
    META['decals'] = [{'p': [8.92, 1.45, -2.45], 'ry': math.pi / 2}, {'p': [-8.92, 1.45, -2.45], 'ry': -math.pi / 2}]
    META.update(stripe=[0.12, 0.26, 0.45], band=[6.6, 7.1])

def bastion():
    body, _ = hull('fuselage', 'primary', [[6.8, 0.1, 0.1, 0.05], [5.8, 0.7, 0.5, 0.05, 3, 0.7], [3.8, 1.35, 0.95, 0.12, 3.2, 0.7], [1, 1.7, 1.25, 0.14, 3.4, 0.7], [-1.8, 1.72, 1.28, 0.12, 3.4, 0.72], [-3.6, 1.3, 1.0, 0.06, 3, 0.8], [-4.2, 0.6, 0.6, 0.04, 2.6, 0.9]])
    vents(body, 1.45, -0.4, 6, 0.6, 0.22)
    canopy([[4.7, 0, 0, 1.15], [4.1, 0.5, 0.32, 1.18], [2.9, 0.8, 0.5, 1.22], [1.5, 0.78, 0.48, 1.24], [0.3, 0.05, 0.05, 1.22]], [3.6, 2.2, 1.0])
    pilot(0, 1.42, 2.3)
    W = [{'x': 1.4, 'y': 0.25, 'le': 1.6, 'te': -2.3, 't': 0.12}, {'x': 8.4, 'y': 0.32, 'le': 0.9, 'te': -2.0, 't': 0.1}]
    surface('wing', 'secondary', W, ctrl=(5.6, 8.0, 0.72), sym=True)
    for sd in (1, -1):
        hull(f'boom{sd}', 'primary', [[3.8, 0.05, 0.05], [3.0, 0.8, 0.8, 0, 2.6], [1.5, 1.02, 1.02, 0, 2.6], [-5.2, 1.04, 1.04, 0, 2.6], [-7.0, 0.95, 0.95, 0, 2.6]], (sd * 4.6, 0.25, 0), 40, 5)
        engine(sd * 4.6, 0.25, -7.8, 0.92, 1.6, f'eng{sd}')
        fin(f'fin{sd}', 'accent', [{'x': 0, 'le': -4.0, 'te': -6.9, 't': 0.08}, {'x': 2.9, 'le': -5.9, 'te': -7.3, 't': 0.06}], sd * 4.6, 0.95, sd, 0, ctrl=(0.4, 2.0, 0.72))
        emit(box(0.22, 1.1, 3.3), f'tipplate{sd}', 'accent', T(sd * 8.48, 0.32, -0.55), bevel=0.05)
        emit(box(0.26, 0.95, 3.8), f'armor{sd}', 'accent', T(sd * 5.72, 0.3, 0.4), bevel=0.06)
        emit(box(0.1, 0.5, 2.6), f'armor_in{sd}', 'dark', T(sd * 5.88, 0.3, 0.4), bevel=0.02)
        for k in range(4):
            by, bz = 0.3 + (0.32 if k % 2 else -0.32), 0.4 + (1.6 if k < 2 else -1.6)
            tube(f'bolt{sd}{k}', 'metal', V(sd * 5.84, by, bz), V(sd * 5.9, by, bz), 0.05, 8)
        emit(box(0.95, 0.75, 2.4), f'pod{sd}', 'dark', T(sd * 6.6, -0.2, -0.3), bevel=0.06)
        emit(box(0.97, 0.12, 2.42), f'podband{sd}', 'accent', T(sd * 6.6, 0.05, -0.3), bevel=0.02)
        for k in range(4):
            px, py = sd * 6.6 + (0.22 if k % 2 else -0.22), -0.2 + (0.18 if k < 2 else -0.18)
            emit(disc(0.14, 16), f'podtube{sd}{k}', 'inner', T(px, py, 0.905)); emit(cyl(0.11, 0.01, 0.3, 14), f'podwarhead{sd}{k}', 'white', T(px, py, 0.95))
        emit(box(0.12, 0.3, 1.4), f'podpylon{sd}', 'dark', T(sd * 6.6, 0.25, -0.3), bevel=0.02)
        gun(sd * 1.45, -0.25, 3.4, 1.8, 0.09, f'gun{sd}')
        bar(f'tipneon{sd}', 'neon', V(sd * 8.6, 0.3, 0.7), V(sd * 8.6, 0.3, -1.85), 0.1)
        bar(f'boomneon{sd}', 'neon', V(sd * 4.6, 1.3, 2.0), V(sd * 4.6, 1.3, -5.6), 0.07)
        intake(sd * 0.85, -0.6, 3.1, -2.2, 0.38, 0.3, 'dark', f'intake{sd}')
    surface('htail', 'secondary', [{'x': -4.7, 'le': -6.1, 'te': -7.1, 't': 0.08}, {'x': 4.7, 'le': -6.1, 'te': -7.1, 't': 0.08}], T(0, 3.0, 0))
    emit(sphere(0.45, 24, 16), 'turret', 'dark', T(0, -0.85, 4.2))
    for sd in (-1, 1): tube(f'tgun{sd}', 'gunmetal', V(sd * 0.16, -0.9, 4.4), V(sd * 0.16, -0.9, 5.9), 0.07, 12)
    pitot(6.6, 0.05); blade(0, 1.38, -2.4, 0.5)
    sym_light((8.6, 0.95, -0.4)); light((0, 3.15, -6.6), 0xffffff, 'strobe'); light((0, -0.78, -1.5), 0xff2030, 'beacon')
    META['decals'] = [{'p': [4.88, 2.45, -6.25], 'ry': math.pi / 2}, {'p': [-4.88, 2.45, -6.25], 'ry': -math.pi / 2}]
    META.update(stripe=[0.25, 0.55, 0.9], band=[6.9, 7.5])

def arc():
    for sd in (1, -1):
        hull(f'prong{sd}', 'primary', [[8.4, 0, 0, 0], [7.6, 0.18, 0.15, 0], [6.0, 0.38, 0.32, 0, 2.4], [3.0, 0.58, 0.48, 0, 2.6], [0, 0.7, 0.58, 0, 2.6], [-1.2, 0.72, 0.6, 0, 2.6]], (sd * 1.05, 0, 0), 32, 6)
        bar(f'prong_in{sd}', 'neon', V(sd * 0.5, 0.05, 7.0), V(sd * 0.38, 0.05, 1.2), 0.06)
        bar(f'prong_top{sd}', 'neon', V(sd * 1.05, 0.5, 6.2), V(sd * 1.05, 0.62, 0.4), 0.05)
    body, _ = hull('body', 'primary', [[2.2, 0.2, 0.2, 0.3], [1.2, 1.1, 0.62, 0.2, 2.6, 0.8], [-1.5, 1.6, 0.85, 0.15, 2.8, 0.75], [-4.4, 1.45, 0.8, 0.08, 2.8, 0.8], [-5.8, 1.15, 0.7, 0.04, 2.6, 0.9]])
    vents(body, 1.0, -2.8, 5, 0.4)
    canopy([[1.7, 0, 0, 0.92], [1.1, 0.4, 0.3, 0.94], [-0.1, 0.56, 0.44, 0.97], [-1.4, 0.5, 0.4, 0.99], [-2.4, 0.02, 0.02, 0.97]], [0.6, -0.9])
    pilot(0, 1.14, -0.4)
    tube('emitter', 'gunmetal', V(0, 0.05, 1.6), V(0, 0.05, 6.1), 0.22, 24)
    for i, z in enumerate((2.6, 3.4, 4.2, 5.0, 5.7)): emit(torus(0.42 - (z - 2.6) * 0.03, 0.065, 36, 10), f'coil{i}', 'metal', T(0, 0.05, z))
    for z in (3.0, 4.6): bar(f'strut{z}', 'dark', V(-0.85, 0.05, z), V(0.85, 0.05, z), 0.1)
    emit(torus(0.3, 0.03, 30, 6), 'focus', 'neon', T(0, 0.05, 6.12))
    META['emitter'] = [0, 0.05, 6.35]
    W = [{'x': 1.4, 'y': 0.05, 'le': 0.9, 'te': -3.6, 't': 0.07}, {'x': 4.5, 'y': 0.12, 'le': -1.8, 'te': -4.4, 't': 0.06}, {'x': 7.6, 'y': 0.2, 'le': -4.4, 'te': -5.3, 't': 0.05}]
    surface('wing', 'secondary', W, ctrl=(4.0, 7.0, 0.72), sym=True)
    for sd in (1, -1):
        engine(sd * 0.85, 0.1, -6.3, 0.64, 1.6, f'eng{sd}')
        fin(f'fin{sd}', 'accent', [{'x': 0, 'le': -2.6, 'te': -5.7, 't': 0.08}, {'x': 2.3, 'le': -4.7, 'te': -5.9, 't': 0.05}], sd * 1.3, 0.7, sd, 0.35, ctrl=(0.4, 1.9, 0.72))
        emit(box(0.32, 0.5, 2.6), f'capbank{sd}', 'dark', T(sd * 1.62, 0.25, -2.2), bevel=0.04)
        bar(f'capneon{sd}', 'neon', V(sd * 1.8, 0.35, -1.0), V(sd * 1.8, 0.35, -3.4), 0.05)
        bar(f'le{sd}', 'neon', V(sd * 1.5, 0.14, 0.8), V(sd * 7.5, 0.24, -4.35), 0.05)
        hull(f'tiprail{sd}', 'accent', [[-3.7, 0.02, 0.02], [-4.1, 0.12, 0.12], [-5.3, 0.13, 0.13], [-5.7, 0.03, 0.03]], (sd * 7.65, 0.2, 0), 20, 4)
        gun(sd * 3.3, 0.06, -1.2, 1.2, 0.06, f'gun{sd}')
        missile(sd * 5.2, -0.25, -3.2, 1.6, 0.12, 0.08, f'msl{sd}')
    blade(0, 0.95, -4.5, 0.4)
    sym_light((7.66, 0.36, -4.4)); light((0, 0.92, -5.4), 0xffffff, 'strobe'); light((0, -0.5, -1.5), 0xff2030, 'beacon')
    META['decals'] = [{'p': [2.05, 2.0, -5.0], 'ry': math.pi / 2 - 0.35}, {'p': [-2.05, 2.0, -5.0], 'ry': -math.pi / 2 + 0.35}]
    META.update(stripe=[0.3, 0.45, 0.6], band=[5.8, 6.2])

def nomad():
    body, _ = hull('fuselage', 'primary', [[7.8, 0, 0, 0], [7.0, 0.22, 0.16, 0], [5.6, 0.55, 0.4, 0.02, 2.4, 0.8], [3, 1.0, 0.8, 0.06, 2.6, 0.75], [-1.5, 1.12, 0.88, 0.06, 2.7, 0.75], [-4.8, 0.8, 0.68, 0.1, 2.5, 0.85], [-6.4, 0.4, 0.42, 0.16, 2.3, 0.9]])
    vents(body, 0.96, -2.6, 4, 0.32)
    canopy([[5.0, 0, 0, 0.78], [4.3, 0.38, 0.3, 0.8], [3.0, 0.56, 0.45, 0.84], [1.6, 0.52, 0.42, 0.86], [0.4, 0.02, 0.02, 0.84]], [3.8, 2.2])
    pilot(0, 1.06, 2.6)
    W = [{'x': 0.9, 'y': 0.05, 'le': 1.8, 'te': -1.8, 't': 0.08}, {'x': 6.4, 'y': 0.25, 'le': -0.5, 'te': -2.0, 't': 0.06}]
    surface('wing', 'secondary', W, ctrl=(3.6, 6.0, 0.72), sym=True)
    for sd in (1, -1):
        fin(f'winglet{sd}', 'accent', [{'x': 0, 'le': -0.6, 'te': -2.0, 't': 0.07}, {'x': 1.0, 'le': -1.4, 'te': -2.1, 't': 0.05}], sd * 6.42, 0.25, sd, 0.3)
        nac, _ = hull(f'nacelle{sd}', 'accent', [[2.4, 0.6, 0.6, 0, 2.2], [2.0, 0.72, 0.72, 0, 2.3], [1.0, 0.78, 0.78, 0, 2.3], [-3.4, 0.82, 0.82, 0, 2.3], [-4.1, 0.75, 0.75, 0, 2.3]], (sd * 2.6, -0.15, 0), 40, 5)
        cb, _ = hull_bm([[2.8, 0.6, 0.6, 0, 2.2], [1.6, 0.6, 0.6, 0, 2.2]], 32, 2, (sd * 2.6, -0.15, 0))
        boolean(nac, emit(cb, f'nac_cut{sd}', 'dark', keep=True))
        emit(torus(0.64, 0.07, 40, 10), f'naclip{sd}', 'metal', T(sd * 2.6, -0.15, 2.42))
        emit(disc(0.62, 32), f'nacback{sd}', 'inner', T(sd * 2.6, -0.15, 1.7))
        emit(cyl(0.2, 0.01, 0.45, 18), f'spinner{sd}', 'gunmetal', T(sd * 2.6, -0.15, 2.05))
        for k in range(14): emit(box(0.07, 0.42, 0.02), f'fan{sd}{k}', 'gunmetal', T(sd * 2.6, -0.15, 1.85) @ R(z=k / 14 * math.tau) @ T(0, 0.37, 0) @ R(y=0.5))
        emit(box(0.16, 0.42, 2.6), f'pylon{sd}', 'dark', T(sd * 2.6, 0.48, -0.5), bevel=0.03)
        engine(sd * 2.6, -0.15, -4.6, 0.74, 1.2, f'eng{sd}')
        fin(f'vtail{sd}', 'secondary', [{'x': 0, 'le': -3.6, 'te': -6.2, 't': 0.08}, {'x': 3.0, 'le': -5.6, 'te': -6.7, 't': 0.05}], sd * 0.3, 0.55, sd, 0.75, ctrl=(0.5, 2.6, 0.72))
        bar(f'tipneon{sd}', 'neon', V(sd * 6.4, 0.32, -0.45), V(sd * 6.7, 0.32, -1.8), 0.1)
        bar(f'nacneon{sd}', 'neon', V(sd * 2.6, 0.62, 1.5), V(sd * 2.6, 0.68, -3.4), 0.06)
        gun(sd * 0.55, -0.18, 5.0, 1.5, 0.065, f'gun{sd}')
        missile(sd * 4.3, -0.32, -0.7, 1.7, 0.13, 0.1, f'msla{sd}'); missile(sd * 5.3, -0.28, -0.9, 1.5, 0.12, 0.16, f'mslb{sd}')
    emit(sphere(1, 32, 16), 'dome', 'dark', T(0, 0.9, -1.4) @ S(0.38, 0.2, 0.65))
    emit(torus(1, 0.04, 40, 6), 'domering', 'neon', T(0, 0.93, -1.4) @ R(x=math.pi / 2) @ S(0.38, 0.65, 1))
    pitot(7.6); blade(0, -0.62, 0.5, -0.35)
    sym_light((6.5, 1.25, -1.9)); light((0, 0.62, -6.5), 0xffffff, 'strobe'); light((0, -0.65, -1.0), 0xff2030, 'beacon')
    META['decals'] = [{'p': [3.44, -0.15, -1.2], 'ry': math.pi / 2}, {'p': [-3.44, -0.15, -1.2], 'ry': -math.pi / 2}]
    META.update(stripe=[0.14, 0.28, 0.5], band=[5.0, 5.4])

DESIGNS = {'kestrel': kestrel, 'mirage': mirage, 'bastion': bastion, 'arc': arc, 'nomad': nomad}

# turbine rotor: a separate node so the game can spin it
def turbine(i, e):
    bm = new_bm(); bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.24, radius2=0.24, depth=0.1)
    for k in range(18): merge_into(bm, box(0.07, 0.62, 0.025), R(z=k / 18 * math.tau) @ T(0, 0.52, 0) @ R(y=0.55))
    r = e['r'] * 0.86; bmesh.ops.transform(bm, matrix=S(r, r, r), verts=bm.verts)
    ob = emit(bm, f'TURBINE_{i}', 'gunmetal', keep=True)
    ob.location = (C @ Vector(e['turb']).to_4d()).to_3d()
    return ob

# ---------------- pipeline ----------------
def apply_mods(ob):
    if not ob.modifiers: return
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev); ob.modifiers.clear(); old = ob.data; ob.data = me; bpy.data.meshes.remove(old)
def smooth_by_angle(ob, deg=38):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    for f in bm.faces: f.smooth = True
    for e in bm.edges: e.smooth = e.is_manifold and e.calc_face_angle(0) <= math.radians(deg)
    bm.to_mesh(ob.data); bm.free()

def setup_cycles(samples=64):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for t in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = t; prefs.refresh_devices()
            if any(d.type == t for d in prefs.devices): break
        except Exception: pass
    for d in prefs.devices: d.use = d.type != 'CPU'
    sc.cycles.device = 'GPU'; sc.cycles.samples = samples
    if not sc.world: sc.world = bpy.data.worlds.new('World')

def gltf_output_group():
    ng = bpy.data.node_groups.get('glTF Material Output')
    if ng: return ng
    ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    ng.nodes.new('NodeGroupInput'); return ng

def bake_ao(ob, key, size=1024):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.scene.objects: o.select_set(o == ob)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(f'{key}_ao', size, size, alpha=False); img.generated_color = (1, 1, 1, 1)
    grp = gltf_output_group()
    for m in ob.data.materials:
        nt = m.node_tree; n = nt.nodes.new('ShaderNodeTexImage'); n.image = img; n.name = 'AO'
        for o in nt.nodes: o.select = False
        n.select = True; nt.nodes.active = n
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = grp; g.name = 'glTF Material Output'
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(n.outputs['Color'], sep.inputs['Color']); nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    sc = bpy.context.scene; sc.world.light_settings.distance = 1.6
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    img.pack()
    return img

def build(key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_cycles(64)
    make_materials(key)
    PARTS.clear(); CUTS.clear(); META.clear(); META.update(engines=[], lights=[], decals=[], emitter=None)
    DESIGNS[key]()
    for ob in PARTS: apply_mods(ob)
    for c in CUTS: bpy.data.objects.remove(c, do_unlink=True)
    for o in bpy.context.scene.objects: o.select_set(o in PARTS)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    ship = bpy.context.view_layer.objects.active; ship.name = 'SHIP'
    smooth_by_angle(ship)
    ship.data.validate()
    bake_ao(ship, key, 1024)
    for i, e in enumerate(META['engines']): turbine(i, e)
    ship['rr'] = json.dumps(META)
    tris = sum(len(p.vertices) - 2 for p in ship.data.polygons)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_extras=True, export_yup=True,
                              export_image_format='JPEG', export_jpeg_quality=82, export_cameras=False, export_lights=False, export_materials='EXPORT')
    print(f'RR_BUILT {key} tris={tris} size={os.path.getsize(path) // 1024}KB', flush=True)
    if RENDER: render(key)

def render(key):
    sc = bpy.context.scene; setup_cycles(96); sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    w = sc.world; bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.09, 0.05, 0.12, 1); bg.inputs['Strength'].default_value = 0.6
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4.5; sun.data.color = (1, 0.82, 0.68); sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sc.collection.objects.link(sun)
    rim = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'AREA')); rim.data.energy = 2500; rim.data.size = 8; rim.data.color = (0.4, 0.7, 1); rim.location = (-14, 10, 6); sc.collection.objects.link(rim)
    rim.rotation_euler = (-rim.location).to_track_quat('-Z', 'Y').to_euler()
    floor = bpy.data.objects.new('floor', bpy.data.meshes.new('floor')); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60); bm.to_mesh(floor.data); bm.free()
    floor.location.z = -2.2; fm = bpy.data.materials.new('floor'); fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.25, 0.1, 0.07, 1); floor.data.materials.append(fm); sc.collection.objects.link(floor)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.lens = 50; sc.collection.objects.link(cam); sc.camera = cam
    for name, pos in (('front', (16, -17, 7)), ('rear', (-13, 19, 5.5))):
        cam.location = pos; cam.rotation_euler = (Vector((0, -0.5, 0.2)) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(RENDER, f'{key}_{name}.png'); bpy.ops.render.render(write_still=True)

for key in (ONLY or list(DESIGNS)):
    build(key)
