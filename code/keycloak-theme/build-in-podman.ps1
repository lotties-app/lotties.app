# Windows wrapper: runs build-in-podman.sh inside WSL (podman installed there).
# Usage: powershell -File build-in-podman.ps1 [-Distro archlinux] [-All]
param([string]$Distro = '', [switch]$All)
$here = (Resolve-Path $PSScriptRoot).Path
$drive = $here.Substring(0, 1).ToLower()
$wslPath = '/mnt/' + $drive + $here.Substring(2).Replace('\', '/')
$env = if ($All) { 'KC_TARGETS=all ' } else { '' }
$cmd = "cd '$wslPath' && ${env}bash ./build-in-podman.sh"
if ($Distro) { wsl -d $Distro -- bash -c $cmd } else { wsl -- bash -c $cmd }
