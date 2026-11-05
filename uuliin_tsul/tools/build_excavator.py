# -*- coding: utf-8 -*-
"""Build a detailed yellow tracked excavator using Python's standard library.

Run ``python tools/build_excavator.py``. The shared truck module provides only
side-effect-free mesh/material/GLB helpers; its build entry point is not run.
Coordinates are metres, +Y up, -Z forward. Track contact is normalized to Y=0.
"""
import importlib.util
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "excavator.glb"
_spec = importlib.util.spec_from_file_location("emc_mesh_helpers", Path(__file__).with_name("build_truck.py"))
geometry = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(geometry)
Mesh = geometry.Mesh
YELLOW, OCHRE, RUBBER = geometry.YELLOW, geometry.OCHRE, geometry.RUBBER
STEEL, GLASS, METAL, LIGHT, RED = geometry.STEEL, geometry.GLASS, geometry.METAL, geometry.LIGHT, geometry.RED
add, sub, scale, unit, cross = geometry.add, geometry.sub, geometry.scale, geometry.unit, geometry.cross
# Excavator-only materials are appended to the encoded document. The imported
# truck builder's material list is never mutated.
SOIL, SOIL_LIGHT, SOIL_DARK = range(len(geometry.MATERIALS), len(geometry.MATERIALS) + 3)
SOIL_MATERIALS = [
    geometry.material("bucket-soil-brown", (0.30, 0.17, 0.075), 0.0, 1.0),
    geometry.material("bucket-soil-clumps", (0.43, 0.27, 0.12), 0.0, 1.0),
    geometry.material("bucket-soil-shade", (0.21, 0.115, 0.045), 0.0, 1.0),
]


def capsule(radius, straight=2.15, cy=0.84):
    """Clockwise yz capsule: top, rear arc, bottom, front arc."""
    points = []
    for i in range(16):
        points.append((cy + radius, -straight + 2 * straight * i / 16))
    for i in range(12):
        angle = math.pi / 2 - math.pi * i / 12
        points.append((cy + radius * math.sin(angle), straight + radius * math.cos(angle)))
    for i in range(16):
        points.append((cy - radius, straight - 2 * straight * i / 16))
    for i in range(12):
        angle = -math.pi / 2 - math.pi * i / 12
        points.append((cy + radius * math.sin(angle), -straight + radius * math.cos(angle)))
    return points


def belt_position(distance, radius=0.76, straight=2.15, cy=0.84):
    flat, arc = 2 * straight, math.pi * radius
    if distance < flat:
        return (cy + radius, -straight + distance), (0, 1)
    distance -= flat
    if distance < arc:
        angle = math.pi / 2 - distance / radius
        return (cy + radius * math.sin(angle), straight + radius * math.cos(angle)), (
            -math.cos(angle), math.sin(angle))
    distance -= arc
    if distance < flat:
        return (cy - radius, straight - distance), (0, -1)
    distance -= flat
    angle = -math.pi / 2 - distance / radius
    return (cy + radius * math.sin(angle), -straight + radius * math.cos(angle)), (
        -math.cos(angle), math.sin(angle))


