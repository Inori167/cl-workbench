# 在桌面创建两个快捷方式：工作台、记录终端
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

$items = @(
    @{ Name = 'CL 工作台.lnk';   Target = (Join-Path $root '打开工作台.cmd');   Desc = '打开 CL 工作台（历史记录可视化）' },
    @{ Name = 'CL 记录终端.lnk'; Target = (Join-Path $root '打开记录终端.cmd'); Desc = '打开会自动保存历史的终端' }
)

foreach ($item in $items) {
    $linkPath = Join-Path $desktop $item.Name
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = $item.Target
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = $item.Desc
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Host ("已创建: " + $linkPath) -ForegroundColor Green
}

Write-Host ''
Write-Host '桌面快捷方式创建完成。' -ForegroundColor Cyan