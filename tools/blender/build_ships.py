# RED RIFT racer models for Blender 5.x, built from the concept sheets in
# references/RED_RIFT_References_All/02_Aircraft_and_Liveries (three views per ship).
# Faceted hard-surface hulls (flat panels), chamfered wing plates, separate control surfaces,
# weapons, intakes, engines with nozzles and neon rings; ambient occlusion is baked and each ship
# is exported as one GLB (materials named rr_<role>; the game repaints them per livery).
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

# preview colours = livery 01 of each concept sheet: primary, secondary, accent, neon
LIVERY = {
    'kestrel': ('#d9d5cc', '#55585e', '#3a3d42', '#2ef2e0'), 'mirage': ('#8c8d91', '#46474c', '#b9babd', '#b45cff'),
    'bastion': ('#a8946a', '#3e3f40', '#e2ddd0', '#3ff0e0'), 'arc': ('#dcdcdc', '#6a6b70', '#3c3e44', '#b45cff'),
    'nomad': ('#d0612c', '#4a4a4c', '#2f3032', '#2ef2c8'),
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
        'primary': (p, 0.3, 0.5), 'secondary': (s, 0.3, 0.5), 'accent': (a, 0.3, 0.5), 'white': ('#e3e3e0', 0.2, 0.45),
        'dark': ('#1d1f24', 0.6, 0.5), 'gunmetal': ('#41464f', 0.9, 0.32), 'metal': ('#b9bec6', 1.0, 0.22), 'inner': ('#0b0c10', 0.4, 0.75),
        'glass': ('#06080d', 0.2, 0.04), 'neon': (n, 0, 0.5), 'core': (n, 0, 0.5), 'warm': ('#ffa020', 0, 0.5),
    }
    for role, (col, met, rough) in spec.items():
        m = bpy.data.materials.new('rr_' + role)
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = hexrgb(col); b.inputs['Metallic'].default_value = met; b.inputs['Roughness'].default_value = rough
        if role in ('primary', 'secondary', 'accent', 'white'): b.inputs['Coat Weight'].default_value = 0.15
        if role in ('neon', 'core', 'warm'): b.inputs['Emission Color'].default_value = hexrgb(col); b.inputs['Emission Strength'].default_value = 10
        if role == 'glass': b.inputs['Coat Weight'].default_value = 1.0
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
def both(fn):
    """call fn(side) for the left (+x) and right (-x) side"""
    for sd in (1, -1): fn(sd)

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

# smooth loft (used for nacelles): stations [z, half width, half height, centre y, squareness, belly scale]
def cr(a, b, c, d, t): return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
def resample(st, per):
    st = [list(s) + [0, 2.2, 1][len(s) - 3:] for s in st]
    out = []
    for i in range(len(st) - 1):
        for k in range(per):
            a, b, c, d = st[max(0, i - 1)], st[i], st[i + 1], st[min(len(st) - 1, i + 2)]
            out.append([cr(a[j], b[j], c[j], d[j], k / per) for j in range(6)])
    out.append(st[-1]); return out
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
    bm, st = hull_bm(stations, sides, per, off); return emit(bm, name, role), st

# ---------------- faceted hard-surface helpers ----------------
def sec8(w, h, y=0.0, tw=0.5, bw=0.6, m=0.2):
    """chined octagon: (x, y) points counter-clockwise from the right side"""
    w = max(w, 0.003); h = max(h, 0.003)
    return [(w, y + m * h), (tw * w, y + h), (-tw * w, y + h), (-w, y + m * h), (-w, y - m * h), (-bw * w, y - h), (bw * w, y - h), (w, y - m * h)]
def prism_bm(stations, off=(0, 0, 0), shape=None, caps=(True, True)):
    """faceted loft: stations (z, w, h, y=0, tw=.5, bw=.6, m=.2), straight segments between them"""
    bm = new_bm(); rings = []
    for st in stations:
        z, rest = st[0], st[1:]
        pts = (shape or sec8)(*rest)
        rings.append([bm.verts.new((off[0] + x, off[1] + y, off[2] + z)) for x, y in pts])
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for j in range(n):
            bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % n], rings[i][(j + 1) % n]))
    if caps[0]: bm.faces.new(rings[0])
    if caps[1]: bm.faces.new(rings[-1][::-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def prism(name, role, stations, off=(0, 0, 0), M=None, shape=None, bevel=0.0, caps=(True, True)):
    return emit(prism_bm(stations, off, shape, caps), name, role, M, bevel)
def oct_shape(w, h, y=0.0):
    return sec8(w, h, y, 0.42, 0.42, 0.42)
def offset_poly(pts, d):
    n = len(pts); area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)) / 2
    s = 1 if area > 0 else -1; out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1 = (p1 - p0).normalized(); e2 = (p2 - p1).normalized()
        n1 = Vector((-e1.y, e1.x)) * s; n2 = Vector((-e2.y, e2.x)) * s
        b = n1 + n2
        if b.length < 1e-6: b = n1
        b.normalize(); c = max(b.dot(n1), 0.35)
        out.append(p1 + b * (d / c))
    return out