def track(mesh, side):
    cx, half_width = side * 1.65, 0.51
    outer, inner = capsule(0.76), capsule(0.55)
    count = len(outer)
    for i in range(count):
        j = (i + 1) % count
        # Each track belt segment is closed; its exposed outer face carries a pad.
        vertices = [(cx + x, *point) for x in (-half_width, half_width)
                    for point in (outer[i], outer[j], inner[j], inner[i])]
        mesh.solid(RUBBER, vertices, ((0, 1, 2, 3), (4, 7, 6, 5),
                                     (0, 4, 5, 1), (1, 5, 6, 2),
                                     (2, 6, 7, 3), (3, 7, 4, 0)))
    perimeter = 8.6 + 2 * math.pi * 0.76
    for i in range(46):
        (y, z), (dy, dz) = belt_position((i + 0.5) * perimeter / 46)
        radial, along = (0, dz, -dy), (0, dy, dz)
        center = add((cx, y, z), scale(radial, 0.028))
        mesh.oriented_box(STEEL, center, (0.56, 0, 0), scale(radial, 0.035), scale(along, 0.12))
        mesh.oriented_box(METAL, add(center, scale(radial, 0.043)), (0.52, 0, 0),
                          scale(radial, 0.018), scale(along, 0.026))
        for sx in (-1, 1):
            mesh.pipe(STEEL, (cx + sx * 0.53, y, z), (cx + sx * 0.59, y, z), 0.052, 6)
    mesh.box(STEEL, cx - 0.27, cx + 0.27, 0.76, 1.27, -2.18, 2.18)
    for z in (-2.15, -1.3, -0.43, 0.43, 1.3, 2.15):
        radius = 0.59 if abs(z) > 2 else 0.42
        mesh.pipe(STEEL, (cx - 0.45, 0.82, z), (cx + 0.45, 0.82, z), radius, 24)
        face = cx + side * 0.467
        mesh.pipe(OCHRE, (face - 0.035, 0.82, z), (face + 0.035, 0.82, z), radius * 0.72, 20)
        mesh.pipe(STEEL, (face - 0.05, 0.82, z), (face + 0.05, 0.82, z), radius * 0.48, 20)
        mesh.pipe(METAL, (face - 0.065, 0.82, z), (face + 0.065, 0.82, z), 0.13, 12)
    for z in (-1.25, 1.25):
        mesh.pipe(STEEL, (cx - 0.4, 1.3, z), (cx + 0.4, 1.3, z), 0.2, 16)


def beam(mesh, mat, start, end, width, depth_start, depth_end):
    axis = unit(sub(end, start))
    across = (1, 0, 0)
    normal = unit(cross(axis, across))
    points = []
    for center, depth in ((start, depth_start), (end, depth_end)):
        points.extend(add(center, add(scale(across, sx * width / 2), scale(normal, sy * depth / 2)))
                      for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)))
    mesh.solid(mat, points, ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
                             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)))


def hydraulic(mesh, start, end, radius=0.11, piston=0.58):
    shaft = sub(end, start)
    join = add(start, scale(shaft, piston))
    mesh.pipe(STEEL, start, join, radius, 12)
    mesh.pipe(METAL, join, end, radius * 0.59, 12)
    for point in (start, end):
        mesh.pipe(OCHRE, add(point, (-0.12, 0, 0)), add(point, (0.12, 0, 0)), radius * 1.22, 12)


def pin(mesh, point, width, radius):
    mesh.pipe(OCHRE, add(point, (-width / 2, 0, 0)), add(point, (width / 2, 0, 0)), radius, 20)
    for side in (-1, 1):
        start = add(point, (side * (width / 2 - 0.01), 0, 0))
        end = add(point, (side * (width / 2 + 0.055), 0, 0))
        mesh.pipe(METAL, start, end, radius * 0.61, 16)


BUCKET_WRIST = (0.64, 1.72, -6.24)
BUCKET_CURL = math.radians(45)
BUCKET_PROFILE_SCALE = 0.62
BUCKET_MOUNT_DROP = 0.0
BUCKET_PROFILE = ((-6.14, 1.73), (-6.12, 0.93), (-6.49, 0.38),
                  (-7.10, 0.19), (-7.88, 0.35), (-7.88, 0.57))


def bucket_working_pose(point):
    """The accepted open scoop shape, before turning it toward the machine."""
    x, y, z = sub(point, BUCKET_WRIST)
    sine, cosine = math.sin(BUCKET_CURL), math.cos(BUCKET_CURL)
    return add(BUCKET_WRIST, (
        x, BUCKET_PROFILE_SCALE * (y * cosine + z * sine) - BUCKET_MOUNT_DROP,
        BUCKET_PROFILE_SCALE * (-y * sine + z * cosine)))


