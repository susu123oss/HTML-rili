import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('45.205.25.3', 22, 'root', '5GVMucOF0QcB')
stdin, stdout, stderr = c.exec_command('docker exec work-calendar-db-1 psql -U calendar -d calendar -c "SELECT id, user_id, memo_id, type, title, is_read FROM notifications ORDER BY id DESC LIMIT 10;"')
print(stdout.read().decode())
stdin, stdout, stderr = c.exec_command('docker exec work-calendar-db-1 psql -U calendar -d calendar -c "SELECT id, username, display_name, role FROM users WHERE id = 17;"')
print(stdout.read().decode())
c.close()
