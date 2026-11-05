# -*- coding: utf-8 -*-
"""Build detailed yellow rigid mining haul trucks, without dependencies.

Run ``npm run data:truck`` to write the empty and loaded GLB variants. Geometry
uses metres, +Y up and -Z forward. Both variants have identical bounds and an
actually hollow dump body. Paint is native yellow; do not apply status tints.
"""
import json
import math
import os
import random
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data")
YELLOW, INTERIOR, OCHRE, RUBBER, TREAD, STEEL, GLASS, METAL, LIGHT, RED, ORE = range(11)


def material(name, color, metallic=0.0, roughness=0.7, emissive=None):
    result = {"name": name, "pbrMetallicRoughness": {
        "baseColorFactor": [*color, 1.0], "metallicFactor": metallic, "roughnessFactor": roughness}}
    if emissive:
        result["emissiveFactor"] = emissive
    return result


MATERIALS = [
    material("safety-yellow-paint", (1.0, 0.66, 0.025), 0.12, 0.46),
    material("dump-interior", (0.69, 0.45, 0.065), 0.22, 0.8),
    material("paint-shadow", (0.72, 0.36, 0.018), 0.18, 0.6),
    material("tire-rubber", (0.043, 0.048, 0.052), 0.0, 0.93),
    material("tire-tread", (0.085, 0.091, 0.094), 0.0, 0.92),
    material("chassis-steel", (0.10, 0.12, 0.13), 0.5, 0.63),
    material("window-glass", (0.047, 0.115, 0.16), 0.42, 0.19),
    material("polished-metal", (0.49, 0.56, 0.57), 0.8, 0.35),
    material("headlight", (0.96, 0.96, 0.80), 0.12, 0.24, (0.35, 0.34, 0.23)),
    material("tail-light", (0.64, 0.025, 0.012), 0.0, 0.35, (0.2, 0.005, 0.0)),
    material("ore-rock", (0.33, 0.30, 0.23), 0.0, 1.0),
]


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def scale(v, n):
    return tuple(x * n for x in v)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def unit(v):
    length = math.sqrt(dot(v, v))
    if length < 1e-10:
        raise ValueError("Degenerate geometry")
    return scale(v, 1.0 / length)


def average(points):
    return scale(tuple(sum(p[i] for p in points) for i in range(3)), 1 / len(points))


