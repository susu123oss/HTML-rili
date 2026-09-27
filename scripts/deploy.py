#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能工作日历服务器部署脚本。

用途：
- 默认部署 frontend 页面、样式、脚本和静态资源，并重建 frontend 容器。
- 需要全量部署时加 --mode all。
- 服务器地址和密码通过命令行参数或环境变量提供。

Windows 示例：
cmd /c "python scripts\deploy.py --mode frontend --verify-public"

Linux / macOS 示例：
python3 scripts/deploy.py --mode frontend --verify-public
"""

import argparse
import os
import posixpath
import secrets
import sys
import time
from datetime import date
from pathlib import Path

import paramiko


def configure_output_encoding():
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    os.environ['PYTHONUTF8'] = '1'

    if os.name == 'nt':
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleCP(65001)
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except Exception:
            pass
        try:
            import subprocess
            subprocess.run(['cmd', '/c', 'chcp', '65001'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    for stream in (sys.stdout, sys.stderr):
        try:
            if hasattr(stream, 'reconfigure'):
                stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass


configure_output_encoding()

DEFAULT_HOST = ''
DEFAULT_PORT = 22
DEFAULT_USER = 'root'
DEFAULT_PASSWORD = ''
DEFAULT_REMOTE_DIR = '/opt/work-calendar'
DEFAULT_PUBLIC_PORT = '8090'

SKIP_DIRS = {'node_modules', '.git', 'dist', 'build', '__pycache__'}
SKIP_FILES = {'.DS_Store'}
FRONTEND_FILES = ['index.html', 'styles.css', 'app.js', 'nginx.conf', 'Dockerfile']
FRONTEND_ASSET_DIRS = ['css', 'libs', 'marked', 'webfonts']


def safe_print(text='', end='\n'):
    try:
        print(text, end=end, flush=True)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, 'encoding', None) or 'utf-8'
        print(str(text).encode(encoding, errors='replace').decode(encoding, errors='replace'), end=end, flush=True)


def safe_write(text):
    safe_print(text, end='')


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f'缺少环境变量：{name}')
    return value


def connect(args):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        args.host,
        port=args.port,
        username=args.user,
        password=args.password,
        timeout=20,
        banner_timeout=20,
        auth_timeout=20,
    )
    return client


def decode_chunk(data):
    return data.decode('utf-8', errors='replace')


def run(client, command, check=True):
    safe_print(f'\n$ {command}')
    stdin, stdout, stderr = client.exec_command(command)
    channel = stdout.channel
    out_parts = []
    err_parts = []

    while True:
        wrote = False
        if channel.recv_ready():
            text = decode_chunk(channel.recv(4096))
            out_parts.append(text)
            safe_write(text)
            wrote = True
        if channel.recv_stderr_ready():
            text = decode_chunk(channel.recv_stderr(4096))
            err_parts.append(text)
            safe_write(text)
            wrote = True
        if channel.exit_status_ready():
            while channel.recv_ready():
                text = decode_chunk(channel.recv(4096))
                out_parts.append(text)
                safe_write(text)
            while channel.recv_stderr_ready():
                text = decode_chunk(channel.recv_stderr(4096))
                err_parts.append(text)
                safe_write(text)
            break
        if not wrote:
            time.sleep(0.05)

    code = channel.recv_exit_status()
    out = ''.join(out_parts)
    err = ''.join(err_parts)
    if check and code != 0:
        raise RuntimeError(f'命令失败({code}): {command}')
    return code, out, err


def ensure_remote_dir(sftp, path):
    parts = path.strip('/').split('/')
    current = ''
    for part in parts:
        current = '/' + part if not current else current + '/' + part
        try:
            sftp.stat(current)
        except FileNotFoundError:
            sftp.mkdir(current)


def format_size(size):
    value = float(size or 0)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if value < 1024 or unit == 'GB':
            return f'{value:.1f}{unit}' if unit != 'B' else f'{int(value)}B'
        value /= 1024


def put_file(sftp, local_path, remote_path, root):
    relative_path = local_path.relative_to(root)
    last_percent = -1

    def progress(sent, total):
        nonlocal last_percent
        percent = int((sent / total) * 100) if total else 100
        if percent == last_percent and percent not in (0, 100):
            return
        last_percent = percent
        safe_write(f'\r上传：{relative_path} {percent:3d}% ({format_size(sent)}/{format_size(total)})')

    sftp.put(str(local_path), remote_path, callback=progress)
    safe_print()


def upload_tree(sftp, local_root, remote_root, display_root=None):
    root = display_root or local_root
    for item in local_root.iterdir():
        if item.name in SKIP_DIRS or item.name in SKIP_FILES:
            continue
        remote_path = posixpath.join(remote_root, item.name)
        if item.is_dir():
            ensure_remote_dir(sftp, remote_path)
            upload_tree(sftp, item, remote_path, root)
        else:
            put_file(sftp, item, remote_path, root)


def upload_frontend(sftp, project_root, remote_dir):
    local_frontend = project_root / 'frontend'
    remote_frontend = posixpath.join(remote_dir, 'frontend')
    ensure_remote_dir(sftp, remote_frontend)
    for name in FRONTEND_FILES:
        local_path = local_frontend / name
        if local_path.exists():
            put_file(sftp, local_path, posixpath.join(remote_frontend, name), project_root)

    for name in FRONTEND_ASSET_DIRS:
        local_path = local_frontend / name
        if local_path.exists() and local_path.is_dir():
            remote_path = posixpath.join(remote_frontend, name)
            ensure_remote_dir(sftp, remote_path)
            upload_tree(sftp, local_path, remote_path, project_root)


def patch_remote_compose(sftp, remote_dir, public_port, patch_secret):
    remote_compose = posixpath.join(remote_dir, 'docker-compose.yml')
    with sftp.open(remote_compose, 'r') as file:
        content = file.read().decode('utf-8')

    content = content.replace('"8080:80"', f'"{public_port}:80"')
    content = content.replace('"8090:80"', f'"{public_port}:80"')
    content = content.replace('8080:80', f'{public_port}:80')
    content = content.replace('8090:80', f'{public_port}:80')

    if patch_secret and '请上线前修改这个密钥' in content:
        content = content.replace('请上线前修改这个密钥', 'work-calendar-' + secrets.token_urlsafe(32))

    with sftp.open(remote_compose, 'w') as file:
        file.write(content.encode('utf-8'))


def verify_public(args):
    import urllib.request

    url = f'http://{args.host}:{args.public_port}/api/health'
    safe_print(f'\n公网验证：{url}')
    data = urllib.request.urlopen(url, timeout=12).read().decode('utf-8', errors='replace')
    safe_print(data)


def request_json(url, payload=None, headers=None, timeout=12):
    import json
    import urllib.request

    body = None if payload is None else json.dumps(payload).encode('utf-8')
    request_headers = {'Content-Type': 'application/json'} if payload is not None else {}
    request_headers.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=request_headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        text = response.read().decode('utf-8', errors='replace')
    return json.loads(text)


def verify_business_api(args):
    base_url = f'http://{args.host}:{args.public_port}/api'
    safe_print('\n业务接口验证：登录、部门、日历数据')

    login_data = request_json(
        f'{base_url}/auth/login',
        {
            'username': args.verify_username,
            'password': args.verify_password
        }
    )
    user = login_data.get('user') or {}
    token = login_data.get('token') or ''
    if not token:
        raise RuntimeError('业务接口验证失败：登录接口没有返回 token')

    department_name = user.get('departmentName') or ''
    safe_print(f'登录用户：{user.get("displayName") or user.get("username") or args.verify_username}')
    safe_print(f'登录部门：{department_name}')
    if args.verify_department and department_name != args.verify_department:
        raise RuntimeError(f'业务接口验证失败：部门应为 {args.verify_department}，实际为 {department_name}')

    verify_month = args.verify_month or date.today().strftime('%Y-%m')
    memos_data = request_json(
        f'{base_url}/memos?month={verify_month}&userId=all',
        headers={'Authorization': f'Bearer {token}'}
    )
    memos = memos_data.get('memos')
    if not isinstance(memos, list):
        raise RuntimeError('业务接口验证失败：日历接口没有返回 memos 数组')
    safe_print(f'日历月份：{verify_month}')
    safe_print(f'日历记录数：{len(memos)}')
    safe_print('业务接口验证通过')


def deploy(args):
    project_root = Path(args.project_root).resolve()
    if not (project_root / 'docker-compose.yml').exists():
        raise RuntimeError(f'项目根目录不正确：{project_root}')

    client = connect(args)
    try:
        run(client, 'docker --version && docker compose version')
        run(client, f'mkdir -p {args.remote_dir}')

        sftp = client.open_sftp()
        try:
            if args.mode == 'all':
                if args.clean:
                    run(
                        client,
                        f'rm -rf {args.remote_dir}/backend {args.remote_dir}/frontend {args.remote_dir}/docker-compose.yml {args.remote_dir}/README.md {args.remote_dir}/.gitignore {args.remote_dir}/scripts',
                    )
                upload_tree(sftp, project_root, args.remote_dir)
                patch_remote_compose(sftp, args.remote_dir, args.public_port, patch_secret=True)
            else:
                upload_frontend(sftp, project_root, args.remote_dir)
        finally:
            sftp.close()

        service = 'frontend' if args.mode == 'frontend' else ''
        run(client, f'cd {args.remote_dir} && COMPOSE_ANSI=never COMPOSE_PROGRESS=plain docker compose up -d --build {service}'.rstrip())
        run(client, f'cd {args.remote_dir} && docker compose ps')
        run(client, f'curl -fsS http://127.0.0.1:{args.public_port}/api/health')
    finally:
        client.close()

    if args.verify_public:
        verify_public(args)
        verify_business_api(args)


def parse_args():
    parser = argparse.ArgumentParser(description='部署智能工作日历服务器版')
    parser.add_argument('--mode', choices=['frontend', 'all'], default='frontend', help='frontend 只部署前端；all 全量部署')
    parser.add_argument('--host', default=os.environ.get('DEPLOY_HOST', DEFAULT_HOST), help='服务器 IP')
    parser.add_argument('--port', type=int, default=int(os.environ.get('DEPLOY_PORT', str(DEFAULT_PORT))), help='SSH 端口')
    parser.add_argument('--user', default=os.environ.get('DEPLOY_USER', DEFAULT_USER), help='SSH 用户名')
    parser.add_argument('--password', default=os.environ.get('DEPLOY_PASSWORD', DEFAULT_PASSWORD), help='SSH 密码')
    parser.add_argument('--remote-dir', default=os.environ.get('REMOTE_DIR', DEFAULT_REMOTE_DIR), help='服务器部署目录')
    parser.add_argument('--public-port', default=os.environ.get('PUBLIC_PORT', DEFAULT_PUBLIC_PORT), help='公网访问端口')
    parser.add_argument('--project-root', default=Path(__file__).resolve().parents[1], help='本地项目根目录')
    parser.add_argument('--clean', action='store_true', help='all 模式下先清理远程代码目录，不删除数据库 volume')
    parser.add_argument('--verify-public', action='store_true', help='部署后从本机访问公网健康接口，并验证登录部门和日历接口')
    parser.add_argument('--verify-username', default=os.environ.get('VERIFY_USERNAME', 'admin'), help='业务接口验证登录账号')
    parser.add_argument('--verify-password', default=os.environ.get('VERIFY_PASSWORD', '0000'), help='业务接口验证登录密码')
    parser.add_argument('--verify-department', default=os.environ.get('VERIFY_DEPARTMENT', '研发部'), help='业务接口验证预期部门，留空则只打印不校验')
    parser.add_argument('--verify-month', default=os.environ.get('VERIFY_MONTH', ''), help='业务接口验证月份，格式 YYYY-MM；默认当前月份')
    args = parser.parse_args()

    if not args.host:
        raise RuntimeError('缺少服务器 IP：请设置 DEPLOY_HOST 或传 --host')
    if not args.password:
        raise RuntimeError('缺少 SSH 密码：请设置 DEPLOY_PASSWORD 或传 --password')
    return args


if __name__ == '__main__':
    try:
        deploy(parse_args())
    except Exception as error:
        safe_print(f'部署失败：{error}')
        sys.exit(1)