def plate_bm(outline, t=0.2, ch=0.06):
    """chamfered plate from an (x, z) outline, thickness along y"""
    inner = offset_poly(outline, ch); bm = new_bm()
    top = [bm.verts.new((p[0], t / 2, p[1])) for p in inner]
    mid = [bm.verts.new((p[0], 0, p[1])) for p in outline]
    bot = [bm.verts.new((p[0], -t / 2, p[1])) for p in inner]
    n = len(outline)
    for j in range(n):
        k = (j + 1) % n
        bm.faces.new((top[j], top[k], mid[k], mid[j])); bm.faces.new((mid[j], mid[k], bot[k], bot[j]))
    bm.faces.new(top); bm.faces.new(bot[::-1])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], ngon_method='BEAUTY')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def plate(name, role, outline, t=0.2, ch=0.06, M=None, sym=True, dih=0.0):
    for sd in ((1, -1) if sym else (1,)):
        bm = plate_bm(outline, t, ch)
        if dih: bmesh.ops.transform(bm, matrix=R(z=dih), verts=bm.verts)
        if sd < 0: mirror_bm(bm)
        emit(bm, f'{name}{sd}', role, M.copy() if M is not None else None)
def fin_plate(name, role, outline, x, y, side=1, cant=0.0, t=0.16, ch=0.05):
    """vertical plate: outline in (height, z); cant leans the top outward"""
    bm = plate_bm(outline, t, ch)
    emit(bm, name, role, T(side * x, y, 0) @ R(z=math.pi / 2 - side * cant))
def crescent(a, b, bulge, width, n=12):
    """curved blade outline in (h, z) from a to b, bowing by `bulge` toward up/forward"""
    a, b = Vector(a), Vector(b); d = b - a; nrm = Vector((d.y, -d.x)).normalized()
    if nrm.x < 0: nrm = -nrm
    outer = [a + d * (k / n) + nrm * (bulge * math.sin(math.pi * k / n)) for k in range(n + 1)]
    inner = [a + d * (k / n) + nrm * (bulge * math.sin(math.pi * k / n) - width * math.sin(math.pi * k / n) - 0.06) for k in range(n - 1, 0, -1)]
    return [(p.x, p.y) for p in outer + inner]
def quat(M):
    q = M.to_quaternion(); return [q.x, q.y, q.z, q.w]
def decal(p, Mrot, s=1.2):
    META['decals'].append({'p': list(p), 'q': quat(Mrot), 's': s})
def decal_up(x, y, z, s=1.2): decal((x, y, z), R(x=-math.pi / 2) @ R(z=math.pi if x < 0 else 0), s)
def decal_side(x, y, z, side, cant=0.0, s=1.0): decal((x, y, z), R(z=-side * cant) @ R(y=side * math.pi / 2), s)

# ---------------- assemblies ----------------
def engine(x, y, z, r, L, name='eng', ring=True):
    zb, zf = z - L / 2, z + L / 2
    prism(name + '_nac', 'dark', [(zf, r * 0.95, r * 0.95), (zf - 0.2, r * 1.1, r * 1.1), (zb + 0.35, r * 1.12, r * 1.12), (zb, r * 1.04, r * 1.04)], (x, y, 0), shape=lambda w, h: [(math.cos(a) * w, math.sin(a) * h) for a in [k / 12 * math.tau for k in range(12)]], caps=(True, False))
    if ring: emit(cyl(r * 1.15, r * 1.15, 0.16, 24, caps=False), name + '_ring', 'neon', T(x, y, zb + 0.12))
    petals, pr, pl = 14, r * 0.97, r * 0.65
    for k in range(petals):
        a = k / petals * math.tau
        Mg = T(x + math.cos(a) * pr, y + math.sin(a) * pr, zb - pl / 2 + 0.05) @ R(z=a - math.pi / 2) @ R(x=-0.12)
        emit(box(r * 0.44, 0.05, pl), f'{name}_pet{k}', 'gunmetal' if k % 2 else 'dark', Mg, bevel=0.01)
    emit(torus(r * 0.98, 0.045, 36, 6), name + '_exit', 'gunmetal', T(x, y, zb - pl + 0.1))
    emit(cyl(r * 0.93, r * 0.93, r * 1.1, 28, caps=False), name + '_liner', 'inner', T(x, y, zb + 0.05))
    emit(torus(r * 0.82, 0.035, 32, 6), name + '_ab', 'neon', T(x, y, zb + 0.1))
    emit(disc(r * 0.88, 28), name + '_core', 'core', T(x, y, zb + 0.42) @ R(y=math.pi))
    emit(cyl(r * 0.26, 0.02, r * 0.7, 16), name + '_cone', 'gunmetal', T(x, y, zb + 0.05) @ R(y=math.pi))
    META['engines'].append({'turb': [x, y, zb + 0.26], 'exit': [x, y, zb - pl + 0.05], 'r': r})
def missile(x, y, z, L, r, name='msl'):
    tube(name + '_body', 'white', V(x, y, z - L / 2), V(x, y, z + L * 0.3), r, 14)
    emit(cyl(r, 0.012, L * 0.2, 14), name + '_nose', 'gunmetal', T(x, y, z + L * 0.3 + L * 0.1))
    tube(name + '_band', 'warm', V(x, y, z + L * 0.22), V(x, y, z + L * 0.26), r * 1.03, 14)
    tube(name + '_nz', 'dark', V(x, y, z - L / 2 - 0.1), V(x, y, z - L / 2 + 0.02), r * 0.8, 12)
    for k in range(4): emit(box(0.022, r * 2.6, L * 0.14), f'{name}_fin{k}', 'dark', T(x, y, z - L / 2 + L * 0.09) @ R(z=math.pi / 4 + k * math.pi / 2))
