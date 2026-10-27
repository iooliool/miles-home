#!/usr/bin/env python3
"""本地测小屋用的静态服务，支持 Range（跟 GitHub Pages 一样能拖进度；python -m http.server 不支持，拖不了）。
用法：python3 tools/fm/serve_range.py 8766   # 在仓库根目录下跑
"""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class H(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng)
        size = os.path.getsize(path)
        a = int(m.group(1)) if m and m.group(1) else 0
        b = int(m.group(2)) if m and m.group(2) else size - 1
        b = min(b, size - 1)
        if a > b:
            self.send_error(416)
            return None
        f = open(path, 'rb')
        f.seek(a)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, size))
        self.send_header('Content-Length', str(b - a + 1))
        self.end_headers()
        self._left = b - a + 1
        return f

    def copyfile(self, src, out):
        left = getattr(self, '_left', None)
        if left is None:
            return super().copyfile(src, out)
        while left > 0:
            chunk = src.read(min(65536, left))
            if not chunk:
                break
            out.write(chunk)
            left -= len(chunk)

    def end_headers(self):
        if not self.headers.get('Range'):
            self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8766), H).serve_forever()
