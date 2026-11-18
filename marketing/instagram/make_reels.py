#!/usr/bin/env python3
"""The two Reels and the grid preview, from the PNGs render.cjs made.

Each Reel shot moves slowly across or into a photograph (sub-pixel, so the
motion is smooth), its caption fades up, shots cross-fade, and the end card
holds. 1080x1920, 30 fps, H.264, no sound: add a track from Instagram's own
library when posting, which is licensed for it.

  python3 marketing/instagram/make_reels.py           both Reels and the preview
  python3 marketing/instagram/make_reels.py preview   only the grid preview
Needs Pillow and ffmpeg.
"""
import os
import subprocess
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_instagram import GRID, REELS  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
IMG = os.path.join(HERE, "..", "..", "assets", "img")
W, H, FPS = 1080, 1920, 30
SHOT, FADE, END = 2.6, 0.5, 3.2       # seconds: each shot, each cross-fade, the end card


def ease(t):
    return t * t * (3 - 2 * t)


def shot_frames(src, move, n):
    """n frames of one photograph filling 1080x1920, moving as asked."""
    im = Image.open(src).convert("RGB")
    iw, ih = im.size
    # The largest 9:16 window that fits, then the move within the picture.
    if iw / ih > W / H:
        bh, bw = ih, ih * W / H
    else:
        bw, bh = iw, iw * H / W
    for f in range(n):
        t = ease(f / max(n - 1, 1))
        if move[0] == "pan":
            z = 1.0
            cw, ch = bw, bh
            free = iw - cw
            x0 = free * (move[1] + (move[2] - move[1]) * t)
            y0 = (ih - ch) / 2
        else:
            z = move[1] + (move[2] - move[1]) * t
            cw, ch = bw / z, bh / z
            x0 = (iw - cw) / 2
            y0 = (ih - ch) * 0.45
        yield im.transform((W, H), Image.Transform.EXTENT, (x0, y0, x0 + cw, y0 + ch), Image.Resampling.BICUBIC)


def with_caption(frame, cap, alpha, lift):
    if alpha <= 0:
        return frame
    c = cap if alpha >= 1 else cap.copy()
    if alpha < 1:
        a = c.getchannel("A").point(lambda v: int(v * alpha))
        c.putalpha(a)
    base = frame.convert("RGBA")
    base.alpha_composite(c, (0, int(lift)))
    return base.convert("RGB")


def make_reel(name, scenes):
    out = os.path.join(HERE, f"{name}.mp4")
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p",
                           "-profile:v", "high", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    n_shot = int((SHOT + FADE) * FPS)
    n_fade = int(FADE * FPS)
    end = Image.open(os.path.join(BUILD, "reel-endcard.png")).convert("RGB")
    prev_tail = None
    count = 0
    for i, (img, move, _, _) in enumerate(scenes, 1):
        cap = Image.open(os.path.join(BUILD, f"{name}-cap{i}.png")).convert("RGBA")
        frames = []
        for f, fr in enumerate(shot_frames(os.path.join(IMG, img), move, n_shot)):
            t = f / FPS
            a = min(max((t - 0.35) / 0.45, 0), 1)                 # caption fades up after the cut
            frames.append(with_caption(fr, cap, ease(a), 24 * (1 - ease(a))))
        if prev_tail:
            for k in range(n_fade):                              # cross-fade from the last shot
                frames[k] = Image.blend(prev_tail[k], frames[k], ease((k + 1) / (n_fade + 1)))
        body, prev_tail = frames[:-n_fade], frames[-n_fade:]
        for fr in body:
            ff.stdin.write(fr.tobytes()); count += 1
    # The end card: a slow push in, cross-faded from the last shot.
    n_end = int(END * FPS)
    for f in range(n_end):
        z = 1.0 + 0.025 * ease(f / (n_end - 1))
        cw, ch = W / z, H / z
        fr = end.transform((W, H), Image.Transform.EXTENT, ((W - cw) / 2, (H - ch) / 2, (W + cw) / 2, (H + ch) / 2),
                           Image.Resampling.BICUBIC)
        if f < n_fade:
            fr = Image.blend(prev_tail[f], fr, ease((f + 1) / (n_fade + 1)))
        ff.stdin.write(fr.tobytes()); count += 1
    ff.stdin.close()
    ff.wait()
    print(f"wrote {os.path.relpath(out)}  {count / FPS:.1f} s")
    # The cover the profile grid shows for this Reel.
    Image.open(os.path.join(BUILD, f"{name}-cover.png")).convert("RGB").save(
        os.path.join(HERE, f"{name}-cover.jpg"), quality=92)


def make_preview():
    """The nine posts as the profile shows them: the middle 3:4 of each, 2 px apart."""
    tile_w, gap = 360, 3
    tile_h = tile_w * 4 // 3
    sheet = Image.new("RGB", (tile_w * 3 + gap * 2, tile_h * 3 + gap * 2), "white")
    for i, (name, _) in enumerate(GRID):
        im = Image.open(os.path.join(BUILD, f"grid-{name}.png")).convert("RGB")
        cw = im.height * 3 / 4
        x0 = (im.width - cw) / 2
        im = im.crop((round(x0), 0, round(x0 + cw), im.height)).resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        sheet.paste(im, ((i % 3) * (tile_w + gap), (i // 3) * (tile_h + gap)))
    out = os.path.join(HERE, "grid-preview.jpg")
    sheet.save(out, quality=90)
    print("wrote", os.path.relpath(out))


def copy_posts():
    """The nine posts beside this file, named in posting order."""
    for name, _ in GRID:
        Image.open(os.path.join(BUILD, f"grid-{name}.png")).convert("RGB").save(
            os.path.join(HERE, f"post-{name}.jpg"), quality=94, subsampling=0)


if __name__ == "__main__":
    make_preview()
    copy_posts()
    if "preview" not in sys.argv[1:]:
        for name, scenes in REELS.items():
            make_reel(name, scenes)
