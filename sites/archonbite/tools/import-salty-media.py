"""Imports the Salty Pirates capture deliverables into the site (re-run after a new capture).

Source: the game repo's _Capture/archonbite/out (and clipN/f0000.png as video posters).
Writes web-sized WebP/JPEG into assets/salty-pirate/ and copies the loop videos unchanged into assets/salty-pirate/video/.
    python tools/import-salty-media.py [capture_dir]
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\eeren\Salty_Pirates\_Capture\archonbite")
OUT = Path(__file__).resolve().parent.parent / "assets" / "salty-pirate"
(OUT / "video").mkdir(parents=True, exist_ok=True)


def save(img, name, size, q=82):
    im = img.convert("RGB").resize(size, Image.LANCZOS)
    path = OUT / name
    if name.endswith(".jpg"):
        im.save(path, quality=q, optimize=True, progressive=True)
    else:
        im.save(path, quality=q, method=6)
    print(name, path.stat().st_size // 1024, "KB")


o = SRC / "out"
for i in range(1, 6):
    shot = Image.open(o / f"screenshot_{i:02d}_1920x1080.png")
    save(shot, f"shot-{i}.webp", (1600, 900))
    save(shot, f"shot-{i}-t.webp", (384, 216), 78)
key = Image.open(o / "key_art_1600x900.png")
save(key, "key-art.webp", (1600, 900), 84)
save(key, "key-art-bg.jpg", (480, 270), 70)  # only ever shown blurred
save(Image.open(o / "cover_small_920x430.png"), "capsule.webp", (920, 430), 84)
# share card: 1200x630 crop from the key art that carries the logo
kl = Image.open(o / "key_art_logo_1600x900.png").convert("RGB")
w, h = kl.size
crop_h = round(w * 630 / 1200)
top = (h - crop_h) // 2
save(kl.crop((0, top, w, top + crop_h)), "../img/og-salty-pirate.jpg", (1200, 630), 84)
loops = ["broadside", "cannons", "melee"]
for n, name in enumerate(loops, 1):
    for ext in ("webm", "mp4"):
        shutil.copyfile(o / f"loop_{n:02d}_{name}.{ext}", OUT / "video" / f"{name}.{ext}")
    poster = SRC / f"clip{n}" / "f0000.png"
    if poster.exists():
        p = Image.open(poster)
        save(p, f"video/{name}-poster.webp", (1280, 720), 78)
        save(p, f"video/{name}-t.webp", (384, 216), 76)
    print("video", name, (OUT / "video" / f"{name}.webm").stat().st_size // 1024, "KB webm,",
          (OUT / "video" / f"{name}.mp4").stat().st_size // 1024, "KB mp4")