def bucket_pose(point):
    """Turn the complete scoop inward around the vertical axis at its wrist."""
    x, y, z = sub(bucket_working_pose(point), BUCKET_WRIST)
    return add(BUCKET_WRIST, (-x, y, -z))


def bucket_unpose(point):
    """Undo the working pose while constructing the unchanged cutting teeth."""
    x, y, z = sub(point, BUCKET_WRIST)
    y = (y + BUCKET_MOUNT_DROP) / BUCKET_PROFILE_SCALE
    z /= BUCKET_PROFILE_SCALE
    sine, cosine = math.sin(BUCKET_CURL), math.cos(BUCKET_CURL)
    return add(BUCKET_WRIST, (x, y * cosine - z * sine, y * sine + z * cosine))


def bucket_mouth():
    """Uncovered mouth plane from the back rim to the toothed cutting lip."""
    back = bucket_pose((0.64, 1.73, -6.14))
    lip = bucket_pose((0.64, 0.57, -7.88))
    opening = sub(lip, back)
    across = sub(bucket_pose((1.64, 1.73, -6.14)), back)
    return back, lip, unit(cross(across, opening))


def bucket_link_anchor(x, y, z):
    """Keep each linkage on its own side after the cup's half-turn."""
    return bucket_pose((2 * BUCKET_WRIST[0] - x, y, z))


def validate_bucket_cavity(bucket):
    """Validate the clean shell before adding the small soil residue."""
    back, lip, normal = bucket_mouth()
    triangles = []
    for mat, group in bucket.groups.items():
        # Check the intended outer/inner cheek directions, independently of
        # vertex normals that could otherwise repeat a mistaken face winding.
        for i in range(0, len(group["indices"]), 3):
            points = [group["vertices"][j][:3] for j in group["indices"][i:i + 3]]
            face_normal = cross(sub(points[1], points[0]), sub(points[2], points[0]))
            for side in (-1, 1):
                for half_width, face_mat, outward in ((0.95, YELLOW, side), (0.88, STEEL, -side)):
                    plane_x = 0.64 + side * half_width
                    on_profile = all(any(abs(point[1] - y) < 1e-7 and abs(point[2] - z) < 1e-7
                                         for z, y in BUCKET_PROFILE) for point in points)
                    if mat == face_mat and on_profile and all(abs(point[0] - plane_x) < 1e-7 for point in points):
                        assert face_normal[0] * outward > 0, "Reversed bucket cheek face"
        vertices = [bucket_pose(v[:3]) for v in group["vertices"]]
        for i in range(0, len(group["indices"]), 3):
            triangles.append((mat, *(vertices[j] for j in group["indices"][i:i + 3])))
    depths = []
    for fraction in (0.35, 0.5, 0.65):
        for x_offset in (-0.48, 0, 0.48):
            mouth_point = add(add(back, scale(sub(lip, back), fraction)), (x_offset, 0, 0))
            origin, direction = add(mouth_point, scale(normal, 0.8)), scale(normal, -1)
            hits = []
            for mat, a, b, c in triangles:
                edge1, edge2 = sub(b, a), sub(c, a)
                p = cross(direction, edge2)
                determinant = geometry.dot(edge1, p)
                if abs(determinant) < 1e-9:
                    continue
                inverse = 1 / determinant
                offset = sub(origin, a)
                u = geometry.dot(offset, p) * inverse
                q = cross(offset, edge1)
                v = geometry.dot(direction, q) * inverse
                distance = geometry.dot(edge2, q) * inverse
                if 0 <= u <= 1 and 0 <= v and u + v <= 1 and distance > 1e-7:
                    hits.append((distance, mat))
            assert hits, "Ray through the mouth must reach the scoop interior"
            distance, mat = min(hits)
            assert distance > 0.95, "A face is covering the bucket opening"
            assert mat == STEEL, "The first surface inside the mouth must be its steel lining"
            depths.append(distance - 0.8)
    return min(depths), max(depths)


