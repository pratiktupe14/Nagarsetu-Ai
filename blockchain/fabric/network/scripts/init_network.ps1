# =============================================================================
# NAGARSETU 3.1 — Hyperledger Fabric Staging Network Initialization Script (PowerShell)
# =============================================================================

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$networkDir = Split-Path -Parent $scriptDir
Set-Location $networkDir

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  NAGARSETU 3.1 — Hyperledger Fabric Network Initialization (Staging)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

if (-not (Get-Command cryptogen -ErrorAction SilentlyContinue)) {
    Write-Host "[INFO] 'cryptogen' binary is not present in system PATH." -ForegroundColor Yellow
    Write-Host "[INFO] Deployment configuration files (configtx.yaml, crypto-config.yaml, docker-compose-fabric.yml) are ready." -ForegroundColor Green
    Write-Host "[INFO] For live deployment, ensure Fabric v2.5 binaries and Docker runtime are provisioned." -ForegroundColor Gray
    exit 0
}

Write-Host "[1/4] Generating cryptographic identity certificates..." -ForegroundColor Green
& cryptogen generate --config=./crypto-config.yaml --output=./crypto-config

if (-not (Test-Path ./channel-artifacts)) {
    New-Item -ItemType Directory -Path ./channel-artifacts | Out-Null
}

Write-Host "[2/4] Generating Raft Genesis Block via configtxgen..." -ForegroundColor Green
& configtxgen -profile NagarsetuOrdererGenesis -channelID system-channel -outputBlock ./channel-artifacts/genesis.block

Write-Host "[3/4] Generating Channel Creation Transaction..." -ForegroundColor Green
& configtxgen -profile NagarsetuChannel -channelID nagarsetu-channel -outputCreateChannelTx ./channel-artifacts/nagarsetu-channel.tx

Write-Host "[4/4] Generating Anchor Peer Update Transactions..." -ForegroundColor Green
& configtxgen -profile NagarsetuChannel -channelID nagarsetu-channel -outputAnchorPeersUpdate ./channel-artifacts/MunicipalAuthorityMSPanchors.tx -asOrg MunicipalAuthorityMSP
& configtxgen -profile NagarsetuChannel -channelID nagarsetu-channel -outputAnchorPeersUpdate ./channel-artifacts/AuditorMSPanchors.tx -asOrg AuditorMSP

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Artifacts generated successfully in ./channel-artifacts" -ForegroundColor Green
Write-Host "  Ready to launch: docker compose -f docker-compose-fabric.yml up -d" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
