"""Expose storage capacity through empty read-only probes, preserving database mounts."""
import copy
import json
import posixpath
import re
import shlex
from datetime import datetime, timezone


def capture(client, command):
    _, stdout, stderr = client.exec_command(command, timeout=30)
    result = stdout.read().decode('utf-8', errors='replace').strip()
    error = stderr.read().decode('utf-8', errors='replace').strip()
    if stdout.channel.recv_exit_status() != 0:
        # Do not print compose content or environment variables on failure.
        raise RuntimeError('无法读取或验证服务器存储配置：' + error[:300])
    return result


def filesystem_rows(text):
    def unescape(value):
        return re.sub(r'\\([0-7]{3})', lambda match: chr(int(match[1], 8)), value)
    result = []
    for line in text.splitlines():
        values = line.split()
        if len(values) == 3:
            source, target, filesystem = map(unescape, values)
            result.append({'device': source.split('[', 1)[0], 'path': target, 'filesystem': filesystem})
    return result


def patch_compose_storage(compose, mounts, upload_mount=None, upload_environment=None):
    result = copy.deepcopy(compose)
    backend = result['services']['backend']
    existing = backend.get('volumes', [])
    def target(volume):
        if isinstance(volume, dict):
            return volume.get('target', '')
        parts = volume.split(':')
        return parts[1] if len(parts) > 1 else parts[0]
    backend['volumes'] = [volume for volume in existing if not target(volume).startswith('/run/calendar-storage/')]
    backend['volumes'].extend(mounts)
    if upload_mount:
        backend['volumes'] = [volume for volume in backend['volumes'] if target(volume) != upload_mount['target']]
        backend['volumes'].append(upload_mount)
        if not isinstance(backend.get('environment', {}), dict):
            raise RuntimeError('后端环境配置格式不受支持，停止修改上传目录')
        backend.setdefault('environment', {}).update(upload_environment)
    return result