def bucket_floor(z):
    """Height of the exposed liner along the lower curved bucket profile."""
    for (za, ya), (zb, yb) in zip(BUCKET_PROFILE[1:4], BUCKET_PROFILE[2:5]):
        if zb <= z <= za:
            return ya + (yb - ya) * (z - za) / (zb - za)
    raise ValueError("Soil must stay on the inner bucket floor")


def add_bucket_soil(bucket):
    """A small uneven residue against the liner, leaving most of the cup open."""
    xs = (0.10, 0.37, 0.64, 0.91, 1.18)
    zs = (-6.69, -6.86, -7.03, -7.20, -7.37)
    widths = (0.42, 0.84, 1.0, 0.82, 0.38)
    shifts = (0, 0.025, -0.025, 0.015, 0)
    heights = ((0.10, 0.16, 0.19, 0.15, 0.09),
               (0.14, 0.31, 0.35, 0.29, 0.13),
               (0.15, 0.34, 0.42, 0.32, 0.14),
               (0.13, 0.28, 0.34, 0.28, 0.12),
               (0.08, 0.15, 0.19, 0.14, 0.08))
    heights = tuple(tuple(height * 0.65 for height in row) for row in heights)
    # A small rounded footprint leaves exposed steel on every side. A broad
    # rectangular fill can read like another lid even when recessed.
    grid_x = [[0.64 + (x - 0.64) * widths[j] + shifts[j] for x in xs] for j in range(len(zs))]
    top = [[(x, bucket_floor(z) + heights[j][i], z) for i, x in enumerate(grid_x[j])]
           for j, z in enumerate(zs)]
    bottom = [[(x, bucket_floor(z) + 0.006, z) for x in grid_x[j]] for j, z in enumerate(zs)]
    volume = 0.0
    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            a, b, c, d = top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]
            material = SOIL_LIGHT if (i + j * 2) % 5 == 0 else SOIL
            bucket.polygon(material, (a, b, c, d), (0, 1, 0))
            bucket.polygon(SOIL_DARK, (bottom[j][i], bottom[j][i + 1],
                                     bottom[j + 1][i + 1], bottom[j + 1][i]), (0, -1, 0))
            # Both triangles use the same diagonal as the visible top surface.
            h0, h1 = heights[j][i], heights[j][i + 1]
            h2, h3 = heights[j + 1][i + 1], heights[j + 1][i]
            for p, q, r, thickness in ((a, b, c, (h0 + h1 + h2) / 3 - 0.006),
                                       (a, c, d, (h0 + h2 + h3) / 3 - 0.006)):
                area = abs((q[0] - p[0]) * (r[2] - p[2]) - (r[0] - p[0]) * (q[2] - p[2])) / 2
                volume += area * thickness
    for j in range(len(zs) - 1):
        for i, outward in ((0, (-1, 0, 0)), (len(xs) - 1, (1, 0, 0))):
            bucket.polygon(SOIL_DARK, (bottom[j][i], bottom[j + 1][i],
                                      top[j + 1][i], top[j][i]), outward)
    for j, outward in ((0, (0, 0, 1)), (len(zs) - 1, (0, 0, -1))):
        for i in range(len(xs) - 1):
            bucket.polygon(SOIL, (bottom[j][i], bottom[j][i + 1],
                                  top[j][i + 1], top[j][i]), outward)
    # A few small faceted clumps interrupt the residue surface. Their bases
    # intersect the residue, so they cannot read as floating rocks or a plug.
    for j, i, size in ((1, 1, 0.063), (1, 3, 0.052), (2, 2, 0.07),
                       (3, 1, 0.049), (3, 3, 0.056)):
        center = add(top[j][i], (0, -0.012, 0))
        points = [add(center, (math.cos(k * math.tau / 5) * size,
                              0, math.sin(k * math.tau / 5) * size * 0.8))
                  for k in range(5)]
        points.extend((add(center, (-size * 0.16, size * 0.8, size * 0.07)),
                       add(center, (0, -size * 0.35, 0))))
        faces = [(k, (k + 1) % 5, 5) for k in range(5)]
        faces.extend(((k + 1) % 5, k, 6) for k in range(5))
        bucket.solid(SOIL_LIGHT, points, faces)
        volume += math.pi * size * size * 0.8 * size * 0.8 / 3
    profile_area = abs(sum(BUCKET_PROFILE[i][0] * BUCKET_PROFILE[(i + 1) % len(BUCKET_PROFILE)][1]
                           - BUCKET_PROFILE[(i + 1) % len(BUCKET_PROFILE)][0] * BUCKET_PROFILE[i][1]
                           for i in range(len(BUCKET_PROFILE)))) / 2
    fill = volume / (profile_area * 1.76)
    assert 0.015 < fill < 0.06, "Only a little soil should remain in the open cup"
    back, _, normal = bucket_mouth()
    clearances = []
    for material in (SOIL, SOIL_LIGHT, SOIL_DARK):
        for point in bucket.groups[material]["vertices"]:
            assert -0.14 < point[0] < 1.42, "Soil must stay inside the cheeks"
            # Use the posed mouth, so this remains valid if the wrist angle changes.
            clearance = -geometry.dot(sub(bucket_pose(point[:3]), back), normal)
            assert clearance > 0.12, "Soil must remain recessed from the open mouth"
            clearances.append(clearance)
    return fill, min(clearances)