def rack(x, y, z, n, L, r, dx, name='rack', top=None):
    """n missiles side by side under a launcher beam; top = y of the wing underside for the pylon"""
    for k in range(n): missile(x + (k - (n - 1) / 2) * dx, y, z, L, r, f'{name}_m{k}')
    emit(box(dx * n + 0.08, 0.1, L * 0.55), name + '_beam', 'dark', T(x, y + r + 0.05, z + 0.1), bevel=0.02)
    if top is not None:
        h = top - (y + r + 0.1); emit(box(0.1, max(h, 0.05), L * 0.4), name + '_pyl', 'dark', T(x, y + r + 0.1 + h / 2, z + 0.1), bevel=0.015)
def gun(x, y, z, L, r, name='gun', barrels=1):
    tube(name + '_sh', 'dark', V(x, y, z - 0.25), V(x, y, z + L * 0.35), r * 2.2, 10, bevel=0.01)
    for b in range(barrels):
        ox = (b - (barrels - 1) / 2) * r * 2.4
        tube(f'{name}_b{b}', 'gunmetal', V(x + ox, y, z), V(x + ox, y, z + L), r, 10)
        tube(f'{name}_mz{b}', 'metal', V(x + ox, y, z + L - 0.18), V(x + ox, y, z + L), r * 1.45, 10)
def gatling(x, y, z, L, r, name='gat'):
    for k in range(3):
        a = k / 3 * math.tau + math.pi / 2; ox, oy = math.cos(a) * r * 1.25, math.sin(a) * r * 1.25
        tube(f'{name}_b{k}', 'gunmetal', V(x + ox, y + oy, z), V(x + ox, y + oy, z + L), r * 0.5, 12)
        emit(torus(r * 0.5, r * 0.12, 16, 6), f'{name}_glow{k}', 'neon', T(x + ox, y + oy, z + L))
    for zz in (z + L * 0.35, z + L * 0.8): emit(torus(r * 1.6, r * 0.22, 24, 6), f'{name}_clamp{zz}', 'gunmetal', T(x, y, zz))
    tube(name + '_hub', 'dark', V(x, y, z - 0.1), V(x, y, z + L * 0.95), r * 0.55, 10)
def grille(x, y, z, w, h, n, role, axis='x', name='grille', depth=0.06):
    """n slats across a dark recess facing +z (axis='x' horizontal slats) or +x (axis='z')"""
    for k in range(n):
        t = (k + 0.5) / n - 0.5
        if axis == 'x': emit(box(w, h / n * 0.45, depth), f'{name}{k}', role, T(x, y + t * h, z))
        else: emit(box(depth, h, w / n * 0.45), f'{name}{k}', role, T(x, y, z + t * w))
def canopy(stations, bars=(), name='canopy', tw=0.45, tall=1.55, seat=True):
    """faceted glass canopy; heights are scaled by `tall` so the glass stands proud like on the sheets"""
    st = [(z, w, h * tall, y) for z, w, h, y in stations]
    prism(name, 'glass', [(z, w, h, y, tw, 0.9, 0.1) for z, w, h, y in st])
    for sd in (1, -1):
        pts = [V(sd * tw * w * 1.01, y + h + 0.005, z) for z, w, h, y in st if w > 0.06]
        if len(pts) > 1: sweep(f'{name}_rail{sd}', 'gunmetal', pts, 0.028, 6)
    top = [V(0, y + h + 0.01, z) for z, w, h, y in st if w > 0.06]
    if len(top) > 1: sweep(name + '_spine', 'gunmetal', top, 0.03, 6)
    if seat:
        z, w, h, y = max(st, key=lambda q: q[2])
        pilot(0, y + h * 0.42, z - 0.25)
    return st
def pilot(x, y, z):
    emit(sphere(0.19, 20, 14), 'helmet', 'white', T(x, y, z))
    emit(sphere(0.195, 20, 14), 'visor', 'glass', T(x, y + 0.01, z + 0.04) @ S(0.9, 0.55, 0.9))
    emit(box(0.36, 0.55, 0.14), 'seat', 'dark', T(x, y - 0.12, z - 0.3), bevel=0.03)
    emit(box(0.28, 0.1, 0.01), 'hud', 'neon', T(x, y - 0.02, z + 0.7) @ R(x=-0.6))
def neon_slit(x, y, z, L, ry=0.0, w=0.05, h=0.09, name='slit'):
    emit(box(w, h, L), name, 'neon', T(x, y, z) @ R(y=ry))
def light(p, color, kind='nav'): META['lights'].append({'p': list(p), 'color': color, 'kind': kind})
def sym_light(p, kind='nav'): light((p[0], p[1], p[2]), 0xff2030, kind); light((-p[0], p[1], p[2]), 0x20ff60, kind)
def boolean(ob, cutter, op='DIFFERENCE'):
    m = ob.modifiers.new('cut', 'BOOLEAN'); m.object = cutter; m.operation = op; m.solver = 'EXACT'; CUTS.append(cutter)

