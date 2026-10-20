# CL 工作台 · 记录终端
# 每条命令实时追加写入磁盘；输出通过 Start-Transcript 持续记录。
# 即使窗口崩溃，已执行命令和历史记录也不会消失。

$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$dataDir = Join-Path $root 'data\terminals'
$psHistoryDir = Join-Path $root 'data\psreadline'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $psHistoryDir | Out-Null

# 统一使用 UTF-8，避免中文乱码
try { chcp 65001 > $null } catch {}
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}

$sessionId = [guid]::NewGuid().ToString()
$jsonlPath = Join-Path $dataDir ($sessionId + '.jsonl')
$metaPath = Join-Path $dataDir ($sessionId + '.meta.json')
$logPath = Join-Path $dataDir ($sessionId + '.log')
$startedAt = (Get-Date).ToString('o')
$startCwd = (Get-Location).Path

# 会话元数据：正常退出时补写 endedAt；崩溃时保持 null，界面会标记“异常结束”
$meta = [ordered]@{
    id        = $sessionId
    title     = $null
    shell     = 'Windows PowerShell ' + $PSVersionTable.PSVersion.ToString()
    cwd       = $startCwd
    pid       = $PID
    source    = 'launcher'
    startedAt = $startedAt
    endedAt   = $null
}
$metaJson = $meta | ConvertTo-Json -Compress
[IO.File]::WriteAllText($metaPath, $metaJson, [Text.UTF8Encoding]::new($false))

$global:__clWorkbench = @{
    Jsonl         = $jsonlPath
    Meta          = $metaPath
    Log           = $logPath
    LastHistoryId = -1
    Count         = 0
}
$global:__clMetaPath = $metaPath

# PowerShell 输入历史逐条保存：崩溃后上方向键仍可找回
try {
    Set-PSReadLineOption -HistorySavePath (Join-Path $psHistoryDir 'ConsoleHost_history.txt') -HistorySaveStyle SaveIncrementally
} catch {}

# 追加写入（共享读写，避免和查看器抢锁）
function Write-CLRecord([string]$line) {
    try {
        $enc = [Text.UTF8Encoding]::new($false)
        $fs = [IO.File]::Open($global:__clWorkbench.Jsonl, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
        $sw = [IO.StreamWriter]::new($fs, $enc)
        try { $sw.WriteLine($line) } finally { $sw.Dispose(); $fs.Dispose() }
    } catch {}
}

# 自定义提示符：在每条命令结束后立即把命令、时间、目录、成败写入磁盘
function global:prompt {
    $__ok = $?
    $__exitCode = $global:LASTEXITCODE
    try {
        $hist = Get-History -Count 1
        if ($null -ne $hist -and $hist.Id -ne $global:__clWorkbench.LastHistoryId) {
            $global:__clWorkbench.LastHistoryId = $hist.Id
            $record = [ordered]@{
                ts   = (Get-Date).ToString('o')
                type = 'cmd'
                cmd  = [string]$hist.CommandLine
                cwd  = (Get-Location).Path
                ok   = [bool]$__ok
            }
            if ($null -ne $__exitCode) { $record.exitCode = [int]$__exitCode }
            Write-CLRecord ($record | ConvertTo-Json -Compress)
            $global:__clWorkbench.Count = [int]$global:__clWorkbench.Count + 1
        }
    } catch {}
    return "PS $((Get-Location).Path)> "
}

# 输出录制
try {
    Start-Transcript -Path $logPath -Append -Force | Out-Null
} catch {}

# 正常退出时收尾
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    try {
        $m = Get-Content -Raw -LiteralPath $global:__clMetaPath | ConvertFrom-Json
        $m | Add-Member -NotePropertyName endedAt -NotePropertyValue ((Get-Date).ToString('o')) -Force
        $m | Add-Member -NotePropertyName commandCount -NotePropertyValue $global:__clWorkbench.Count -Force
        $json = $m | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($global:__clMetaPath, $json, [Text.UTF8Encoding]::new($false))
    } catch {}
    try { Stop-Transcript | Out-Null } catch {}
} | Out-Null

try { $Host.UI.RawUI.WindowTitle = 'CL 工作台 · 记录终端' } catch {}

Clear-Host
Write-Host ''
Write-Host '  CL 工作台 · 记录终端' -ForegroundColor Cyan
Write-Host '  ─────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host '  本次会话的命令与输出会实时写入磁盘，' -ForegroundColor Gray
Write-Host '  即使窗口崩溃，历史记录也不会丢失。' -ForegroundColor Gray
Write-Host ''
Write-Host '  查看记录：双击 "打开工作台.cmd"' -ForegroundColor DarkGray
Write-Host '  数据目录：' -NoNewline -ForegroundColor DarkGray
Write-Host (Join-Path $root 'data') -ForegroundColor DarkGray
Write-Host ''