class Mesh:
    def __init__(self):
        self.groups = {}
        self.parts = []

    def vertex(self, mat, position, normal):
        group = self.groups.setdefault(mat, {"vertices": [], "indices": [], "lookup": {}})
        key = tuple(round(v, 7) for v in (*position, *normal))
        if key not in group["lookup"]:
            group["lookup"][key] = len(group["vertices"])
            group["vertices"].append((*position, *normal))
        return group["lookup"][key]

    def triangle(self, mat, a, b, c, normals=None):
        normal = unit(cross(sub(b, a), sub(c, a)))
        normals = normals or (normal, normal, normal)
        indices = [self.vertex(mat, p, n) for p, n in zip((a, b, c), normals)]
        self.groups[mat]["indices"].extend(indices)

    def polygon(self, mat, points, outward=None):
        points = list(points)
        if outward and dot(cross(sub(points[1], points[0]), sub(points[2], points[0])), outward) < 0:
            points.reverse()
        for i in range(1, len(points) - 1):
            self.triangle(mat, points[0], points[i], points[i + 1])

    def solid(self, mat, vertices, faces):
        center = average(vertices)
        for face in faces:
            points = [vertices[i] for i in face]
            self.polygon(mat, points, sub(average(points), center))

    def box(self, mat, x0, x1, y0, y1, z0, z1):
        self.oriented_box(mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
                          ((x1 - x0) / 2, 0, 0), (0, (y1 - y0) / 2, 0),
                          (0, 0, (z1 - z0) / 2))

    def oriented_box(self, mat, center, x, y, z):
        points = [add(center, add(scale(x, sx), add(scale(y, sy), scale(z, sz))))
                  for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                    (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
        self.solid(mat, points, ((0, 1, 2, 3), (4, 7, 6, 5), (0, 3, 7, 4),
                                 (1, 5, 6, 2), (0, 4, 5, 1), (3, 2, 6, 7)))

    def plate(self, mat, front, back, inside_mat=None):
        center = average([*front, *back])
        self.polygon(mat, front, sub(average(front), center))
        self.polygon(mat if inside_mat is None else inside_mat, back, sub(average(back), center))
        for i in range(len(front)):
            j = (i + 1) % len(front)
            edge = [front[i], front[j], back[j], back[i]]
            self.polygon(mat, edge, sub(average(edge), center))

    def pipe(self, mat, a, b, radius, segments=8):
        axis = unit(sub(b, a))
        u = unit(cross(axis, (0, 1, 0) if abs(axis[1]) < 0.9 else (1, 0, 0)))
        v = cross(axis, u)
        normals = [add(scale(u, math.cos(i * math.tau / segments)),
                       scale(v, math.sin(i * math.tau / segments))) for i in range(segments)]
        first, last = [[add(point, scale(n, radius)) for n in normals] for point in (a, b)]
        for i in range(segments):
            j = (i + 1) % segments
            self.triangle(mat, first[i], first[j], last[j], (normals[i], normals[j], normals[j]))
            self.triangle(mat, first[i], last[j], last[i], (normals[i], normals[j], normals[i]))
        self.polygon(mat, first, scale(axis, -1))
        self.polygon(mat, last, axis)

    def lathe_x(self, mat, center, profile, segments=40):
        """Closed tire/rim section: clockwise axial/radial profile, smooth normals."""
        rings, normals = [], []
        for k, (axial, radius) in enumerate(profile):
            before, after = profile[(k - 1) % len(profile)], profile[(k + 1) % len(profile)]
            tangent = unit((after[0] - before[0], after[1] - before[1], 0))
            ring, ns = [], []
            for i in range(segments):
                theta = i * math.tau / segments
                sine, cosine = math.sin(theta), math.cos(theta)
                ring.append(add(center, (axial, sine * radius, cosine * radius)))
                ns.append((-tangent[1], tangent[0] * sine, tangent[0] * cosine))
            rings.append(ring)
            normals.append(ns)
        for k in range(len(profile)):
            following = (k + 1) % len(profile)
            for i in range(segments):
                j = (i + 1) % segments
                self.triangle(mat, rings[k][i], rings[following][i], rings[following][j],
                              (normals[k][i], normals[following][i], normals[following][j]))
                self.triangle(mat, rings[k][i], rings[following][j], rings[k][j],
                              (normals[k][i], normals[following][j], normals[k][j]))


def build_tire(mesh, cx, cz, half_width, outer_side):
    cy, radius = 1.87, 1.81
    mesh.lathe_x(RUBBER, (cx, cy, cz), [
        (-half_width, radius * 0.49), (-half_width, radius * 0.83),
        (-half_width * 0.82, radius * 0.94), (-half_width * 0.56, radius),
        (half_width * 0.56, radius), (half_width * 0.82, radius * 0.94),
        (half_width, radius * 0.83), (half_width, radius * 0.49)])
    # Two staggered diagonal rows of individually readable heavy tread lugs.
    for i in range(32):
        for row in (-1, 1):
            theta = (i + (0.22 if row > 0 else 0)) * math.tau / 32
            radial, tangent = (0, math.sin(theta), math.cos(theta)), (0, math.cos(theta), -math.sin(theta))
            angle = row * 0.34
            along = add(scale((1, 0, 0), math.cos(angle)), scale(tangent, math.sin(angle)))
            across = add(scale((1, 0, 0), -math.sin(angle)), scale(tangent, math.cos(angle)))
            center = add((cx + row * half_width * 0.36, cy, cz), scale(radial, radius + 0.015))
            mesh.oriented_box(TREAD, center, scale(along, half_width * 0.40),
                              scale(radial, 0.045), scale(across, 0.105))
    # Recessed yellow rims, raised hub caps and eight silver wheel bolts.
    for side in (-1, 1):
        rim_x = cx + side * (half_width + 0.012)
        mesh.pipe(OCHRE, (rim_x - 0.055, cy, cz), (rim_x + 0.055, cy, cz), 0.89, 32)
        mesh.lathe_x(YELLOW, (rim_x, cy, cz), [
            (-0.045, 0.36), (-0.07, 0.68), (-0.025, 0.88),
            (0.025, 0.88), (0.07, 0.68), (0.045, 0.36)], 32)
        mesh.pipe(STEEL, (rim_x - 0.075, cy, cz), (rim_x + 0.075, cy, cz), 0.37, 24)
        cap_x = rim_x + side * 0.10
        mesh.pipe(YELLOW, (cap_x - 0.06, cy, cz), (cap_x + 0.06, cy, cz), 0.30, 24)
        if side == outer_side:
            for i in range(8):
                theta = i * math.tau / 8
                y, z = cy + 0.47 * math.sin(theta), cz + 0.47 * math.cos(theta)
                mesh.pipe(METAL, (rim_x + side * 0.075, y, z),
                          (rim_x + side * 0.11, y, z), 0.053, 6)


def build_body(mesh):
    # Separate chassis rails and crossmembers leave daylight beneath the bed.
    for side in (-1, 1):
        mesh.box(STEEL, side * 1.15 - 0.22, side * 1.15 + 0.22, 1.45, 2.55, -5.5, 5.55)
    for z in (-4.2, -1.3, 1.5, 3.5, 5.3):
        mesh.box(STEEL, -2.25, 2.25, 1.75, 2.12, z - 0.18, z + 0.18)
    for z in (-3.85, 3.45):
        mesh.pipe(STEEL, (-3.45, 1.87, z), (3.45, 1.87, z), 0.24, 12)
        mesh.box(STEEL, -0.66, 0.66, 1.25, 2.35, z - 0.48, z + 0.48)
        for side in (-1, 1):
            mesh.pipe(METAL, (side * 2.1, 1.95, z), (side * 2.05, 3.16, z - 0.2), 0.16, 12)
            mesh.pipe(STEEL, (side * 2.1, 1.95, z), (side * 2.07, 2.6, z - 0.12), 0.23, 12)
    mesh.box(STEEL, -3.05, -1.65, 1.45, 2.85, -1.25, 1.1)
    mesh.box(YELLOW, -3.10, -3.00, 1.58, 2.72, -1.14, 0.98)
    for z in (-0.85, 0.65):
        mesh.box(METAL, -3.13, -3.10, 1.55, 2.76, z - 0.06, z + 0.06)
    mesh.box(STEEL, 1.65, 3.0, 1.45, 2.9, -1.35, 1.1)
    for side in (-1, 1):
        mesh.pipe(OCHRE, (side * 1.6, 2.2, -1.0), (side * 2.25, 3.4, -0.2), 0.22, 12)
        mesh.pipe(METAL, (side * 1.6, 2.2, -1.0), (side * 1.98, 2.9, -0.53), 0.14, 12)
    mesh.parts.append("open ladder chassis, suspension and hydraulic struts")

    # Thin angular sheets create the open dump body, including a visible floor.
    # The underside stays above the rear dual tires, including their tread lugs.
    outline = [(-2.45, 5.88, 3.78), (5.45, 5.88, 3.78),
               (6.35, 4.62, 3.22), (6.35, 4.06, 2.65), (-1.78, 3.94, 2.65)]
    for side in (-1, 1):
        outer = [(side * width, y, z) for z, y, width in outline]
        inner = [(side * (width - 0.18), y, z) for z, y, width in outline]
        mesh.plate(YELLOW, outer, inner, INTERIOR)
        for i in (0, 1, 2):
            mesh.pipe(YELLOW, outer[i], outer[i + 1], 0.105, 8)
        mesh.pipe(OCHRE, outer[-1], outer[-2], 0.095, 8)
        for z in (-0.6, 1.4, 3.4):
            mesh.pipe(OCHRE, (side * 2.86, 4.17, z), (side * 3.71, 5.64, z - 0.26), 0.075, 6)
    floor = [(-2.65, 3.94, -1.78), (2.65, 3.94, -1.78),
             (2.65, 4.06, 6.35), (-2.65, 4.06, 6.35)]
    mesh.plate(INTERIOR, floor, [(x, y - 0.18, z) for x, y, z in floor], OCHRE)
    front = [(-2.65, 3.94, -1.78), (2.65, 3.94, -1.78),
             (3.78, 5.88, -2.45), (-3.78, 5.88, -2.45)]
    mesh.plate(YELLOW, front, [(x, y, z + 0.18) for x, y, z in front], INTERIOR)
    mesh.box(YELLOW, -2.79, 2.79, 3.91, 4.12, 6.18, 6.40)
    mesh.parts.append("hollow tapered dump bed with open rear, worn interior and reinforced rims")
    # Broad rock canopy above the cab with a folded leading edge.
    canopy = [(-6.10, 5.80), (-6.10, 6.02), (-2.35, 6.14), (-2.35, 5.88)]
    mesh.plate(YELLOW, [(-3.63, y, z) for z, y in canopy], [(3.63, y, z) for z, y in canopy])
    mesh.box(OCHRE, -3.63, 3.63, 5.79, 5.88, -6.11, -5.94)
    for side in (-1, 1):
        mesh.pipe(OCHRE, (side * 3.5, 4.7, -2.1), (side * 3.5, 5.88, -3.4), 0.09, 8)
    # Offset driver cab: sloped glass, separate corner pillars and door frame.
    mesh.box(YELLOW, -3.25, -0.95, 3.34, 4.05, -5.66, -3.62)
    cab_bottom = [(-3.24, 4.02, -5.65), (-0.97, 4.02, -5.65),
                  (-0.97, 4.02, -3.62), (-3.24, 4.02, -3.62)]
    cab_top = [(-3.24, 5.65, -5.33), (-0.97, 5.65, -5.33),
               (-0.97, 5.65, -3.62), (-3.24, 5.65, -3.62)]
    mesh.plate(GLASS, cab_bottom, cab_top)
    mesh.box(YELLOW, -3.32, -0.90, 5.64, 5.77, -5.41, -3.56)
    for low, high in zip(cab_bottom, cab_top):
        mesh.pipe(STEEL, low, high, 0.072, 6)
    for points in (cab_bottom, cab_top):
        for i in range(4):
            mesh.pipe(STEEL, points[i], points[(i + 1) % 4], 0.065, 6)
    mesh.pipe(STEEL, (-2.1, 4.02, -5.67), (-2.1, 5.65, -5.35), 0.05, 6)
    mesh.pipe(STEEL, (-3.27, 4.02, -4.3), (-3.27, 5.65, -4.3), 0.045, 6)
    for x in (-2.7, -1.65):
        mesh.pipe(STEEL, (x, 4.12, -5.69), (x + 0.27, 4.8, -5.56), 0.025, 5)
    mesh.box(METAL, -3.29, -3.26, 3.75, 3.81, -4.30, -4.02)
    for side, x in ((-1, -3.24), (1, -0.97)):
        mirror_x = x + side * 0.47
        mesh.pipe(STEEL, (x, 5.18, -5.35), (mirror_x, 5.18, -5.65), 0.032, 6)
        mesh.box(STEEL, mirror_x - 0.12, mirror_x + 0.12, 4.91, 5.45, -5.75, -5.63)
        mesh.box(METAL, mirror_x - 0.095, mirror_x + 0.095, 4.95, 5.41, -5.76, -5.751)
    mesh.parts.append("offset cab with sloped blue glazing, framed doors, wipers and mirrors")
    # Engine cowl and recessed radiator grille.
    mesh.box(YELLOW, -0.63, 2.51, 2.55, 4.54, -5.67, -3.0)
    mesh.box(STEEL, -0.48, 2.35, 2.68, 4.36, -5.73, -5.67)
    for y in (2.82, 3.04, 3.26, 3.48, 3.70, 3.92, 4.14):
        mesh.box(METAL, -0.39, 2.25, y, y + 0.044, -5.76, -5.73)
    mesh.box(STEEL, 0.83, 0.91, 2.73, 4.30, -5.78, -5.72)
    mesh.box(OCHRE, 2.51, 2.6, 2.72, 4.42, -5.2, -3.0)
    for z in (-4.8, -4.55, -4.30, -4.05, -3.8):
        mesh.box(STEEL, 2.601, 2.618, 3.42, 4.12, z, z + 0.11)
    mesh.box(YELLOW, -3.57, 3.57, 3.27, 3.41, -6.20, -5.67)
    mesh.box(STEEL, -3.50, 3.50, 3.41, 3.45, -6.15, -5.7)
    mesh.box(YELLOW, -3.52, 3.52, 1.65, 2.03, -6.4, -5.92)
    for side in (-1, 1):
        mesh.box(STEEL, side * 2.72 - 0.44, side * 2.72 + 0.44, 2.08, 2.54, -6.0, -5.78)
        for offset in (-0.21, 0.21):
            x = side * 2.72 + offset
            mesh.box(LIGHT, x - 0.13, x + 0.13, 2.17, 2.43, -6.018, -6.001)
        mesh.pipe(STEEL, (side * 2.15, 1.54, -6.15), (side * 2.15, 1.9, -6.15), 0.10)
    mesh.parts.append("louvered radiator, engine cowl, bumper and four headlights")
    # Access ladder and tubular safety rails.
    for x in (-0.74, 0.12):
        mesh.pipe(YELLOW, (x, 0.70, -6.32), (x, 3.40, -6.13), 0.055)
        mesh.pipe(YELLOW, (x, 3.40, -6.13), (x, 4.43, -6.13), 0.05)
    for y in (0.80, 1.22, 1.64, 2.06, 2.48, 2.90, 3.32):
        z = -6.32 + (y - 0.7) * 0.19 / 2.7
        mesh.box(STEEL, -0.75, 0.13, y, y + 0.07, z - 0.11, z + 0.12)
    for x0, x1 in ((-3.49, -0.87), (0.30, 3.49)):
        mesh.pipe(YELLOW, (x0, 4.43, -6.08), (x1, 4.43, -6.08), 0.048)
        mesh.pipe(YELLOW, (x0, 3.94, -6.08), (x1, 3.94, -6.08), 0.032)
        for x in (x0, (x0 + x1) / 2, x1):
            mesh.pipe(YELLOW, (x, 3.41, -6.08), (x, 4.43, -6.08), 0.045)
    for side in (-1, 1):
        mesh.pipe(YELLOW, (side * 3.49, 4.43, -6.08), (side * 3.49, 4.43, -4.75), 0.048)
        mesh.pipe(YELLOW, (side * 3.49, 3.41, -4.75), (side * 3.49, 4.43, -4.75), 0.045)
    mesh.pipe(STEEL, (2.72, 3.08, -2.88), (2.72, 5.67, -2.88), 0.14, 12)
    mesh.pipe(METAL, (2.72, 4.1, -2.88), (2.72, 5.2, -2.88), 0.19, 12)
    mesh.pipe(STEEL, (1.87, 4.22, -3.18), (1.87, 5.20, -3.18), 0.22, 12)
    mesh.box(STEEL, 1.58, 2.16, 5.17, 5.28, -3.47, -2.89)
    for side in (-1, 1):
        mesh.pipe(OCHRE, (side * 1.5, 2.8, 5.8), (side * 2.2, 2.8, 5.8), 0.28, 12)
        mesh.box(STEEL, side * 3.1 - 0.65, side * 3.1 + 0.65, 0.64, 2.0, 5.2, 5.28)
        mesh.box(RED, side * 2.15 - 0.23, side * 2.15 + 0.23, 2.6, 2.78, 5.59, 5.65)
    mesh.parts.append("front access ladder, safety handrails, exhaust and rear mudflaps")
    for side in (-1, 1):
        build_tire(mesh, side * 3.16, -3.85, 0.62, side)
        build_tire(mesh, side * 3.24, 3.45, 0.52, side)
        build_tire(mesh, side * 2.12, 3.45, 0.52, side)
    mesh.parts.append("six rounded tires with individual chevron treads and bolted yellow hubs")


def add_ore(mesh):
    rng = random.Random(605)
    rows, columns = 19, 13
    grid = []
    for row in range(rows):
        t = row / (rows - 1)
        z, width = -1.58 + t * 7.55, 2.47
        for column in range(columns):
            u = column / (columns - 1)
            x = (2 * u - 1) * width
            mound = math.sin(math.pi * t) ** 0.6 * (1 - abs(2 * u - 1) ** 1.6)
            y = 4.10 + 1.66 * mound + rng.uniform(-0.13, 0.13) * math.sin(math.pi * t)
            grid.append((x, y, z))
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            for vertices in ((a, a + columns, a + 1), (a + 1, a + columns, a + columns + 1)):
                mesh.polygon(ORE, [grid[i] for i in vertices], (0, 1, 0))
    for i in range(34):
        row, column = rng.randrange(3, rows - 3), rng.randrange(2, columns - 2)
        center, radius = grid[row * columns + column], rng.uniform(0.13, 0.29)
        points = [add(center, (math.cos(k * math.tau / 5) * radius, rng.uniform(-0.02, 0.05),
                               math.sin(k * math.tau / 5) * radius)) for k in range(5)]
        peak = add(center, (radius * 0.14, radius * 0.65, -radius * 0.1))
        for k in range(5):
            mesh.polygon(ORE, (points[k], points[(k + 1) % 5], peak), (0, 1, 0))
    mesh.parts.append("faceted ore mound and individual rocks inside the open bed")


def validate_mesh(mesh):
    triangle_count, points = 0, []
    for group in mesh.groups.values():
        vertices, indices = group["vertices"], group["indices"]
        assert len(indices) % 3 == 0
        triangle_count += len(indices) // 3
        for vertex in vertices:
            assert all(math.isfinite(v) for v in vertex)
            assert abs(dot(vertex[3:], vertex[3:]) - 1) < 1e-6
            points.append(vertex[:3])
        for i in range(0, len(indices), 3):
            a, b, c = [vertices[indices[i + j]] for j in range(3)]
            face_normal = cross(sub(b[:3], a[:3]), sub(c[:3], a[:3]))
            assert dot(face_normal, face_normal) > 1e-16
            assert dot(face_normal, add(add(a[3:], b[3:]), c[3:])) > 0, "Inward vertex normal"
    bounds = [[min(p[i] for p in points) for i in range(3)],
              [max(p[i] for p in points) for i in range(3)]]
    assert abs(bounds[0][1]) < 0.002, bounds
    return {"triangles": triangle_count, "vertices": sum(len(g["vertices"]) for g in mesh.groups.values()),
            "bounds": bounds}


def encode_glb(mesh, loaded):
    # Actual tread contact sits at Y=0, with no invisible transform node.
    floor = min(v[1] for g in mesh.groups.values() for v in g["vertices"])
    for group in mesh.groups.values():
        group["vertices"] = [(v[0], v[1] - floor, *v[2:]) for v in group["vertices"]]
    statistics = validate_mesh(mesh)
    gltf = {
        "asset": {"version": "2.0", "generator": "EMC detailed haul truck builder",
                  "extras": {"variant": "loaded" if loaded else "empty", "forward": "-Z", "up": "+Y",
                             "units": "metres", **statistics}},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "Yellow rigid mining haul truck", "mesh": 0}],
        "meshes": [{"name": "haul-truck-loaded" if loaded else "haul-truck-empty",
                    "primitives": [], "extras": {"parts": mesh.parts}}],
        "materials": MATERIALS, "buffers": [], "bufferViews": [], "accessors": [],
    }
    blob = bytearray()

    def accessor(data, component, kind, count, target, bounds=None, stride=None):
        blob.extend(b"\0" * (-len(blob) % 4))
        view = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target}
        if stride:
            view["byteStride"] = stride
        gltf["bufferViews"].append(view)
        blob.extend(data)
        item = {"bufferView": len(gltf["bufferViews"]) - 1, "componentType": component,
                "count": count, "type": kind}
        if bounds:
            item.update({"min": bounds[0], "max": bounds[1]})
        gltf["accessors"].append(item)
        return len(gltf["accessors"]) - 1

    for mat, group in sorted(mesh.groups.items()):
        vertices, indices = group["vertices"], group["indices"]
        vb = b"".join(struct.pack("<6f", *v) for v in vertices)
        bounds = [[min(v[i] for v in vertices) for i in range(3)],
                  [max(v[i] for v in vertices) for i in range(3)]]
        position = accessor(vb, 5126, "VEC3", len(vertices), 34962, bounds, 24)
        gltf["accessors"].append({
            "bufferView": gltf["accessors"][position]["bufferView"], "byteOffset": 12,
            "componentType": 5126, "count": len(vertices), "type": "VEC3"})
        normal = len(gltf["accessors"]) - 1
        component, fmt = (5123, "H") if len(vertices) < 65536 else (5125, "I")
        index = accessor(struct.pack("<" + fmt * len(indices), *indices),
                         component, "SCALAR", len(indices), 34963)
        gltf["meshes"][0]["primitives"].append({
            "attributes": {"POSITION": position, "NORMAL": normal},
            "indices": index, "material": mat, "mode": 4})
    gltf["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * (-len(js) % 4)
    blob.extend(b"\0" * (-len(blob) % 4))
    binary = (b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(blob))
              + struct.pack("<I4s", len(js), b"JSON") + js
              + struct.pack("<I4s", len(blob), b"BIN\0") + blob)
    return binary, statistics


def build():
    os.makedirs(OUT, exist_ok=True)
    reference_bounds = None
    for loaded in (False, True):
        mesh = Mesh()
        build_body(mesh)
        if loaded:
            add_ore(mesh)
        binary, statistics = encode_glb(mesh, loaded)
        if reference_bounds is not None:
            assert statistics["bounds"] == reference_bounds, "Load must not change the model scale"
        reference_bounds = statistics["bounds"]
        name = "truck-loaded.glb" if loaded else "truck.glb"
        with open(os.path.join(OUT, name), "wb") as output:
            output.write(binary)
        lo, hi = statistics["bounds"]
        print("%s: %s triangles, %s vertices, %.1f KB; %.2f W x %.2f H x %.2f L m"
              % (name, statistics["triangles"], statistics["vertices"], len(binary) / 1024,
                 hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))


if __name__ == "__main__":
    build()