def vents(ob, y, z0, n=5, w=0.32, step=0.2):
    """row of recessed vent slots cut into `ob` (booleans)"""
    cut = new_bm()
    for k in range(n): merge_into(cut, box(w * 2, 0.12, 0.07), T(0, y, z0 - k * step))
    boolean(ob, emit(cut, 'vent_cut', 'dark', keep=True))

# ---------------- airframes (after the concept sheets) ----------------
def kestrel():
    # needle nose, faceted fuselage, swept clipped delta set well aft (light leading band, dark aft panels),
    # slim swept tip blades, twin canted tails over the nozzle, one big engine
    prism('fuselage', 'primary', [(9.8, 0.02, 0.02, -0.05), (7.6, 0.2, 0.14, -0.02), (5.6, 0.45, 0.3, 0.0), (4.0, 0.72, 0.48, 0.04), (2.2, 0.92, 0.62, 0.06), (0.0, 1.0, 0.7, 0.08), (-3.0, 1.0, 0.72, 0.08), (-4.8, 0.92, 0.74, 0.08), (-5.4, 0.9, 0.74, 0.08)], shape=lambda w, h, y: sec8(w, h, y, 0.42, 0.55, 0.15))
    spine = prism('spine', 'secondary', [(0.4, 0.04, 0.03, 0.74), (-0.4, 0.32, 0.16, 0.76), (-4.4, 0.3, 0.18, 0.78), (-5.2, 0.05, 0.05, 0.76)], shape=lambda w, h, y: sec8(w, h, y, 0.6, 0.9, 0.1))
    vents(spine, 1.0, -1.4, 5, 0.22, 0.2)
    prism('nosepanel', 'secondary', [(6.8, 0.28, 0.07, 0.16), (5.0, 0.48, 0.1, 0.33), (4.6, 0.5, 0.1, 0.38)], shape=lambda w, h, y: sec8(w, h, y, 0.7, 0.9, 0.1))
    canopy([(5.6, 0.03, 0.03, 0.34), (4.7, 0.34, 0.2, 0.44), (3.0, 0.5, 0.33, 0.55), (1.2, 0.46, 0.3, 0.6), (-0.2, 0.08, 0.06, 0.6)])
    for sd in (1, -1):
        neon_slit(sd * 0.5, 0.02, 5.6, 0.55, sd * 0.12, name=f'nose_slit{sd}')
        prism(f'intake{sd}', 'secondary', [(3.0, 0.03, 0.22, 0), (2.6, 0.3, 0.3, 0), (0.0, 0.34, 0.32, 0), (-2.0, 0.08, 0.18, 0)], (sd * 0.98, -0.28, 0))
        emit(disc(1, 8), f'intake_face{sd}', 'inner', T(sd * 0.98, -0.28, 2.62) @ S(0.24, 0.24, 1) @ R(z=math.pi / 8))
        gun(sd * 1.3, -0.08, 2.2, 1.1, 0.06, f'gun{sd}')
        rack(sd * 2.1, -0.36, -1.7, 3, 1.7, 0.11, 0.27, f'rack{sd}', top=-0.12)
        fin_plate(f'tipfin{sd}', 'primary', [(-0.6, -4.55), (0.0, -4.72), (1.1, -5.45), (1.1, -5.85), (-0.6, -5.6)], 6.52, -0.32, sd, 0.08, t=0.12, ch=0.04)
        bar(f'tip_neon{sd}', 'neon', V(sd * 6.6, -0.3, -4.72), V(sd * 6.68, 0.75, -5.45), 0.05)
        fin_plate(f'tail{sd}', 'primary', [(0, -3.6), (0.3, -3.8), (1.5, -5.55), (1.5, -6.25), (0, -6.0)], 0.52, 0.8, sd, 0.24)
        fin_plate(f'tailcap{sd}', 'secondary', [(1.15, -5.0), (1.5, -5.55), (1.5, -6.25), (1.15, -6.2)], 0.52, 0.8, sd, 0.24, t=0.18)
        fin_plate(f'ventral{sd}', 'secondary', [(0, -3.4), (0.7, -4.3), (0.7, -4.8), (0, -5.0)], 0.45, -0.55, sd, math.pi - 0.45)
    A = -0.08  # anhedral, as on the front view
    plate('wing_le', 'primary', [(0.9, 1.2), (6.5, -4.9), (6.5, -5.2), (0.9, -1.15)], 0.2, 0.06, dih=A)
    plate('wing_aft', 'secondary', [(0.9, -1.15), (6.5, -5.2), (6.5, -5.45), (0.9, -5.2)], 0.2, 0.06, dih=A)
    plate('aileron', 'secondary', [(3.2, -5.3), (6.4, -5.52), (6.4, -5.85), (3.2, -5.65)], 0.12, 0.035, dih=A)
    plate('flap', 'secondary', [(1.0, -5.27), (3.05, -5.32), (3.05, -5.65), (1.0, -5.6)], 0.12, 0.035, dih=A)
    plate('canard', 'primary', [(0.75, 4.4), (2.3, 3.3), (2.3, 2.95), (0.75, 3.1)], 0.12, 0.04, T(0, 0.05, 0))
    engine(0, 0.08, -5.9, 0.8, 2.0)
    sym_light((6.66, 0.8, -5.6)); light((0.9, 2.15, -6.1), 0xffffff, 'strobe'); light((0, -0.72, -1.0), 0xff2030, 'beacon')
    decal_side(0.52 + 0.24 * 0.8 + 0.1, 0.8 + 0.8, -4.9, 1, 0.24, 0.8); decal_side(-(0.52 + 0.24 * 0.8 + 0.1), 0.8 + 0.8, -4.9, -1, 0.24, 0.8)
    META.update(stripe=[0.16, 0.3, 0.55], band=[4.4, 4.9])

