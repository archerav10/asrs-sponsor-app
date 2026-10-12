import sys
D, I = sys.argv[1], sys.argv[2]
base = open(f'{D}/signup.html').read()
css_swaps = [
 ('.top{background:#1e4d2b;color:#fff;height:330px;padding:44px 56px;','.top{background:#1e4d2b;color:#fff;height:296px;padding:36px 56px;'),
 ('h1{font-weight:800;font-size:76px;line-height:1.02;margin-top:14px;max-width:720px}','h1{font-weight:800;font-size:68px;line-height:1.02;margin-top:12px;max-width:620px}'),
 ('.photos{display:flex;height:270px}','.photos{display:flex;height:200px}'),
 ('.body{display:flex;padding:36px 56px 0;gap:44px}','.body{display:flex;padding:28px 56px 0;gap:40px}'),
 ('.left h2{font-size:38px;font-weight:800;line-height:1.15;margin-bottom:22px}','.left h2{font-size:34px;font-weight:800;line-height:1.15;margin-bottom:18px}'),
 ('.item{display:flex;gap:20px;align-items:flex-start;margin-bottom:24px}','.item{display:flex;gap:18px;align-items:flex-start;margin-bottom:16px}'),
 ('.item b{display:block;font-size:30px;','.item b{display:block;font-size:28px;'),
 ('.item span{font-size:24px;','.item span{font-size:22px;'),
 ('.right{width:360px;text-align:center}','.right{width:300px;text-align:center}'),
 ('.qrbox{border:6px solid #1e4d2b;border-radius:22px;padding:18px;','.qrbox{border:6px solid #1e4d2b;border-radius:22px;padding:14px;'),
 ('.scan{font-weight:800;font-size:34px;margin-top:16px;','.scan{font-weight:800;font-size:31px;margin-top:10px;'),
]
for a, b in css_swaps:
    assert a in base, a
    base = base.replace(a, b)
strip_css = '''
.strip{position:absolute;left:56px;right:56px;bottom:128px;height:236px;border:4px solid #1e4d2b;border-radius:22px;display:flex;align-items:center;gap:26px;padding:18px 22px;background:#f7f5ee}
.strip .thumb{width:230px;height:194px;border-radius:14px;background-size:cover;background-position:center;flex-shrink:0}
.strip .txt{flex:1}
.pill{display:inline-block;background:#1e4d2b;color:#e4cd8e;font-weight:700;font-size:19px;letter-spacing:3px;padding:4px 14px;border-radius:999px;text-transform:uppercase}
.strip h3{font-size:30px;font-weight:800;line-height:1.15;margin:8px 0 6px;color:#111}
.strip p{font-size:21px;line-height:1.35;color:#444}
.vq{width:180px;text-align:center;flex-shrink:0}
.vq img{width:170px;display:block;margin:0 auto;border:3px solid #1e4d2b;border-radius:12px;padding:6px;background:#fff}
.vq div{font-weight:800;font-size:19px;color:#1e4d2b;margin-top:6px;line-height:1.2}
</style>'''
base = base.replace('</style>', strip_css, 1)

variants = {
 'greater-reach': dict(qr='qr_gr.png', vqr='qr_reigel.png', thumb=f'{I}/front.jpg', pill='Now Open',
    title='Sponsored Residential · Reigel Road, Emporia, VA',
    blurb='A quiet, accessible home built around outdoor living, small-town community, and strong family values.',
    cap='Scan to see<br>this home'),
 'general': dict(qr='qr.png', vqr='qr_all.png', thumb=f'{I}/highland-springs/front-exterior.jpg', pill='Current Openings',
    title='See every home with an opening',
    blurb='Photos, details, and one-tap text, email, or call — updated as soon as a home opens.',
    cap='Scan to see<br>all openings'),
}
for name, v in variants.items():
    s = base.replace(f'{D}/qr.png', f'{D}/{v["qr"]}')
    strip = (f'<div class="strip"><div class="thumb" style="background-image:url({v["thumb"]})"></div>'
             f'<div class="txt"><span class="pill">{v["pill"]}</span><h3>{v["title"]}</h3><p>{v["blurb"]}</p></div>'
             f'<div class="vq"><img src="{D}/{v["vqr"]}"><div>{v["cap"]}</div></div></div>\n<div class="foot">')
    s = s.replace('<div class="foot">', strip, 1)
    open(f'{D}/flyer_{name}.html', 'w').write(s)
print('ok')
