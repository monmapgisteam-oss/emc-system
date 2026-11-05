"""Build a seamless flowing-water texture for the tailings inspection surface.

Requires numpy, Pillow and imageio_ffmpeg. Run with --preview to render only
the poster and normal map; otherwise also writes a six-second H.264 loop.
U is the flow direction. Spatial and temporal frequencies are integral, so
both texture boundaries and the video loop meet without a visible jump.
"""
from pathlib import Path
import argparse
import math
import subprocess

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
WIDTH, HEIGHT, FPS, SECONDS = 512, 256, 24, 6
TAU = math.tau
U, V = np.meshgrid(np.arange(WIDTH, dtype=np.float32) / WIDTH,
                   np.arange(HEIGHT, dtype=np.float32) / HEIGHT)


def smoothstep(lo, hi, values):
    t = np.clip((values - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def field(x, y, time, seed, count=12):
    rng = np.random.default_rng(seed)
    values = np.zeros_like(x)
    for i in range(count):
        kx = int(rng.integers(1, 3 + i))
        ky = int(rng.integers(-3 - i // 2, 4 + i // 2)) or 1
        amplitude = (kx * kx + ky * ky) ** -0.57
        phase = rng.uniform(0, TAU)
        drift = int(rng.integers(-1, 2))
        values += amplitude * np.sin(TAU * (kx * x + ky * y + time * drift) + phase)
    return values


def water_coordinates(time):
    """Advect and deform the tile without sliding rigid decal shapes."""
    advected = U - time
    x = advected + 0.045 * np.sin(TAU * (2 * advected + V + time))
    x += 0.022 * np.sin(TAU * (-advected + 3 * V - time))
    y = V + 0.05 * np.sin(TAU * (advected - 2 * V + time))
    y += 0.018 * np.sin(TAU * (3 * advected + V + 2 * time))
    return x, y


def water_body():
    """Soft color variation for submerged volume, without surface reflections."""
    x, y = water_coordinates(0)
    tint = smoothstep(-0.5, 0.55, field(x, y, 0, 41, 7))
    deep = np.array((7, 42, 40), dtype=np.float32)
    shallow = np.array((17, 77, 67), dtype=np.float32)
    return np.uint8(deep + tint[..., None] * (shallow - deep))


def water_frame(time):
    x, y = water_coordinates(time)
    # Only broad wave modes reach the normal map: fine ripples previously
    # looked like wrinkled silver when seen through the inspection window.
    height = field(x, y, time, 18, 4)
    broad = field(x, y, time, 41, 5)
    # Broad, bright, irregular foam islands and broken loops. Their thickness
    # varies across the surface, so the texture does not become a web of hairlines.
    crest = field(x, y, time, 62, 5) + 0.035 * field(x, y, time, 83, 9)
    gate = field(x, y, time, 37, 5)
    width = 0.10 + 0.10 * smoothstep(-0.35, 0.4, broad)
    bands = 1 - smoothstep(width * 0.55, width * 1.10, np.abs(crest - 0.04))
    bands *= smoothstep(-0.12, 0.14, gate)
    islands = smoothstep(0.54, 0.70, crest) * smoothstep(-0.10, 0.15, broad)
    foam = np.clip(np.maximum(bands, islands) * 0.98, 0, 0.98)
    # Soft variation within each patch keeps it frothy instead of a solid decal.
    foam *= 0.79 + 0.21 * smoothstep(-0.25, 0.28, field(x, y, time, 91, 9))

    # Tile-safe derivatives give restrained highlights and a usable tangent
    # space normal map. Light is deliberately broad, not a neon outline.
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 2.3
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 1.15
    normal = np.stack((-dx, -dy, np.ones_like(height)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    light = np.array((0.32, -0.28, 0.905), dtype=np.float32)
    light /= np.linalg.norm(light)
    illumination = np.clip(normal @ light, 0, 1)
    sparkle = np.maximum(0, illumination - 0.88) ** 2 * 1.4
    tint = smoothstep(-0.5, 0.55, broad)
    deep = np.array((7, 41, 41), dtype=np.float32)
    shallow = np.array((18, 79, 72), dtype=np.float32)
    color = deep + tint[..., None] * (shallow - deep)
    color *= (0.68 + illumination[..., None] * 0.48)
    color += sparkle[..., None] * np.array((85, 116, 115))
    pale = np.array((238, 246, 238), dtype=np.float32)
    color = color * (1 - foam[..., None]) + pale * foam[..., None]
    return np.uint8(np.clip(color, 0, 255)), np.uint8(np.clip((normal + 1) * 127.5, 0, 255))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    poster, normals = water_frame(0)
    Image.fromarray(poster).save(OUT / "tailings-water.png", optimize=True)
    Image.fromarray(normals).save(OUT / "tailings-water-normal.png", optimize=True)
    Image.fromarray(water_body()).save(OUT / "tailings-water-body.png", optimize=True)
    # The analytic frame at t=1 must be the same as t=0. Check with a one-level
    # tolerance for floating-point trig, rather than adding a duplicated frame.
    loop_end, _ = water_frame(1)
    assert np.abs(poster.astype(np.int16) - loop_end.astype(np.int16)).max() <= 1
    if args.preview:
        print("Rendered tailings-water.png, tailings-water-normal.png and tailings-water-body.png")
        return
    import imageio_ffmpeg
    destinations = [OUT / "tailings-water.mp4", OUT / "tailings-water-normal.mp4"]
    processes = []
    for destination in destinations:
        command = [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
                   "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgb24",
                   "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-", "-an",
                   "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                   "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                   "-g", str(FPS * 2), str(destination)]
        processes.append(subprocess.Popen(command, stdin=subprocess.PIPE))
    try:
        for frame in range(FPS * SECONDS):
            pixels, normals = water_frame(frame / (FPS * SECONDS))
            for process, image in zip(processes, (pixels, normals)):
                process.stdin.write(image.tobytes())
    finally:
        for process in processes:
            process.stdin.close()
    for process, destination in zip(processes, destinations):
        if process.wait() != 0:
            raise RuntimeError(f"Water video encoding failed: {destination.name}")
        print(f"Rendered {destination.name}: {WIDTH}x{HEIGHT}, {SECONDS}s, {FPS}fps, "
              f"{destination.stat().st_size / 1024:.0f}KB; +U flow; seamless loop")


if __name__ == "__main__":
    main()
