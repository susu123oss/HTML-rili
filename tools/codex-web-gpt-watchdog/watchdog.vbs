Option Explicit
Dim shell, scriptPath, command
Set shell = CreateObject("WScript.Shell")
scriptPath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CodexWebGPTWatchdog\watchdog.ps1"
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File " & Chr(34) & scriptPath & Chr(34)
shell.Run command, 0, True
