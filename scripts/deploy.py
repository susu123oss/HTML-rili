#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智能工作日历服务器部署脚本（支持全自动极速增量部署）。

特性：
- 增量部署：通过单次远程 MD5 批量指纹对比，毫秒级跳过所有未修改文件，只上传变更文件。
- 自动排除：过滤 cad_output (20MB)、.git、node_modules、.venv 等无关内容，彻底根治上传缓慢。
- 智能构建：根据变动文件精准只重建前端或后端容器，无变动时不重复重构镜像。
- 提供 --force (强制全量上传) 与 --force-rebuild (强制重建镜像) 参数按需使用。

Windows 示例：
python scripts/deploy.py --mode all --verify-public

Linux / macOS 示例：
python3 scripts/deploy.py --mode all --verify-public
"""

import argparse
import hashlib
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

# 排除目录：坚决不上传本地 node_modules、git、CAD建模大文件(cad_output ~20MB)及虚拟环境
SKIP_DIRS = {
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    'cad_output', '.venv', 'venv', '.idea', '.vscode', '.gemini',
    '.pytest_cache', 'coverage', 'scratch'
}
SKIP_FILES = {'.DS_Store', 'Thumbs.db'}
FRONTEND_FILES = ['index.html', 'styles.css', 'theme.css', 'theme-init.js', 'app.js', 'nginx.conf', 'Dockerfile']
FRONTEND_ASSET_DIRS = ['css', 'libs', 'marked', 'webfonts', 'vendor']


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


def calculate_local_md5(local_path):
    h = hashlib.md5()
    try:
        with open(local_path, 'rb') as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest().lower()
    except Exception:
        return None


def fetch_remote_hashes(client, remote_dir):
    """
    通过单条远程命令批量获取服务器上现有文件的 MD5 指纹字典，
    毫秒级响应，避免每个文件逐个 stat 带来的网络 RTT 延迟。
    """
    safe_print('🔍 正在比对服务器现有文件指纹 (MD5)...')
    cmd = (
        f"cd {remote_dir} && find . -type f "
        "-not -path '*/.git/*' "
        "-not -path '*/node_modules/*' "
        "-not -path '*/cad_output/*' "
        "-not -path '*/__pycache__/*' "
        "-exec md5sum {} + 2>/dev/null"
    )
    stdin, stdout, stderr = client.exec_command(cmd)
    res = stdout.read().decode('utf-8', errors='replace')
    remote_map = {}
    for line in res.strip().splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2:
            md5_val, file_path = parts
            raw_path = file_path.strip().replace('\\', '/')
            clean_path = raw_path[2:] if raw_path.startswith('./') else raw_path
            remote_map[clean_path] = md5_val.lower()
    safe_print(f'✔ 远程已获取 {len(remote_map)} 个现有文件指纹')
    return remote_map


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
            return f'{value:.1f} {unit}' if unit != 'B' else f'{int(value)} B'
        value /= 1024


def compose_needs_update(local_path, remote_path, sftp):
    try:
        with sftp.open(remote_path, 'r') as rf:
            remote_text = rf.read().decode('utf-8').replace('\r\n', '\n')
        with open(local_path, 'r', encoding='utf-8') as lf:
            local_text = lf.read().replace('\r\n', '\n')
        import re
        re_secret = re.compile(r'JWT_SECRET:\s*["\'].*?["\']')
        clean_remote = re_secret.sub('JWT_SECRET: "***"', remote_text)
        clean_local = re_secret.sub('JWT_SECRET: "***"', local_text)
        return clean_remote.strip() != clean_local.strip()
    except Exception:
        return True


def put_file(sftp, local_path, remote_path, root, remote_hashes=None, stats=None, force=False):
    relative_path = local_path.relative_to(root).as_posix()

    # 特殊文件：docker-compose.yml 忽略服务端已生成的随机 JWT_SECRET 和 CRLF 差异
    if not force and relative_path == 'docker-compose.yml':
        if not compose_needs_update(local_path, remote_path, sftp):
            if stats is not None:
                stats['skipped'] += 1
            return False

    # 增量比对：若 MD5 一致则跳过上传
    if not force and remote_hashes is not None:
        local_md5 = calculate_local_md5(local_path)
        remote_md5 = remote_hashes.get(relative_path)
        if local_md5 and remote_md5 and local_md5 == remote_md5:
            if stats is not None:
                stats['skipped'] += 1
            return False

    file_size = local_path.stat().st_size
    sftp.put(str(local_path), remote_path)

    # 统一整齐排版输出：[上传] 相对路径 文件大小 ✔ 完成
    path_col = relative_path.ljust(38) if len(relative_path) < 38 else relative_path
    size_col = format_size(file_size).rjust(9)
    safe_print(f'  ↑ [上传] {path_col} {size_col}   ✔ 完成')

    if stats is not None:
        stats['uploaded'] += 1
        stats['uploaded_bytes'] = stats.get('uploaded_bytes', 0) + file_size
        stats['uploaded_files'].append(relative_path)
    return True


def upload_tree(sftp, local_root, remote_root, display_root=None, remote_hashes=None, stats=None, force=False):
    root = display_root or local_root
    for item in sorted(local_root.iterdir(), key=lambda x: (x.is_file(), x.name.lower())):
        if item.name in SKIP_DIRS or item.name in SKIP_FILES or item.name.endswith('.pyc') or item.name.endswith('.tmp'):
            continue
        remote_path = posixpath.join(remote_root, item.name)
        if item.is_dir():
            ensure_remote_dir(sftp, remote_path)
            upload_tree(sftp, item, remote_path, root, remote_hashes=remote_hashes, stats=stats, force=force)
        else:
            put_file(sftp, item, remote_path, root, remote_hashes=remote_hashes, stats=stats, force=force)


def upload_frontend(sftp, project_root, remote_dir, remote_hashes=None, stats=None, force=False):
    local_frontend = project_root / 'frontend'
    remote_frontend = posixpath.join(remote_dir, 'frontend')
    ensure_remote_dir(sftp, remote_frontend)
    for name in FRONTEND_FILES:
        local_path = local_frontend / name
        if local_path.exists():
            put_file(sftp, local_path, posixpath.join(remote_frontend, name), project_root, remote_hashes=remote_hashes, stats=stats, force=force)

    for name in FRONTEND_ASSET_DIRS:
        local_path = local_frontend / name
        if local_path.exists() and local_path.is_dir():
            remote_path = posixpath.join(remote_frontend, name)
            ensure_remote_dir(sftp, remote_path)
            upload_tree(sftp, local_path, remote_path, project_root, remote_hashes=remote_hashes, stats=stats, force=force)


def upload_backend(sftp, project_root, remote_dir, remote_hashes=None, stats=None, force=False):
    local_backend = project_root / 'backend'
    remote_backend = posixpath.join(remote_dir, 'backend')
    ensure_remote_dir(sftp, remote_backend)
    upload_tree(sftp, local_backend, remote_backend, project_root, remote_hashes=remote_hashes, stats=stats, force=force)


def patch_remote_compose(sftp, remote_dir, public_port, patch_secret):
    remote_compose = posixpath.join(remote_dir, 'docker-compose.yml')
    try:
        with sftp.open(remote_compose, 'r') as file:
            content = file.read().decode('utf-8')
    except Exception:
        return

    new_content = content
    new_content = new_content.replace('"8080:80"', f'"{public_port}:80"')
    new_content = new_content.replace('"8090:80"', f'"{public_port}:80"')
    new_content = new_content.replace('8080:80', f'{public_port}:80')
    new_content = new_content.replace('8090:80', f'{public_port}:80')

    if patch_secret and '请上线前修改这个密钥' in new_content:
        new_content = new_content.replace('请上线前修改这个密钥', 'work-calendar-' + secrets.token_urlsafe(32))

    if new_content != content:
        with sftp.open(remote_compose, 'w') as file:
            file.write(new_content.encode('utf-8'))


def verify_public(args):
    import urllib.request

    url = f'http://{args.host}:{args.public_port}/api/health'
    safe_print(f'\n🌐 公网健康检查：{url}')
    data = urllib.request.urlopen(url, timeout=12).read().decode('utf-8', errors='replace')
    safe_print(f'  ✔ 状态正常: {data.strip()}')


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
    safe_print('\n🔐 业务接口连通性验证：')

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
    user_display = user.get("displayName") or user.get("username") or args.verify_username
    safe_print(f'  • 登录鉴权: {user_display} (部门: {department_name or "未分配"})  ✔')
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
    safe_print(f'  • 数据同步: {verify_month} 月历 (获取到 {len(memos)} 条备忘记录)  ✔')
    safe_print('✨ 线上业务接口验证全部通过！\n')


def deploy(args):
    project_root = Path(args.project_root).resolve()
    if not (project_root / 'docker-compose.yml').exists():
        raise RuntimeError(f'项目根目录不正确：{project_root}')

    stats = {'uploaded': 0, 'skipped': 0, 'uploaded_files': [], 'uploaded_bytes': 0}

    safe_print(f'🚀 正在连接远程部署服务器 [{args.host}:{args.port}] (用户: {args.user})...')
    client = connect(args)
    safe_print('✔ SSH 连接成功\n')
    try:
        run(client, 'docker --version && docker compose version')
        run(client, f'mkdir -p {args.remote_dir}')

        # 获取远程文件 MD5 指纹字典（增量比对基准）
        use_incremental = not (args.force or args.clean)
        remote_hashes = fetch_remote_hashes(client, args.remote_dir) if use_incremental else {}

        safe_print(f'\n📦 增量同步文件传输中 (目标目录: {args.remote_dir})...')
        sftp = client.open_sftp()
        try:
            if args.mode == 'all':
                if args.clean:
                    run(
                        client,
                        f'rm -rf {args.remote_dir}/backend {args.remote_dir}/frontend {args.remote_dir}/docker-compose.yml {args.remote_dir}/README.md {args.remote_dir}/.gitignore {args.remote_dir}/scripts',
                    )
                    remote_hashes = {}
                upload_tree(sftp, project_root, args.remote_dir, remote_hashes=remote_hashes, stats=stats, force=args.force)
                patch_remote_compose(sftp, args.remote_dir, args.public_port, patch_secret=True)
            elif args.mode == 'backend':
                upload_backend(sftp, project_root, args.remote_dir, remote_hashes=remote_hashes, stats=stats, force=args.force)
            else:
                upload_frontend(sftp, project_root, args.remote_dir, remote_hashes=remote_hashes, stats=stats, force=args.force)
        finally:
            sftp.close()

        if stats['uploaded'] == 0:
            safe_print('  ⚡ 本地文件与远程完全一致，已跳过所有未更改文件')

        total_scanned = stats['uploaded'] + stats['skipped']
        uploaded_size_str = format_size(stats.get('uploaded_bytes', 0))
        safe_print('\n' + '-' * 64)
        safe_print('📊 增量检测汇总：')
        safe_print(f"  • 文件总计: {total_scanned} 个")
        safe_print(f"  • 增量上传: {stats['uploaded']} 个已更改文件 ({uploaded_size_str})")
        safe_print(f"  • 忽略跳过: {stats['skipped']} 个无变化文件")
        safe_print('-' * 64)

        # 智能分析需构建的服务
        uploaded = stats['uploaded_files']
        frontend_changed = any(f.startswith('frontend/') for f in uploaded)
        backend_changed = any(f.startswith('backend/') for f in uploaded)
        compose_changed = any(f == 'docker-compose.yml' for f in uploaded)

        if args.mode == 'frontend':
            target_services = 'frontend'
        elif args.mode == 'backend':
            target_services = 'backend'
        else: # mode == 'all'
            if compose_changed or (frontend_changed and backend_changed):
                target_services = ''
            elif frontend_changed:
                target_services = 'frontend'
            elif backend_changed:
                target_services = 'backend'
            else:
                target_services = None

        if stats['uploaded'] == 0 and not args.force_rebuild:
            safe_print('\n⚡ 本次无任何文件变动，跳过 Docker 镜像重建（如需强制重建请使用 --force-rebuild）')
            run(client, f'cd {args.remote_dir} && docker compose up -d')
        else:
            if target_services == 'frontend':
                safe_print('\n⚡ 检测到前端变动，定向重建 frontend 容器...')
                run(client, f'cd {args.remote_dir} && COMPOSE_ANSI=never COMPOSE_PROGRESS=plain docker compose up -d --build frontend')
            elif target_services == 'backend':
                safe_print('\n⚡ 检测到后端变动，定向重建 backend 容器...')
                run(client, f'cd {args.remote_dir} && COMPOSE_ANSI=never COMPOSE_PROGRESS=plain docker compose up -d --build backend')
            else:
                svc_arg = target_services if target_services is not None else ''
                safe_print(f'\n⚡ 正在构建并重启容器 [{svc_arg or "全部服务"}]...')
                run(client, f'cd {args.remote_dir} && COMPOSE_ANSI=never COMPOSE_PROGRESS=plain docker compose up -d --build {svc_arg}'.rstrip())

        run(client, f'cd {args.remote_dir} && docker compose ps')
        run(client, f'for i in $(seq 1 15); do curl -fsS http://127.0.0.1:{args.public_port}/api/health && break || sleep 1; done')
    finally:
        client.close()

    if args.verify_public:
        verify_public(args)
        verify_business_api(args)


def parse_args():
    parser = argparse.ArgumentParser(description='部署智能工作日历服务器版（支持全自动增量部署）')
    parser.add_argument('--mode', choices=['frontend', 'backend', 'all'], default='frontend', help='frontend 只部署前端；backend 只部署后端；all 全量扫描部署')
    parser.add_argument('--host', default=os.environ.get('DEPLOY_HOST', DEFAULT_HOST), help='服务器 IP')
    parser.add_argument('--port', type=int, default=int(os.environ.get('DEPLOY_PORT', str(DEFAULT_PORT))), help='SSH 端口')
    parser.add_argument('--user', default=os.environ.get('DEPLOY_USER', DEFAULT_USER), help='SSH 用户名')
    parser.add_argument('--password', default=os.environ.get('DEPLOY_PASSWORD', DEFAULT_PASSWORD), help='SSH 密码')
    parser.add_argument('--remote-dir', default=os.environ.get('REMOTE_DIR', DEFAULT_REMOTE_DIR), help='服务器部署目录')
    parser.add_argument('--public-port', default=os.environ.get('PUBLIC_PORT', DEFAULT_PUBLIC_PORT), help='公网访问端口')
    parser.add_argument('--project-root', default=Path(__file__).resolve().parents[1], help='本地项目根目录')
    parser.add_argument('--clean', action='store_true', help='all 模式下先清理远程代码目录，不删除数据库 volume')
    parser.add_argument('--force', action='store_true', help='强制全量上传所有文件，禁用 MD5 指纹跳过')
    parser.add_argument('--force-rebuild', action='store_true', help='强制重建 Docker 镜像，即使文件未发生改变')
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