def attach_bucket(mesh, bucket):
    sine, cosine = math.sin(BUCKET_CURL), math.cos(BUCKET_CURL)
    lowest = math.inf
    # The side profile is shortened while keeping the full bucket width.
    # Normals use the inverse transpose of that non-uniform scale.
    for mat, group in bucket.groups.items():
        transformed = []
        for vertex in group["vertices"]:
            nx, ny, nz = vertex[3:]
            ny, nz = ny / BUCKET_PROFILE_SCALE, nz / BUCKET_PROFILE_SCALE
            normal = unit((nx, ny * cosine + nz * sine, -ny * sine + nz * cosine))
            normal = (-normal[0], normal[1], -normal[2])
            position = bucket_pose(vertex[:3])
            lowest = min(lowest, position[1])
            transformed.append((position, normal))
        for i in range(0, len(group["indices"]), 3):
            triangle = [transformed[index] for index in group["indices"][i:i + 3]]
            mesh.triangle(mat, *(vertex[0] for vertex in triangle),
                          normals=tuple(vertex[1] for vertex in triangle))
    # Bucket contact must never determine the model's ground normalization.
    assert lowest > 0.25, "Curled bucket must stay clear of the ground"
    assert bucket_mouth()[2][2] > 0.95, "The open cup must face the machine body"
    assert geometry.dot(bucket_mouth()[2], unit((0.65, 1, 1))) > 0.7, \
        "The cavity must remain open from the body-facing quarter"
    return lowest