def mirage():
    # flying crescent: concave leading edge, straight trailing edge to wide tips, long pods with claws hooked forward-down
    prism('body', 'primary', [(5.6, 0.03, 0.03, -0.08), (4.4, 0.35, 0.2, -0.02), (2.8, 0.74, 0.4, 0.04), (0.8, 1.0, 0.52, 0.08), (-1.6, 1.05, 0.52, 0.08), (-3.4, 0.7, 0.42, 0.06), (-3.9, 0.3, 0.28, 0.05)], shape=lambda w, h, y: sec8(w, h, y, 0.5, 0.6, 0.12))
    prism('bodytop', 'secondary', [(1.6, 0.2, 0.05, 0.56), (0.6, 0.45, 0.08, 0.6), (-2.6, 0.42, 0.08, 0.58), (-3.3, 0.15, 0.05, 0.5)], shape=lambda w, h, y: sec8(w, h, y, 0.8, 0.9, 0.1))
    canopy([(3.9, 0.03, 0.03, 0.3), (3.1, 0.44, 0.24, 0.38), (1.6, 0.6, 0.34, 0.46), (0.2, 0.52, 0.31, 0.5), (-0.9, 0.08, 0.06, 0.48)], tw=0.5)
    plate('wing', 'secondary', [(0.95, 1.6), (3.4, 0.8), (5.8, -0.3), (8.0, -1.2), (8.4, -1.6), (8.4, -5.0), (1.0, -2.0)], 0.24, 0.07)
    plate('wing_le', 'primary', [(0.95, 2.15), (3.4, 1.35), (5.8, 0.25), (8.0, -0.7), (8.0, -1.2), (5.8, -0.3), (3.4, 0.8), (0.95, 1.6)], 0.24, 0.07)
    plate('wing_flap', 'primary', [(3.4, -3.02), (6.8, -4.4), (6.8, -4.75), (3.4, -3.37)], 0.14, 0.04)
    for sd in (1, -1):
        fin_plate(f'claw{sd}', 'primary', crescent((0.55, -4.6), (-1.5, 1.3), 0.8, 0.55), 8.6, 0.2, sd, 0.26, t=0.3, ch=0.09)
        prism(f'pod{sd}', 'secondary', [(0.5, 0.12, 0.12), (0.0, 0.42, 0.42), (-6.0, 0.46, 0.46), (-6.5, 0.42, 0.42)], (sd * 8.1, 0.2, 0), shape=oct_shape)
        neon_slit(sd * 8.57, 0.2, -3.0, 3.2, 0, 0.05, 0.2, f'pod_slit{sd}')
        engine(sd * 8.1, 0.2, -6.9, 0.4, 0.8, f'eng{sd}')
        emit(box(0.42, 0.42, 1.3), f'launcher{sd}', 'secondary', T(sd * 1.08, 0.08, 2.8), bevel=0.04)
        for k in range(4):
            px, py = sd * 1.08 + (0.1 if k % 2 else -0.1), 0.08 + (0.1 if k < 2 else -0.1)
            emit(disc(0.065, 10), f'tube{sd}{k}', 'inner', T(px, py, 3.46)); emit(torus(0.065, 0.018, 12, 4), f'tubeglow{sd}{k}', 'neon', T(px, py, 3.47))
        neon_slit(sd * 0.62, -0.18, 3.0, 0.7, sd * 0.2, 0.05, 0.08, f'chin{sd}')
        emit(box(0.1, 0.4, 0.8), f'pylon{sd}', 'dark', T(sd * 6.0, -0.28, -0.6), bevel=0.02)
        missile(sd * 6.0, -0.6, -0.4, 1.9, 0.15, f'msl{sd}')
    sym_light((8.7, 0.25, -6.0)); light((0, 0.75, -3.2), 0xffffff, 'strobe'); light((0, -0.5, 0.5), 0xff2030, 'beacon')
    decal_up(4.6, 0.13, -1.6, 1.4); decal_up(-4.6, 0.13, -1.6, 1.4)
    META.update(stripe=[0.2, 0.36, 0.5], band=[6.2, 6.7])

