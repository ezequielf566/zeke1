
"""
PNG -> SVG converter tailored for *coloring book* apps.

What it does (per image):
1) Reads a high-res PNG (preferably white background, black line-art).
2) Binarizes and cleans small noise & gaps (Otsu + morphology).
3) Splits *solid black areas* (e.g., hair/beard/shoes) from *line art*.
4) Skeletonizes line art => single-pixel centerlines -> smooth polylines.
5) Writes an SVG with 3 groups:
   - <g id="solidos">   fill="#000" (kept solid)
   - <g id="pintavel">  fill="#fff" class="paintable" (optional white plate)
   - <g id="traco">     stroke="#000" stroke-width=1.5, round joins/caps
6) Preserves original pixel dimensions via viewBox (so it drops-in to your app).

Usage:
    python png2svg_colorbook.py --in ./input_png --out ./output_svg
    # Optional knobs:
    --stroke 1.5          # stroke width in px for lines
    --close 2             # morphological close kernel (gap fixing)
    --min-solid 2500      # min area (px) to treat as solid fill
    --paintplate on       # adds a single big white <rect> as paintable background

Dependencies:
    pip install opencv-python pillow numpy svgwrite scikit-image
"""

import os, argparse, math
import numpy as np
from PIL import Image, ImageOps
import cv2
import svgwrite
from skimage.morphology import skeletonize, remove_small_objects
from skimage.measure import find_contours

def imread_rgba(path):
    im = Image.open(path).convert("RGBA")
    return np.array(im)

def to_bw(img_rgba):
    # If transparent pixels exist, make them white in visible composite
    rgb = img_rgba[..., :3].astype(np.uint8)
    a   = img_rgba[..., 3:4].astype(np.float32)/255.0
    white = np.ones_like(rgb)*255
    comp = (rgb * a + white*(1.0-a)).astype(np.uint8)
    gray = cv2.cvtColor(comp, cv2.COLOR_RGB2GRAY)
    # Otsu to get black ink
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)
    return bw

def clean_bw(bw, close_kernel=2):
    if close_kernel>0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(close_kernel,close_kernel))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k, iterations=1)
    # remove specks
    nbw = (bw>0).astype(np.uint8)
    nbw = remove_small_objects(nbw.astype(bool), min_size=16, connectivity=2)
    return (nbw*255).astype(np.uint8)

def split_solids_and_lines(bw, min_solid=2500):
    # Find connected components to separate big solid areas from linework
    nlabels, labels, stats, _ = cv2.connectedComponentsWithStats(bw, connectivity=8)
    solids = np.zeros_like(bw)
    lines  = np.zeros_like(bw)
    for i in range(1, nlabels):
        area = stats[i, cv2.CC_STAT_AREA]
        mask = (labels==i)
        if area>=min_solid:
            solids[mask]=255
        else:
            lines[mask]=255
    return solids, lines

def to_paths_from_mask(mask):
    paths = []
    if np.count_nonzero(mask)==0:
        return paths
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        if len(cnt)<3: 
            continue
        # simplify a bit
        epsilon = 0.5
        approx = cv2.approxPolyDP(cnt, epsilon, True)
        # Build SVG path 'd'
        d = "M " + " ".join(f"{p[0][0]},{p[0][1]}" for p in approx) + " z"
        paths.append(d)
    return paths

def skeleton_to_polylines(lines_mask):
    if np.count_nonzero(lines_mask)==0:
        return []
    # skeletonize expects boolean (foreground True)
    sk = skeletonize(lines_mask>0)  # bool
    sk = (sk.astype(np.uint8))*255
    # Extract contours of the skeleton (1px wide) as polylines
    contours = find_contours(sk, level=128)  # returns list of (N,2) float arrays (row,col)
    polylines = []
    for c in contours:
        # Drop too short segments
        if len(c)<8:
            continue
        # Convert (row,col) -> (x,y)
        pts = [(float(xy[1]), float(xy[0])) for xy in c]
        polylines.append(pts)
    return polylines

def write_svg(svg_path, W, H, solid_paths, stroke_polylines, stroke_px=1.5, add_paint_plate=True):
    dwg = svgwrite.Drawing(svg_path, size=(W, H), profile='tiny')
    dwg.viewbox(0,0,W,H)

    if add_paint_plate:
        # A single big white plate so "bucket" works on background too
        dwg.add(dwg.rect(insert=(0,0), size=(W,H), fill="#ffffff", class_="paintable"))

    g_solids = dwg.g(id="solidos")
    for d in solid_paths:
        g_solids.add(dwg.path(d=d, fill="#000000", stroke="none"))
    dwg.add(g_solids)

    g_stroke = dwg.g(id="traco", stroke="#000000", fill="none",
                     **{"stroke-width":stroke_px, "stroke-linecap":"round", "stroke-linejoin":"round"})
    for poly in stroke_polylines:
        # Convert polyline to path
        if not poly: 
            continue
        d = "M " + " ".join(f"{x:.2f},{y:.2f}" for (x,y) in poly)
        g_stroke.add(dwg.path(d=d))
    dwg.add(g_stroke)

    dwg.save()

def process_one(png_path, out_svg, stroke_px=1.5, close_kernel=2, min_solid=2500, add_paint_plate=True):
    rgba = imread_rgba(png_path)
    H, W = rgba.shape[:2]
    bw   = to_bw(rgba)
    bw   = clean_bw(bw, close_kernel=close_kernel)
    solids, lines = split_solids_and_lines(bw, min_solid=min_solid)

    solid_paths = to_paths_from_mask(solids)
    stroke_polys = skeleton_to_polylines(lines)

    write_svg(out_svg, W, H, solid_paths, stroke_polys, stroke_px=stroke_px, add_paint_plate=add_paint_plate)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="Folder with PNGs")
    ap.add_argument("--out", dest="out", required=True, help="Folder for SVGs")
    ap.add_argument("--stroke", type=float, default=1.5, help="Stroke width in px")
    ap.add_argument("--close", type=int, default=2, help="Morph close kernel (gap fixing)")
    ap.add_argument("--min-solid", type=int, default=2500, help="Min area (px) as solid fill")
    ap.add_argument("--paintplate", choices=["on","off"], default="on", help="Add big white paintable plate")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    add_plate = (args.paintplate=="on")

    for name in sorted(os.listdir(args.inp)):
        if not name.lower().endswith((".png",".webp",".jpg",".jpeg")):
            continue
        ip = os.path.join(args.inp, name)
        op = os.path.join(args.out, os.path.splitext(name)[0]+".svg")
        print("->", name, "=>", os.path.basename(op))
        process_one(ip, op, stroke_px=args.stroke, close_kernel=args.close, min_solid=args.min_solid, add_paint_plate=add_plate)

if __name__=="__main__":
    main()
