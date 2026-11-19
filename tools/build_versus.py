#!/usr/bin/env python3
"""versus.html 만들기: index.html을 그대로 복제하고 대전 모드 파일 3개를 덧붙인다.

index.html을 고쳤으면 이 스크립트를 다시 실행해 versus.html을 새로 만든다.
    python3 tools/build_versus.py
엔진 코드는 한 글자도 바꾸지 않는다(제목과 <head>/<body> 끝에 줄만 추가).
"""
import hashlib, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'index.html').read_text(encoding='utf-8')
parts = ['versus/vs.css', 'versus/vsengine.js', 'versus/vs.js', 'versus/fbconfig.js']
ver = hashlib.sha1(b''.join((root / p).read_bytes() for p in parts) + src.encode()).hexdigest()[:8]

def once(s, old, new):
    if s.count(old) != 1:
        sys.exit(f'index.html에서 "{old[:40]}"를 정확히 한 번 찾지 못했어요')
    return s.replace(old, new)

title_start = src.index('<title>'); title_end = src.index('</title>') + len('</title>')
out = src[:title_start] + '<title>FLAG GAME 대전</title>' + src[title_end:]
out = once(out, '</head>', f'<link rel="stylesheet" href="versus/vs.css?v={ver}">\n</head>')
tail = out.rindex('</body>')
out = (out[:tail]
       + f'<script src="versus/vsengine.js?v={ver}"></script>\n'
       + f'<script type="module" src="versus/vs.js?v={ver}"></script>\n'
       + out[tail:])
first_nl = out.index('\n')
out = out[:first_nl] + '\n<!-- 자동 생성 파일: tools/build_versus.py (index.html 복제 + 대전 모드). 직접 고치지 말 것 -->' + out[first_nl:]
(root / 'versus.html').write_text(out, encoding='utf-8')
print(f'versus.html 만듦 (v={ver}, {len(out):,} bytes)')