def bastion():
    # twin-boom gunship: booms carry the rotary cannons in dark cowls, two big engine boxes aft with glowing grilles,
    # fins at the boom tails, straight wing with dark tips, two three-missile racks per side
    prism('body', 'primary', [(6.4, 0.55, 0.22, -0.1), (5.6, 0.85, 0.5, -0.05), (4.0, 1.15, 0.8, 0.05), (2.0, 1.3, 0.95, 0.12), (-1.0, 1.3, 0.95, 0.15), (-3.5, 1.1, 0.85, 0.2), (-4.8, 0.8, 0.65, 0.3)], shape=lambda w, h, y: sec8(w, h, y, 0.55, 0.7, 0.25))
    prism('chin', 'secondary', [(5.9, 0.5, 0.12, -0.4), (4.2, 0.85, 0.2, -0.62), (2.0, 0.95, 0.22, -0.72)], shape=lambda w, h, y: sec8(w, h, y, 0.9, 0.7, 0.2))
    canopy([(4.8, 0.03, 0.03, 0.6), (4.0, 0.55, 0.28, 0.7), (2.5, 0.72, 0.4, 0.84), (1.0, 0.65, 0.37, 0.88), (0.0, 0.1, 0.08, 0.86)], tw=0.5)
    hump = prism('hump', 'secondary', [(0.2, 0.3, 0.1, 1.0), (-0.6, 0.62, 0.22, 1.08), (-2.6, 0.62, 0.22, 1.1), (-3.2, 0.4, 0.15, 1.05)], shape=lambda w, h, y: sec8(w, h, y, 0.8, 0.9, 0.2))
    vents(hump, 1.32, -0.9, 6, 0.4, 0.26)
    for sd in (1, -1):
        prism(f'boom{sd}', 'primary', [(2.6, 0.5, 0.5), (2.2, 0.62, 0.62), (-5.6, 0.6, 0.6), (-7.0, 0.42, 0.45)], (sd * 2.4, -0.05, 0), shape=oct_shape)
        prism(f'cowl{sd}', 'secondary', [(3.0, 0.48, 0.48), (2.7, 0.72, 0.72), (0.6, 0.72, 0.72), (0.2, 0.62, 0.62)], (sd * 2.4, -0.05, 0), shape=oct_shape)
        gatling(sd * 2.4, -0.05, 2.75, 0.6, 0.22, f'gat{sd}')
        prism(f'engbox{sd}', 'secondary', [(-3.6, 0.82, 0.5), (-3.9, 0.95, 0.58), (-6.8, 0.95, 0.58), (-7.2, 0.82, 0.5)], (sd * 1.0, 1.4, 0), shape=lambda w, h, y=0: sec8(w, h, y, 0.85, 0.85, 0.5))
        emit(box(1.3, 0.6, 0.04), f'grille_back{sd}', 'warm', T(sd * 1.0, 1.4, -3.56))
        grille(sd * 1.0, 1.4, -3.52, 1.45, 0.64, 5, 'dark', 'x', f'grille{sd}', 0.08)
        emit(box(1.3, 0.08, 0.8), f'engcap{sd}', 'dark', T(sd * 1.0, 1.99, -5.2), bevel=0.02)
        engine(sd * 1.0, 1.4, -7.6, 0.46, 0.9, f'eng{sd}')
        fin_plate(f'fin{sd}', 'primary', [(0, -4.4), (0.4, -4.6), (2.8, -6.3), (2.85, -7.0), (0, -7.1)], 2.4, 0.5, sd, 0.06, t=0.2)
        fin_plate(f'fintip{sd}', 'secondary', [(2.2, -5.8), (2.8, -6.3), (2.85, -7.0), (2.2, -7.05)], 2.4, 0.5, sd, 0.06, t=0.22)
        for i, x in enumerate((4.1, 5.9)): rack(sd * x, -0.48, 0.3, 3, 1.5, 0.11, 0.25, f'rack{sd}{i}', top=-0.04)
        for k in range(2): emit(box(0.16, 0.02, 1.2), f'stripe{sd}{k}', 'accent', T(sd * (6.0 + k * 0.32), 0.25, -0.5))
    plate('wing', 'primary', [(1.3, 1.2), (6.6, 0.5), (6.6, -1.5), (1.3, -2.4)], 0.28, 0.07, T(0, 0.1, 0))
    plate('wing_le', 'secondary', [(1.3, 1.6), (6.6, 0.85), (6.6, 0.5), (1.3, 1.2)], 0.28, 0.07, T(0, 0.1, 0))
    plate('wing_tip', 'secondary', [(6.6, 0.85), (7.4, 0.55), (7.7, -0.2), (7.4, -1.4), (6.6, -1.5)], 0.28, 0.07, T(0, 0.1, 0))
    plate('flap', 'secondary', [(2.0, -2.45), (6.4, -1.6), (6.4, -1.95), (2.0, -2.8)], 0.16, 0.04, T(0, 0.1, 0))
    sym_light((7.72, 0.12, -0.2)); light((2.5, 3.35, -6.9), 0xffffff, 'strobe'); light((0, -0.9, -1.5), 0xff2030, 'beacon')
    decal_up(4.8, 0.25, -0.8, 1.4); decal_up(-4.8, 0.25, -0.8, 1.4)
    META.update(stripe=[0.3, 0.5, 0.9], band=[6.7, 7.0])

