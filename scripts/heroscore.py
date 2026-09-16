"""Score candidate hero frames on how quiet they are where the type sits.

The hero scrim is a vertical gradient: heavy at the very bottom (.92), light
through the middle (.30 at 30% down). The headline lands in that light band, so
that band is where a photograph either holds the type or fights it.

Two numbers per candidate, both measured after the same object-fit: cover crop
the browser will apply:

  busyness — mean local standard deviation of luminance inside the type band.
             High means fine detail (rooftops, parked cars, foliage) under the
             letterforms. This is what "too busy" actually is.
  contrast — mean luminance of the band, after the scrim. White type needs this
             low; anything above ~0.55 and the headline starts to dissolve.
"""
import glob, os, numpy as np
from PIL import Image

I = "/home/user/50CharlotteSquare/assets/img/"

def cover(im, tw, th):
    """Reproduce object-fit: cover for a viewport of tw x th."""
    w, h = im.size
    s = max(tw / w, th / h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    w, h = im.size
    return im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th))

def luma(a):
    return a[..., 0] * .2126 + a[..., 1] * .7152 + a[..., 2] * .0722

def scrim(h, phone):
    """The .hero::after gradient, sampled per row, as an alpha over near-black."""
    stops = [(0, .5), (.30, .3), (1, .92)] if phone else [(0, .42), (.38, .12), (1, .86)]
    y = np.linspace(0, 1, h)
    xs = [p for p, _ in stops]; ys = [v for _, v in stops]
    return np.interp(y, xs, ys)

def local_sd(g, k=9):
    """Mean local standard deviation over k x k windows, via integral images."""
    p  = np.pad(g, k // 2, mode="edge")
    c1 = np.cumsum(np.cumsum(p, 0), 1)
    c2 = np.cumsum(np.cumsum(p * p, 0), 1)
    def box(c):
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    m  = box(np.pad(c1, ((1, 0), (1, 0))))
    m2 = box(np.pad(c2, ((1, 0), (1, 0))))
    return float(np.sqrt(np.maximum(m2 - m * m, 0)).mean())

def score(path, phone=True):
    tw, th = (390, 844) if phone else (1440, 950)
    im = cover(Image.open(path).convert("RGB"), tw, th)
    a  = np.asarray(im, dtype=np.float32) / 255.0
    a  = a * (1 - scrim(th, phone)[:, None, None])        # apply the scrim
    g  = luma(a)
    # The headline band: where the type is and the scrim is thinnest.
    lo, hi = (int(th * .22), int(th * .58)) if phone else (int(th * .45), int(th * .80))
    band = g[lo:hi, :int(tw * .82)]                        # type is left-aligned
    return local_sd(band), float(band.mean())

cands = sorted(set(glob.glob(I + "hero-*.jpg")) | {
    I + "exterior-corner.jpg", I + "charlotte-street.jpg", I + "community-room.jpg",
    I + "lobby-corridor.jpg", I + "pocket-park-summer.jpg", I + "gallery-06.jpg",
    I + "detail-terrace.jpg", I + "terrace.jpg", I + "leasing-lounge.jpg"})

rows = []
for f in cands:
    im = Image.open(f)
    sd_p, mu_p = score(f, True)
    sd_d, mu_d = score(f, False)
    rows.append((os.path.basename(f), im.size, sd_p, mu_p, sd_d, mu_d))

rows.sort(key=lambda r: r[2])
print(f"{'frame':<26}{'source':>12}  {'phone busy':>10} {'lum':>6}   {'desk busy':>10} {'lum':>6}   verdict")
print("-" * 104)
for name, size, sp, mp, sd, md in rows:
    small = max(size) < 1600
    v = []
    if sp > .075: v.append("busy under the headline")
    if mp > .42:  v.append("too bright for white type")
    if small:     v.append(f"only {max(size)}px — too small for full-bleed")
    print(f"{name:<26}{f'{size[0]}x{size[1]}':>12}  {sp:>10.4f} {mp:>6.3f}   {sd:>10.4f} {md:>6.3f}   "
          + ("; ".join(v) if v else "CLEAN"))
