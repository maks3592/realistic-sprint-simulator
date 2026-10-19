import sys
from playwright.sync_api import sync_playwright
FONTS='/home/claude/sprint-git/www/fonts/'
def css():
    return """@font-face{font-family:'Exo 2';font-weight:800;src:url('file://%sexo-2-latin-800-normal.woff2')}
@font-face{font-family:'Exo 2';font-weight:700;src:url('file://%sexo-2-latin-700-normal.woff2')}
body{margin:0;background:transparent}"""%(FONTS,FONTS)
mark=open('/home/claude/sprint-git/docs/brand/mark.svg').read()
lock="""<html><style>%s .w{display:flex;align-items:center;gap:44px;padding:0;width:1600px;height:520px;background:#0a0a0a;border-radius:0;font-family:'Exo 2'}
.w svg{width:400px;height:400px;margin-left:60px;flex:none}.t{color:#f4f6fb;line-height:.92}
.a{font-weight:700;font-size:62px;letter-spacing:.46em;color:#ff5a36;margin-bottom:14px}
.b{font-weight:800;font-size:124px;letter-spacing:-.01em;text-transform:uppercase}</style>
<div class=w>%s<div class=t><div class=a>REALISTIC</div><div class=b>Sprint<br>Simulator</div></div></div></html>"""%(css(),mark)
with sync_playwright() as p:
    b=p.chromium.launch(args=['--allow-file-access-from-files'])
    pg=b.new_page(viewport={'width':1600,'height':520})
    open('/tmp/lock.html','w').write(lock); pg.goto('file:///tmp/lock.html'); pg.wait_for_timeout(1200)
    pg.screenshot(path='/home/claude/sprint-git/docs/brand/logo.png')
    pg2=b.new_page(viewport={'width':1024,'height':1024})
    pg2.set_content('<html><style>body{margin:0}svg{width:1024px;height:1024px;display:block}</style>'+mark+'</html>')
    pg2.screenshot(path='/home/claude/sprint-git/docs/brand/icon-1024.png',omit_background=True)
    b.close()