def prepare_ops_storage(client, sftp, remote_dir):
    import yaml
    compose_path = posixpath.join(remote_dir, 'docker-compose.yml')
    with sftp.open(compose_path, 'r') as file:
        original = file.read().decode('utf-8')
    compose = yaml.safe_load(original)
    container_id = capture(client, 'docker compose -f ' + shlex.quote(compose_path) + ' ps -q db')
    if not container_id:
        return None  # The first deployment creates the database before configuring probes.
    if '\n' in container_id:
        raise RuntimeError('数据库容器未就绪，无法核对数据存放位置')
    mounts = json.loads(capture(client, 'docker inspect ' + shlex.quote(container_id) + " --format '{{json .Mounts}}'"))
    database_mount = next((mount for mount in mounts if mount['Destination'] == '/var/lib/postgresql/data'), None)
    if database_mount is None:
        raise RuntimeError('未识别数据库持久化目录，停止配置存储监控')

    rows = filesystem_rows(capture(client, 'findmnt -rn -o SOURCE,TARGET,FSTYPE'))
    disks = []
    devices = set()
    for row in sorted(rows, key=lambda item: (item['path'] != '/', item['path'])):
        if row['device'].startswith('/dev/') and row['device'] not in devices:
            devices.add(row['device'])
            disks.append(row)
    if not disks or disks[0]['path'] != '/':
        raise RuntimeError('未识别服务器系统盘，停止配置存储监控')

    data_disk = next((index for index, disk in enumerate(disks) if disk['path'] == '/data' and disk['device'] != disks[0]['device']), None)
    if data_disk is None:
        raise RuntimeError('数据盘 /data 未独立挂载，停止部署上传功能，避免资源写入系统盘')
    upload_root = '/data/work-calendar/uploads'
    capture(client, 'mkdir -p ' + shlex.quote(upload_root))
    sftp.chmod(upload_root, 0o750)
    upload_fs = filesystem_rows(capture(client, 'findmnt -rn -T ' + shlex.quote(upload_root) + ' -o SOURCE,TARGET,FSTYPE'))[0]
    if upload_fs['device'] != disks[data_disk]['device']:
        raise RuntimeError('上传资源目录不在数据盘，停止配置上传功能')

    locations = []
    for kind, label, host_path, container_path in [
        ('database', '日历数据库', database_mount['Source'], database_mount['Destination']),
        ('project', '项目文件', remote_dir, ''),
        ('uploads', '上传资源', upload_root, '/var/lib/work-calendar/uploads')
    ]:
        fs = filesystem_rows(capture(client, 'findmnt -rn -T ' + shlex.quote(host_path) + ' -o SOURCE,TARGET,FSTYPE'))[0]
        matching = next((index for index, disk in enumerate(disks) if disk['device'] == fs['device']), None)
        if matching is None:
            raise RuntimeError('未识别项目数据所在磁盘，停止配置存储监控')
        locations.append({'kind': kind, 'label': label, 'hostPath': host_path, 'containerPath': container_path, 'diskId': 'disk-' + str(matching)})

    config_dir = posixpath.join(remote_dir, '.ops-storage')
    capture(client, 'mkdir -p ' + shlex.quote(config_dir))
    sftp.chmod(config_dir, 0o700)
    monitor_mounts = []
    for index, disk in enumerate(disks):
        disk.update({'id': 'disk-' + str(index), 'label': '系统盘' if disk['path'] == '/' else '数据盘' if disk['path'] == '/data' else '存储分区'})
        disk['probePath'] = '/run/calendar-storage/' + disk['id']
        purposes = [location['label'] for location in locations if location['diskId'] == disk['id']]
        disk['purpose'] = '、'.join(purposes) if purposes else '未用于本项目的文件存储'
        probe = posixpath.join(config_dir, 'system-probe') if disk['path'] == '/' else posixpath.join(disk['path'], '.work-calendar-monitor')
        capture(client, 'mkdir -p ' + shlex.quote(probe))
        sftp.chmod(probe, 0o755)
        actual_probe = filesystem_rows(capture(client, 'findmnt -rn -T ' + shlex.quote(probe) + ' -o SOURCE,TARGET,FSTYPE'))[0]
        if actual_probe['device'] != disk['device']:
            raise RuntimeError('监控目录与目标磁盘不一致，停止配置存储监控')
        monitor_mounts.append({'type': 'bind', 'source': probe, 'target': disk['probePath'], 'read_only': True})

    layout = {'version': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'disks': disks, 'locations': locations}
    layout_path = posixpath.join(config_dir, 'layout.json')
    with sftp.open(layout_path, 'w') as file:
        file.write(json.dumps(layout, ensure_ascii=False, indent=2).encode('utf-8'))
    sftp.chmod(layout_path, 0o644)
    monitor_mounts.append({'type': 'bind', 'source': layout_path, 'target': '/run/calendar-storage/layout.json', 'read_only': True})

    upload_mount = {'type': 'bind', 'source': upload_root, 'target': '/var/lib/work-calendar/uploads', 'read_only': False, 'bind': {'create_host_path': False}}
    upload_environment = {'UPLOAD_DIR': '/var/lib/work-calendar/uploads', 'UPLOAD_DISK_PROBE': '/run/calendar-storage/disk-' + str(data_disk)}
    configured = patch_compose_storage(compose, monitor_mounts, upload_mount, upload_environment)
    if configured == compose:
        return False
    assert configured['services']['db'] == compose['services']['db']
    pending_path = posixpath.join(config_dir, 'compose-monitor.yml')
    content = yaml.safe_dump(configured, allow_unicode=True, sort_keys=False)
    with sftp.open(pending_path, 'w') as file:
        file.write(content.encode('utf-8'))
    sftp.chmod(pending_path, 0o600)
    capture(client, 'docker compose --project-directory ' + shlex.quote(remote_dir) + ' -f ' + shlex.quote(pending_path) + ' config --quiet')
    backup_path = posixpath.join(config_dir, 'compose-before-storage-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.yml')
    with sftp.open(backup_path, 'w') as file:
        file.write(original.encode('utf-8'))
    sftp.chmod(backup_path, 0o600)
    with sftp.open(compose_path, 'w') as file:
        file.write(content.encode('utf-8'))
    return True
