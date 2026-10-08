"""像素风噜噜 → 游戏贴图（含棋盘格/白底去背 + 降色阶）"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r'D:/Games/外卖双人组/delivery-game/generated-images/Convert_this_3D_rendered_chara_2026-10-07T13-00-39.png'
DST = r'D:/Games/外卖双人组/delivery-game/src/assets/fanart/lulu/sprite-pixel.png'

im = Image.open(SRC).convert('RGB')
W0, H0 = im.size
print(f'原图: {W0}x{H0}')
arr = np.asarray(im).astype(int)
R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]

# ---- 背景：浅色（棋盘格灰白 + 纯白）----
light = (R > 200) & (G > 200) & (B > 200)
# 灰度（棋盘格的灰格）
mx = arr.max(-1); mn = arr.min(-1)
grayish = (mx - mn < 14) & (mx > 195)
cand = light | grayish
print(f'浅色候选背景: {cand.mean()*100:.1f}%')

# 只去掉"连通到画面边缘"的浅色
seed = np.zeros((H0, W0), bool)
seed[0, :] = seed[-1, :] = True
seed[:, 0] = seed[:, -1] = True
seed &= cand
bg = ndimage.binary_propagation(seed, mask=cand)
print(f'连到边缘的背景: {bg.mean()*100:.1f}%')

fg = ~bg
fg = ndimage.binary_closing(fg, np.ones((9, 9)), iterations=1)
fg = ndimage.binary_opening(fg, np.ones((5, 5)), iterations=1)
la, nc = ndimage.label(fg)
if nc > 1:
    sizes = ndimage.sum(fg, la, range(1, nc + 1))
    fg = (la == int(np.argmax(sizes)) + 1)
    print(f'连通域 {nc} → 最大 {int(sizes.max())}')
fg = ndimage.binary_fill_holes(fg)

ys, xs = np.where(fg)
minx, maxx, miny, maxy = xs.min(), xs.max(), ys.min(), ys.max()
cw, chh = int(maxx - minx + 1), int(maxy - miny + 1)
print(f'包围盒: x {minx}~{maxx} ({cw})  y {miny}~{maxy} ({chh})')

out = np.zeros((chh, cw, 4), np.uint8)
out[..., :3] = arr[miny:maxy + 1, minx:maxx + 1]
out[..., 3] = np.where(fg[miny:maxy + 1, minx:maxx + 1], 255, 0)
res = Image.fromarray(out, 'RGBA')

# ---- 先缩到目标像素尺寸（保持像素块感）----
sc = 128 / max(cw, chh)
tw, th = max(1, round(cw * sc)), max(1, round(chh * sc))
res = res.resize((tw, th), Image.LANCZOS)
a = np.asarray(res).copy()

# ---- ★ 降色阶（posterize）—— 让它更"像素风" ----
STEPS = 6                       # 每通道 6 级
rgb = a[..., :3].astype(float)
rgb = np.round(rgb / 255.0 * (STEPS - 1)) / (STEPS - 1) * 255
a[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)

# ---- alpha 二值化 + 边缘去白毛 ----
m = a[..., 3] >= 128
m2 = ndimage.binary_erosion(m, np.ones((3, 3)))
r2, g2, b2 = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
whitish = (r2 > 225) & (g2 > 225) & (b2 > 225)
rm = (m & ~m2) & whitish
m = m & ~rm
la, nc = ndimage.label(m)
if nc > 1:
    sizes = ndimage.sum(m, la, range(1, nc + 1))
    m = (la == int(np.argmax(sizes)) + 1)
m = ndimage.binary_fill_holes(m)
a[..., 3] = np.where(m, 255, 0).astype(np.uint8)

res = Image.fromarray(a, 'RGBA')
res.save(DST)
print(f'输出: {tw}x{th} -> {DST}')

# ---- 色数统计（像素风应该很少）----
uniq = {}
px = a[m][:, :3]
for c in px:
    k = tuple(int(v) // 16 * 16 for v in c)
    uniq[k] = uniq.get(k, 0) + 1
print(f'不同色阶块: {len(uniq)} 个')
print('前 10 主色:')
for k, v in sorted(uniq.items(), key=lambda e: -e[1])[:10]:
    print(f'  rgb{k}  {v/len(px)*100:5.1f}%')
