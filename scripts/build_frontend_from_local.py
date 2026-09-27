#!/usr/bin/env python3
"""
从本机版 HTML 生成服务器版前端底座。

保留本机版：
- head
- 内联 style
- body 里的全部 UI / 弹窗结构

替换：
- 去掉原本机版 IndexedDB 脚本
- 改为加载服务器版 frontend/app.js
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCAL_HTML = ROOT / '智能网页工作日历备忘录-插件本机版' / '智能网页工作日历备忘录-插件本机版.html'
SERVER_INDEX = ROOT / '智能网页工作日历备忘录-服务器版' / 'frontend' / 'index.html'

MARKER = '    <script>\n        // 数据库和全局变量'


def main():
    text = LOCAL_HTML.read_text(encoding='utf-8')
    if MARKER not in text:
        raise RuntimeError('没有找到本机版脚本起点，无法安全生成服务器版 HTML')

    html = text.split(MARKER)[0]
    html = html.replace('libs/highlight.js/11.8.0/', 'libs/highlight.js/11.9.0/')
    html += '    <script src="./app.js"></script>\n</body>\n</html>\n'
    SERVER_INDEX.write_text(html, encoding='utf-8', newline='\n')
    print(f'已生成：{SERVER_INDEX}')


if __name__ == '__main__':
    main()