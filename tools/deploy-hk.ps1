<#
.SYNOPSIS
把本项目代码同步到香港服务器并重建正式容器（https://fit.yhyh0147.top/）。
需要本机 ~/.ssh/config 里的 Host hk（已配置密钥）。不会上传 .env、.git、node_modules、output 等。
#>
param(
    [string]$SshHost = "hk"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Pkg = Join-Path $env:TEMP "thin-muscle-release.tgz"
if (Test-Path $Pkg) { Remove-Item $Pkg -Force }

Write-Host "[1/3] 打包代码..."
& tar.exe -czf $Pkg -C $Root `
    --exclude=./.git --exclude=node_modules --exclude=./output --exclude=./.playwright-cli `
    --exclude=./.superpowers --exclude=./.codeartsdoer --exclude=./docs `
    --exclude=*.bak-before-hk-* --exclude=./.env --exclude=./.env.* --exclude=*.log .
if ($LASTEXITCODE -ne 0) { throw "打包失败" }
Write-Host ("      包大小 {0:N1} MB" -f ((Get-Item $Pkg).Length / 1MB))

Write-Host "[2/3] 上传到 ${SshHost}..."
& scp -q $Pkg "${SshHost}:/opt/apps/thin-muscle-workout/release.tgz"
if ($LASTEXITCODE -ne 0) { throw "上传失败" }

Write-Host "[3/3] 服务器上解包并重建容器..."
& ssh $SshHost 'cd /opt/apps/thin-muscle-workout && rm -rf deploy-tmp && mkdir deploy-tmp && tar -xzf release.tgz -C deploy-tmp ./deploy/hk/server-deploy.sh && bash deploy-tmp/deploy/hk/server-deploy.sh; rc=$?; rm -rf deploy-tmp; exit $rc'
if ($LASTEXITCODE -ne 0) { throw "服务器部署失败，查看日志：ssh hk docker logs --tail 100 thin-muscle-app" }

$r = Invoke-WebRequest -UseBasicParsing "https://fit.yhyh0147.top/" -TimeoutSec 30
Write-Host "公网检查 https://fit.yhyh0147.top/ => $($r.StatusCode)"
Remove-Item $Pkg -Force
