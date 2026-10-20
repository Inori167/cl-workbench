@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [CL] Node.js was not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$up=$false; for($i=0;$i -lt 25;$i++){ try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4737/api/health' -TimeoutSec 1 | Out-Null; $up=$true; break } catch { if($i -eq 0){ Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden }; Start-Sleep -Milliseconds 250 } }; if(-not $up){ exit 1 }"
if errorlevel 1 (
  echo.
  echo  [CL] The server did not start. Run "node server.js" in this folder to see the error.
  echo.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4737"
exit /b 0