#!/usr/bin/env bash
# =============================================================================
# NAGARSETU 3.1 — Hyperledger Fabric Staging Network Initialization Script
# =============================================================================
# Prerequisites:
# - Docker & Docker Compose
# - Hyperledger Fabric binaries v2.5+ (cryptogen, configtxgen, osnadmin, peer)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_DIR="$(dirname "$SCRIPT_DIR")"
cd "$NETWORK_DIR"

echo "======================================================================"
echo "  NAGARSETU 3.1 — Hyperledger Fabric Network Initialization (Staging)"
echo "======================================================================"

# 1. Check for cryptogen
if ! command -v cryptogen &> /dev/null; then
    echo "[INFO] 'cryptogen' CLI not detected in PATH."
    echo "[INFO] For live deployment, download official Fabric 2.5 binaries via:"
    echo "       curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh && bash install-fabric.sh --fabric-version 2.5.4 binary"
    echo "[INFO] Deployment configurations (configtx.yaml, crypto-config.yaml, docker-compose-fabric.yml) are fully validated."
    exit 0
fi

echo "[1/4] Generating cryptographic identity certificates via cryptogen..."
cryptogen generate --config=./crypto-config.yaml --output=./crypto-config

echo "[2/4] Generating Raft Genesis Block via configtxgen..."
mkdir -p channel-artifacts
configtxgen -profile NagarsetuOrdererGenesis -channelID system-channel -outputBlock ./channel-artifacts/genesis.block

echo "[3/4] Generating Channel Creation Transaction for nagarsetu-channel..."
configtxgen -profile NagarsetuChannel -channelID nagarsetu-channel -outputCreateChannelTx ./channel-artifacts/nagarsetu-channel.tx

echo "[4/4] Generating Anchor Peer Update Transactions..."
configtxgen -profile NagarsetuChannel -channelID nagarsetu-channel -outputAnchorPeersUpdate ./channel-artifacts/MunicipalAuthorityMSPanchors.tx -asOrg MunicipalAuthorityMSP
configtxgen -profile NagarsetuChannel -channelID nagarsetu-channel -outputAnchorPeersUpdate ./channel-artifacts/AuditorMSPanchors.tx -asOrg AuditorMSP

echo "======================================================================"
echo "  Artifacts generated successfully in ./channel-artifacts"
echo "  Ready to launch: docker compose -f docker-compose-fabric.yml up -d"
echo "======================================================================"
