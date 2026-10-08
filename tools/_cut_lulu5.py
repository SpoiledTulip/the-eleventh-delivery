"""恐龙噜噜「用用户给的这张」→ 游戏贴图
源图已经是纯白底（255,255,255）的抠好图，只需去白底 + 裁切 + 缩放。
"""
import os, shutil
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r'C:\Users\spoiled tulip\.workbuddy\clipboard-images\clipboard-2026-10-07T12-55-25-634Z-8cb513c5.jpg'
OUTDIR = r'D:/Games/外卖双人组/delivery-game/src/assets/fanart/lulu'
DST = os.path.join(OUTDIR, 'sprite.png')
os.makedirs(OUTDIR, exist_ok=True)
shutil.copy(SRC, os.path.join(OUTDIR, 'reference.jpg'))

im = Image.open(SRC).convert('RGB')
W0, H0 = im.size
print(f'原图: {W0}x{H0}')

arr = np.asarray(im).astype(int)
R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]

# ---- 背景 = 接近纯白的像素 ----
# ⚠️ 阈值取 235：角色身上的白牙齿/白兔子在阴影下不会这么亮，
#    但由于白底是**纯 255**，用 235 足够宽松又安全。
white = (R > 235) & (G > 235) & (B > 235)
print(f'白底像素: {white.sum()} ({white.mean()*100:.1f}%)')

# ---- 从四边泛洪，只去掉"连到画面外"的白（防误伤角色内部的白）----
bg = np.zeros((H0, W0), bool)
seed = np.zeros((H0, W0), bool)
seed[0, :] = seed[-1, :] = True
seed[:, 0] = seed[:, -1] = True
seed &= white
bg = ndimage.binary_propagation(seed, mask=white)
print(f'连通到边缘的白底: {bg.sum()} ({bg.mean()*100:.1f}%)')

fg = ~bg
# 清理
fg = ndimage.binary_closing(fg, np.ones((7, 7)), iterations=1)
fg = ndimage.binary_opening(fg, np.ones((5, 5)), iterations=1)
la, nc = ndimage.label(fg)
if nc > 1:
    sizes = ndimage.sum(fg, la, range(1, nc + 1))
    fg = (la == int(np.argmax(sizes)) + 1)
    print(f'连通域 {nc} → 取最大 {int(sizes.max())}')
fg = ndimage.binary_fill_holes(fg)

ys, xs = np.where(fg)
minx, maxx, miny, maxy = xs.min(), xs.max(), ys.min(), ys.max()
cw, chh = int(maxx - minx + 1), int(maxy - miny + 1)
print(f'角色包围盒: x {minx}~{maxx} ({cw})  y {miny}~{maxy} ({chh})')

# ---- 输出 RGBA ----
out = np.zeros((chh, cw, 4), np.uint8)
out[..., :3] = arr[miny:maxy + 1, minx:maxx + 1]
out[..., 3] = np.where(fg[miny:maxy + 1, minx:maxx + 1], 255, 0)
res = Image.fromarray(out, 'RGBA')

# ---- 缩放到最长边 128（3D 渲染图 → LANCZOS 保平滑）----
sc = 128 / max(cw, chh)
tw, th = max(1, round(cw * sc)), max(1, round(chh * sc))
res = res.resize((tw, th), Image.LANCZOS)
a = np.asarray(res).copy()
a[..., 3] = np.where(a[..., 3] >= 128, 255, 0).astype(np.uint8)

# ---- 边缘羽化清理：去掉一圈半白毛边 ----
m = a[..., 3] >= 128
m2 = ndimage.binary_erosion(m, np.ones((3, 3)))
rgb = a[..., :3].astype(int)
r2, g2, b2 = rgb[..., 0], rgb[..., 1], rgb[..., 2]
whitish = (r2 > 230) & (g2 > 230) & (b2 > 230)
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

# ---- 配色统计 ----
import colorsys
px = a[m][:, :3]
bk = {}
for r, g, b_ in px:
    hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b_ / 255)
    hue = hh * 360
    if v < 0.2: k = '黑'
    elif s < 0.14: k = '白/灰'
    elif hue < 20 or hue >= 340: k = '红'
    elif hue < 45: k = '橙'
    elif hue < 70: k = '黄'
    elif hue < 165: k = '绿'
    elif hue < 265: k = '蓝'
    else: k = '紫粉'
    bk[k] = bk.get(k, 0) + 1
n = max(1, len(px))
print('配色:')
for k, v in sorted(bk.items(), key=lambda e: -e[1]):
    print(f'  {k:<8}{v/n*100:5.1f}%')
