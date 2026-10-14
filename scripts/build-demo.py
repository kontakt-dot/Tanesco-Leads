import re, pathlib, base64, os
os.chdir('/home/claude/src/fluxora-leadops')
dist = pathlib.Path('dist/demo')
html = (dist/'demo.html').read_text()
js_name = re.search(r'src="/assets/(demo-[^"]+\.js)"', html).group(1)
css_name = re.search(r'href="/assets/(demo-[^"]+\.css)"', html).group(1)
js = (dist/'assets'/js_name).read_text().replace('</script', '<\\/script').replace('<!--', '<\\!--')
css = (dist/'assets'/css_name).read_text().replace('</style', '<\\/style')
import mimetypes
for path in sorted(pathlib.Path('client/public/brand').iterdir()):
    mime = 'image/svg+xml' if path.suffix == '.svg' else (mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
    data = base64.b64encode(path.read_bytes()).decode()
    js = js.replace('/brand/'+path.name, 'data:'+mime+';base64,'+data)
html = re.sub(r'<script type="module" crossorigin src="/assets/demo-[^"]+\.js"></script>', '', html)
html = re.sub(r'<link rel="stylesheet" crossorigin href="/assets/demo-[^"]+\.css">', lambda m: '<style>html,body{margin:0;background:#0b0c1e;color:#e2e8f0}</style><style>' + css + '</style>', html)
html = html.replace('</body>', '<script type="module">' + js + '</script></body>')
out = pathlib.Path('/mnt/user-data/outputs/tanesco-leads.html'); out.write_text(html)
pathlib.Path('/tmp/check.mjs').write_text(js)
print('built', round(out.stat().st_size/1024/1024,2), 'MB')