def build_geometry():
    mesh = Mesh()
    for side in (-1, 1):
        track(mesh, side)
    mesh.box(STEEL, -1.52, 1.52, 0.92, 1.48, -1.38, 1.38)
    mesh.pipe(STEEL, (0, 1.45, 0), (0, 1.94, 0), 1.48, 40)
    mesh.pipe(OCHRE, (0, 1.85, 0), (0, 2.02, 0), 1.4, 40)
    mesh.box(YELLOW, -1.89, 1.89, 1.97, 2.18, -1.75, 2.58)
    mesh.parts.append("two continuous tracks with 92 individual pads, cleats, pins and twelve rollers")
    # Chamfered counterweight and the yellow engine enclosure.
    counter = [(-1.72, 0.55), (1.72, 0.55), (1.72, 2.22), (1.25, 2.82),
               (-1.25, 2.82), (-1.72, 2.22)]
    mesh.plate(YELLOW, [(x, 2.17, z) for x, z in counter], [(x, 3.37, z) for x, z in counter])
    mesh.box(OCHRE, -1.23, 1.23, 2.17, 2.43, 2.81, 2.87)
    mesh.box(STEEL, -0.9, 0.9, 2.5, 3.11, 2.823, 2.847)
    for x in (-0.7, -0.35, 0, 0.35, 0.7):
        mesh.box(YELLOW, x - 0.035, x + 0.035, 2.52, 3.09, 2.85, 2.872)
    mesh.box(YELLOW, 0.1, 1.68, 2.2, 3.2, -1.25, 0.68)
    mesh.box(STEEL, 1.686, 1.715, 2.44, 2.98, -0.98, 0.41)
    for z in (-0.85, -0.62, -0.39, -0.16, 0.07, 0.30):
        mesh.box(OCHRE, 1.717, 1.733, 2.47, 2.95, z, z + 0.045)
    mesh.box(STEEL, 0.23, 1.12, 3.205, 3.24, -0.75, 0.2)
    for x in (0.33, 0.51, 0.69, 0.87, 1.05):
        mesh.box(METAL, x, x + 0.025, 3.242, 3.26, -0.7, 0.14)
    mesh.pipe(STEEL, (1.13, 3.1, 1.25), (1.13, 4.01, 1.25), 0.105, 12)
    mesh.pipe(METAL, (1.13, 3.14, 1.25), (1.13, 3.66, 1.25), 0.14, 12)
    mesh.pipe(STEEL, (1.13, 4.01, 1.25), (1.13, 4.01, 1.48), 0.105, 12)
    mesh.parts.append("rounded yellow counterweight, louvered engine enclosure and exhaust")
    # Offset cab, sloped forward windshield and dark inset side door.
    mesh.box(YELLOW, -1.78, -0.18, 2.18, 2.74, -1.68, 0.76)
    bottom = [(-1.76, 2.7, -1.67), (-0.19, 2.7, -1.67),
              (-0.19, 2.7, 0.73), (-1.76, 2.7, 0.73)]
    top = [(-1.76, 4.16, -1.35), (-0.19, 4.16, -1.35),
           (-0.19, 4.16, 0.65), (-1.76, 4.16, 0.65)]
    mesh.plate(GLASS, bottom, top)
    mesh.box(YELLOW, -1.84, -0.12, 4.15, 4.31, -1.47, 0.82)
    for a, b in zip(bottom, top):
        mesh.pipe(STEEL, a, b, 0.064, 6)
    for points in (bottom, top):
        for i in range(4):
            mesh.pipe(STEEL, points[i], points[(i + 1) % 4], 0.055, 6)
    mesh.pipe(STEEL, (-1.79, 2.72, -0.3), (-1.79, 4.15, -0.3), 0.045, 6)
    mesh.pipe(STEEL, (-1.79, 3.18, -1.6), (-1.79, 3.18, 0.69), 0.04, 6)
    mesh.pipe(STEEL, (-0.95, 2.78, -1.69), (-0.65, 3.6, -1.51), 0.023, 6)
    mesh.box(METAL, -1.81, -1.79, 2.96, 3.01, 0.03, 0.3)
    mesh.pipe(STEEL, (-1.75, 3.85, -1.35), (-2.06, 3.85, -1.63), 0.028, 6)
    mesh.box(STEEL, -2.15, -1.97, 3.63, 4.01, -1.7, -1.61)
    mesh.box(METAL, -2.13, -1.99, 3.66, 3.98, -1.713, -1.701)
    for x in (-1.55, -0.42):
        mesh.box(STEEL, x - 0.16, x + 0.16, 4.17, 4.36, -1.53, -1.41)
        mesh.box(LIGHT, x - 0.11, x + 0.11, 4.2, 4.32, -1.546, -1.533)
    mesh.box(STEEL, -2.03, -1.72, 1.64, 1.73, -1.62, -0.68)
    mesh.box(STEEL, -1.96, -1.72, 1.92, 2.01, -1.62, -0.68)
    mesh.pipe(STEEL, (-1.82, 2.08, -1.45), (-1.82, 3.1, -1.45), 0.035, 6)
    mesh.parts.append("offset glazed cab with sloped windshield, door frame, mirror and work lights")
    # Safety rails around the service deck.
    for x in (0.25, 1.57):
        mesh.pipe(STEEL, (x, 4.04, 0.95), (x, 4.04, 2.22), 0.035, 6)
        for z in (0.95, 1.58, 2.22):
            mesh.pipe(STEEL, (x, 3.37, z), (x, 4.04, z), 0.035, 6)
    mesh.pipe(STEEL, (0.25, 4.04, 2.22), (1.57, 4.04, 2.22), 0.035, 6)
    for x in (-1.1, 1.1):
        mesh.box(RED, x - 0.15, x + 0.15, 2.49, 2.66, 2.88, 2.903)
    # Articulated gooseneck boom and long tapered dipper, pointing forward -Z.
    root, bend, elbow, wrist = (0.64, 2.64, -0.68), (0.64, 4.76, -2.55), (
        0.64, 5.46, -4.76), (0.64, 1.72, -6.24)
    beam(mesh, YELLOW, root, bend, 0.78, 0.84, 0.78)
    beam(mesh, YELLOW, bend, elbow, 0.70, 0.78, 0.56)
    pin(mesh, bend, 0.76, 0.35)
    beam(mesh, YELLOW, elbow, wrist, 0.55, 0.64, 0.39)
    for point, width, radius in ((root, 1.0, 0.31), (elbow, 0.84, 0.27), (wrist, 0.79, 0.22)):
        pin(mesh, point, width, radius)
    for x in (0.13, 1.15):
        hydraulic(mesh, (x, 2.49, -1.0), (x, 4.35, -2.18), 0.13)
    hydraulic(mesh, (0.64, 4.12, -2.14), (0.64, 5.12, -4.16), 0.13)
    hydraulic(mesh, (0.64, 5.75, -4.56), (0.64, 2.78, -5.99), 0.12)
    for offset in (0, 0.09):
        hose = [(1.06 + offset, 2.81, -0.77), (1.06 + offset, 4.94, -2.48),
                (1.06 + offset, 5.66, -4.45), (1.01 + offset, 5.42, -4.91),
                (1.01 + offset, 2.15, -6.17)]
        for i in range(len(hose) - 1):
            mesh.pipe(RUBBER, hose[i], hose[i + 1], 0.026, 6)
    mesh.parts.append("articulated yellow boom and dipper with hinge pins, hydraulic cylinders and hoses")
    # Build an open scoop with a recessed liner, then add downward cutting teeth.
    bucket = Mesh()
    # Convex cheeks keep the flat fan-triangulated end caps consistently outward.
    profile = BUCKET_PROFILE
    for side in (-1, 1):
        outer = [(0.64 + side * 0.95, y, z) for z, y in profile]
        inner = [(0.64 + side * 0.88, y, z) for z, y in profile]
        bucket.plate(YELLOW, outer, inner, STEEL)
        # Low side cheeks and narrow rolled rims expose the recessed cavity.
        for a, b in ((0, 5),):
            bucket.pipe(YELLOW, outer[a], outer[b], 0.035, 8)
    for i in range(4):
        za, ya = profile[i]
        zb, yb = profile[i + 1]
        face = [(-0.24, ya, za), (1.52, ya, za), (1.52, yb, zb), (-0.24, yb, zb)]
        normal = unit((0, zb - za, -(yb - ya)))
        bucket.plate(STEEL, face, [add(p, scale(normal, 0.07)) for p in face], YELLOW)
    bucket.pipe(YELLOW, (-0.31, 1.73, -6.14), (1.59, 1.73, -6.14), 0.035, 10)
    bucket.box(METAL, -0.31, 1.59, 0.34, 0.56, -7.93, -7.7)
    tooth_direction = unit((0, -0.275, 0.03))
    assert tooth_direction[1] < -0.99, "Cutting teeth must point down"
    for i in range(5):
        x = -0.16 + i * 0.40
        root = bucket_working_pose((x, 0.46, -7.82))
        # Tooth roots overlap the cutting bar. Their tips point down independently
        # of the scoop curl, so showing the cavity does not turn the teeth upward.
        points = [bucket_unpose(add(root, offset)) for offset in (
            (-0.13, 0.055, -0.085), (0.13, 0.055, -0.085),
            (0.13, 0.055, 0.085), (-0.13, 0.055, 0.085),
            (-0.07, -0.22, -0.065), (0.07, -0.22, -0.065),
            (0.07, -0.22, 0.005), (-0.07, -0.22, 0.005))]
        bucket.solid(METAL, points, ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
                                     (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)))
    cavity_depth = validate_bucket_cavity(bucket)
    soil_fill, soil_clearance = add_bucket_soil(bucket)
    bucket_clearance = attach_bucket(mesh, bucket)
    # Short mounting ears straddle the dipper and connect its wrist pin to the
    # open bucket's back wall.
    for x in (0.24, 1.04):
        beam(mesh, OCHRE, (x, 1.72, -6.24), bucket_link_anchor(x, 1.50, -6.14),
             0.15, 0.19, 0.19)
    for x in (0.24, 1.04):
        beam(mesh, OCHRE, (x, 2.05, -6.11), bucket_link_anchor(x, 0.99, -6.12), 0.13, 0.17, 0.17)
    # Put the short curl cylinder beside the dipper rather than through it.
    pin(mesh, (0.64, 2.73, -5.99), 1.16, 0.095)
    hydraulic(mesh, (1.13, 2.73, -5.99), bucket_link_anchor(1.13, 0.99, -6.12), 0.095)
    mesh.parts.append("inward-facing open bucket with recessed steel lining, downward cutting teeth and a small brown soil residue")
    track_floor = min(v[1] for group in mesh.groups.values() for v in group["vertices"])
    mesh.bucket_stats = {"curlDegrees": math.degrees(BUCKET_CURL), "mouthNormal": bucket_mouth()[2],
                         "inwardRotationDegrees": 180,
                         "toothDirection": tooth_direction,
                         "cleanCavityDepth": cavity_depth, "soilFillFraction": soil_fill,
                         "soilMouthClearance": soil_clearance,
                         "bucketGroundClearance": bucket_clearance - track_floor}
    return mesh


