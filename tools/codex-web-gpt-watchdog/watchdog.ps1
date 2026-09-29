$ErrorActionPreference = 'Stop'
$launcher = 'C:\Program Files\Codex Web GPT\Codex Web GPT.exe'
$logDir = Join-Path $env:LOCALAPPDATA 'CodexWebGPTWatchdog'

$client = [System.Net.Sockets.TcpClient]::new()
try {
    $pending = $client.BeginConnect('127.0.0.1', 17841, $null, $null)
    if ($pending.AsyncWaitHandle.WaitOne(1500, $false)) {
        $client.EndConnect($pending)
        exit 0
    }
} catch {
    # Connection refused or timed out: check whether the launcher is running.
} finally {
    $client.Close()
}

if (Get-Process -Name 'Codex Web GPT' -ErrorAction SilentlyContinue) { exit 0 }
if (-not (Test-Path -LiteralPath $launcher)) { exit 1 }

Start-Process -FilePath $launcher -ArgumentList '--hidden' -WorkingDirectory (Split-Path $launcher)
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Add-Content -Path (Join-Path $logDir 'watchdog.log') -Value "$(Get-Date -Format o) Restarted Codex Web GPT launcher because the bridge and launcher were stopped."