def arc():
    # twin prongs with the beam between them, broad cropped delta, radiators forward beside the cockpit,
    # underwing cannons forward, low blades over the nozzles
    for sd in (1, -1):
        prism(f'prong{sd}', 'primary', [(8.4, 0.06, 0.06, 0), (7.6, 0.3, 0.24, 0), (6.0, 0.42, 0.34, 0.02), (2.0, 0.5, 0.42, 0.05), (-0.6, 0.55, 0.45, 0.08)], (sd * 1.0, 0, 0), shape=lambda w, h, y: sec8(w, h, y, 0.45, 0.55, 0.2))
        prism(f'prongtop{sd}', 'secondary', [(6.8, 0.15, 0.04, 0.3), (3.0, 0.3, 0.06, 0.45), (0.0, 0.3, 0.06, 0.5)], (sd * 1.0, 0, 0), shape=lambda w, h, y: sec8(w, h, y, 0.8, 0.9, 0.1))
        neon_slit(sd * 0.74, 0.0, 7.75, 0.7, -sd * 0.18, 0.05, 0.14, f'prong_tip{sd}')
        emit(torus(0.16, 0.05, 16, 6), f'node{sd}', 'gunmetal', T(sd * 0.72, 0, 7.3) @ R(y=math.pi / 2))
        bar(f'rail{sd}', 'dark', V(sd * 0.55, 0.0, 2.6), V(sd * 0.8, 0.0, 2.6), 0.16)
        emit(box(0.42, 0.55, 2.0), f'radiator{sd}', 'dark', T(sd * 1.8, 0.12, 1.6), bevel=0.03)
        grille(sd * 2.02, 0.12, 1.6, 1.9, 0.5, 11, 'gunmetal', 'z', f'rad_fins{sd}', 0.06)
        prism(f'nacelle{sd}', 'secondary', [(-1.6, 0.2, 0.2), (-2.2, 0.38, 0.38), (-5.7, 0.4, 0.4), (-6.0, 0.36, 0.36)], (sd * 1.25, 0.38, 0), shape=oct_shape)
        engine(sd * 1.25, 0.38, -6.3, 0.34, 0.8, f'eng{sd}')
        fin_plate(f'fin{sd}', 'primary', [(0, -5.0), (0.25, -5.2), (0.6, -5.8), (0.6, -6.1), (0, -6.2)], 1.25, 0.72, sd, 0.3)
        emit(box(0.32, 0.32, 1.3), f'gunpod{sd}', 'dark', T(sd * 3.3, -0.36, 0.0), bevel=0.03)
        emit(box(0.1, 0.3, 0.8), f'gunpyl{sd}', 'dark', T(sd * 3.3, -0.08, -0.4), bevel=0.02)
        gun(sd * 3.3, -0.36, 0.5, 1.6, 0.055, f'gun{sd}', 2)
    tube('rod', 'metal', V(-0.72, 0, 7.3), V(0.72, 0, 7.3), 0.055, 10)
    META['emitter'] = [0, 0, 7.3]
    bar('beam', 'neon', V(0, 0, 7.15), V(0, 0, 2.45), 0.05)
    emit(torus(0.24, 0.06, 20, 6), 'lens_ring', 'gunmetal', T(0, 0, 2.42)); emit(disc(0.22, 20), 'lens', 'neon', T(0, 0, 2.43))
    prism('body', 'primary', [(3.0, 0.3, 0.25, 0.2), (2.2, 0.75, 0.45, 0.25), (0.0, 1.0, 0.6, 0.3), (-3.0, 1.05, 0.6, 0.3), (-5.5, 0.8, 0.5, 0.3)], shape=lambda w, h, y: sec8(w, h, y, 0.5, 0.6, 0.2))
    canopy([(2.6, 0.03, 0.03, 0.55), (1.9, 0.42, 0.24, 0.64), (0.6, 0.55, 0.33, 0.73), (-0.8, 0.5, 0.31, 0.76), (-2.0, 0.08, 0.06, 0.74)])
    A = -0.07
    plate('wing', 'primary', [(1.6, 0.4), (5.6, -2.6), (5.6, -3.4), (1.6, -3.9)], 0.18, 0.05, T(0, 0.1, 0), dih=A)
    plate('wing_panel', 'secondary', [(3.6, -1.1), (5.4, -2.45), (5.4, -3.2), (3.6, -3.45)], 0.21, 0.03, T(0, 0.1, 0), dih=A)
    plate('aileron', 'secondary', [(3.0, -3.78), (5.5, -3.47), (5.5, -3.8), (3.0, -4.1)], 0.12, 0.03, T(0, 0.1, 0), dih=A)
    sym_light((5.6, 0.0, -3.0)); light((0, 0.95, -5.0), 0xffffff, 'strobe'); light((0, -0.35, -2.0), 0xff2030, 'beacon')
    decal_up(3.6, 0.12, -2.0, 1.2); decal_up(-3.6, 0.12, -2.0, 1.2)
    META.update(stripe=[0.2, 0.36, 0.6], band=[4.6, 5.0])