def encode_glb(mesh):
    binary, stats = geometry.encode_glb(mesh, False)
    json_size = struct.unpack_from("<I", binary, 12)[0]
    doc = json.loads(binary[20:20 + json_size])
    binary_chunk = binary[20 + json_size:]
    doc["asset"]["generator"] = "EMC detailed tracked excavator builder"
    doc["asset"]["extras"].pop("variant", None)
    doc["asset"]["extras"]["equipment"] = "tracked-excavator"
    doc["asset"]["extras"]["bucket"] = mesh.bucket_stats
    doc["materials"].extend(SOIL_MATERIALS)
    doc["nodes"][0]["name"] = "Yellow tracked mining excavator"
    doc["meshes"][0]["name"] = "tracked-excavator"
    encoded = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    result = (b"glTF" + struct.pack("<II", 2, 12 + 8 + len(encoded) + len(binary_chunk))
              + struct.pack("<I4s", len(encoded), b"JSON") + encoded + binary_chunk)
    return result, stats


def build():
    mesh = build_geometry()
    binary, stats = encode_glb(mesh)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(binary)
    lo, hi = stats["bounds"]
    print("excavator.glb: %s triangles, %s vertices, %.1f KB; %.2f W x %.2f H x %.2f L m"
          % (stats["triangles"], stats["vertices"], len(binary) / 1024,
             hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))
    print("Forward -Z; up +Y; bottom Y=0; bounds %s" % stats["bounds"])
    print("Bucket: %s" % mesh.bucket_stats)


if __name__ == "__main__":
    build()
