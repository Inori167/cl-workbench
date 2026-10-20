@echo off
cd /d "%~dp0"
start "CL Workbench Recorder" powershell.exe -NoExit -ExecutionPolicy Bypass -File "%~dp0scripts\record-terminal.ps1"
exit /b 0