def nomad():
    # dark faceted body with orange spine and canopy surround, duckbill nose with neon slits, wide octagonal
    # intakes with U glow, low-sweep wings with a forward-swept trailing edge and dark caps, V-tail
    prism('body', 'secondary', [(6.9, 0.55, 0.12, -0.1), (6.0, 0.7, 0.3, -0.05), (4.2, 0.92, 0.5, 0.05), (2.0, 1.0, 0.62, 0.12), (-1.5, 1.05, 0.65, 0.15), (-4.5, 0.85, 0.6, 0.15), (-5.8, 0.6, 0.45, 0.12)], shape=lambda w, h, y: sec8(w, h, y, 0.55, 0.75, 0.2))
    prism('nosetop', 'primary', [(6.85, 0.42, 0.05, 0.05), (5.2, 0.62, 0.08, 0.33), (4.0, 0.7, 0.1, 0.5)], shape=lambda w, h, y: sec8(w, h, y, 0.85, 0.9, 0.2))
    dorsal = prism('dorsal', 'primary', [(1.2, 0.3, 0.06, 0.76), (0.2, 0.62, 0.1, 0.8), (-3.6, 0.6, 0.1, 0.76), (-4.6, 0.3, 0.06, 0.72)], shape=lambda w, h, y: sec8(w, h, y, 0.85, 0.9, 0.2))
    vents(dorsal, 0.9, -1.0, 4, 0.3, 0.24)
    canopy([(5.4, 0.03, 0.03, 0.42), (4.6, 0.45, 0.25, 0.52), (3.0, 0.62, 0.38, 0.62), (1.4, 0.55, 0.34, 0.68), (0.2, 0.08, 0.06, 0.66)], tw=0.5)
    for sd in (1, -1):
        neon_slit(sd * 0.3, -0.06, 6.86, 0.3, 0, 0.05, 0.1, f'nose_slit{sd}')
        nac = prism(f'nacelle{sd}', 'secondary', [(2.6, 0.78, 0.78), (2.2, 0.85, 0.85), (-3.6, 0.85, 0.85), (-4.6, 0.7, 0.7)], (sd * 2.6, -0.05, 0), shape=oct_shape)
        boolean(nac, emit(prism_bm([(3.2, 0.62, 0.62), (1.8, 0.62, 0.62)], (sd * 2.6, -0.05, 0), oct_shape), f'nac_cut{sd}', 'dark', keep=True))
        emit(disc(0.66, 8), f'intake_back{sd}', 'inner', T(sd * 2.6, -0.05, 1.82) @ R(z=math.pi / 8))
        for a, b in (((-0.32, 0.32), (-0.32, -0.26)), ((-0.32, -0.26), (0.32, -0.26)), ((0.32, -0.26), (0.32, 0.32))):
            bar(f'u{sd}{a}{b}', 'neon', V(sd * 2.6 + a[0], -0.05 + a[1], 1.95), V(sd * 2.6 + b[0], -0.05 + b[1], 1.95), 0.08)
        plate(f'nactop{sd}', 'primary', [(-0.42, 2.2), (0.42, 2.2), (0.42, -3.4), (-0.42, -3.4)], 0.08, 0.03, T(sd * 2.6, 0.84, 0), sym=False)
        engine(sd * 2.6, -0.05, -5.0, 0.62, 0.9, f'eng{sd}')
        fin_plate(f'vtail{sd}', 'primary', [(0, -2.8), (0.4, -3.1), (2.9, -4.9), (2.95, -5.5), (0, -5.8)], 0.65, 0.55, sd, 0.7, t=0.18)
        fin_plate(f'vtailtip{sd}', 'secondary', [(2.2, -4.35), (2.9, -4.9), (2.95, -5.5), (2.2, -5.6)], 0.65, 0.55, sd, 0.7, t=0.2)
        for i, (x, z) in enumerate(((4.3, 0.4), (5.6, 0.0))):
            emit(box(0.1, 0.3, 0.7), f'pylon{sd}{i}', 'dark', T(sd * x, -0.22, z + 0.1), bevel=0.02)
            missile(sd * x, -0.5, z, 1.6, 0.13, f'msl{sd}{i}')
    A = -0.06
    plate('wing', 'primary', [(3.3, 0.3), (7.2, -0.42), (7.2, -1.68), (3.3, -2.4)], 0.2, 0.06, dih=A)
    plate('wing_cap', 'secondary', [(7.2, -0.42), (7.6, -0.5), (7.7, -1.6), (7.2, -1.68)], 0.22, 0.06, dih=A)
    plate('wing_root', 'secondary', [(3.3, 0.3), (4.4, 0.1), (4.4, -2.2), (3.3, -2.4)], 0.22, 0.06, dih=A)
    plate('flap', 'secondary', [(4.5, -2.3), (7.1, -1.78), (7.1, -2.1), (4.5, -2.62)], 0.14, 0.04, dih=A)
    sym_light((7.7, -0.1, -1.1)); light((0.65 + 0.64 * 2.9, 0.55 + 2.2, -5.2), 0xffffff, 'strobe'); light((0, -0.6, -1.0), 0xff2030, 'beacon')
    decal_up(5.6, 0.05, -1.0, 1.1); decal_up(-5.6, 0.05, -1.0, 1.1)
    META.update(stripe=[0.22, 0.4, 0.7], band=[6.4, 6.9])

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
def smooth_by_angle(ob, deg=30):
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
    sc = bpy.context.scene; sc.world.light_settings.distance = 1.2
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
    w = sc.world; bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.55, 0.53, 0.52, 1); bg.inputs['Strength'].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4.0; sun.data.angle = 0.2; sun.rotation_euler = (math.radians(40), 0, math.radians(30)); sc.collection.objects.link(sun)
    floor = bpy.data.objects.new('floor', bpy.data.meshes.new('floor')); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=80); bm.to_mesh(floor.data); bm.free()
    floor.location.z = -2.6; fm = bpy.data.materials.new('floor'); fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.62, 0.6, 0.58, 1); floor.data.materials.append(fm); sc.collection.objects.link(floor)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.lens = 50; sc.collection.objects.link(cam); sc.camera = cam
    for name, pos in (('front', (-15, -16, 9)), ('rear', (13, 18, 6.5))):
        cam.location = pos; cam.rotation_euler = (Vector((0, -0.3, 0.2)) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(RENDER, f'{key}_{name}.png'); bpy.ops.render.render(write_still=True)

for key in (ONLY or list(DESIGNS)):
    build(key)
