# NAGARSETU 3.1 — Hyperledger Fabric Operator Runbook & Disaster Recovery

## 1. Network Topology Overview
- **Consortium**: `NagarsetuConsortium`
- **Channel**: `nagarsetu-channel`
- **Organizations**:
  1. **Municipal Authority** (`MunicipalAuthorityMSP`):
     - Peers: `peer0.municipal.nagarsetu.gov.in:7051`, `peer1.municipal.nagarsetu.gov.in:7061`
     - Storage: `/var/hyperledger/production` (Persistent Block Store & State DB)
  2. **Independent Auditor** (`AuditorMSP`):
     - Peer: `peer0.auditor.nagarsetu.gov.in:8051`
     - Storage: `/var/hyperledger/production` (Independent audit ledger)
  3. **Ordering Service** (`OrdererMSP`):
     - Raft Cluster: 3 Nodes (`orderer1:7050`, `orderer2:7054`, `orderer3:7055`)
     - Quorum: 2-of-3 node agreement required for block generation.
- **Endorsement Policy**: `AND('MunicipalAuthorityMSP.peer', 'AuditorMSP.peer')`

---

## 2. Health Checks & Monitoring

### Peer Node Liveness
```bash
docker exec peer0.municipal.nagarsetu.gov.in peer node status
```
Returns: `{"status": "STARTED"}`

### Raft Orderer Consensus Health
```bash
osnadmin channel list --orderer-address orderer1.nagarsetu.gov.in:7053 --ca-file /var/hyperledger/orderer/tls/ca.crt
```

### Outbox Queue Backlog Monitoring
Query NAGARSETU operational database for pending or failed transactions:
```sql
SELECT status, count(*) FROM blockchain_transactions GROUP BY status;
```
Alert condition: Any transaction remaining in `PENDING` status for more than 5 minutes or any count in `DEAD_LETTER`.

---

## 3. Disaster Recovery & Backup Procedures

### A. Ledger Cold Backup (Nightly)
1. Flush pending outbox transactions:
   ```bash
   node -e "require('./backend/src/services/blockchain').ledgerAdapter.processPendingOutbox()"
   ```
2. Snapshot peer block storage volumes:
   ```bash
   docker run --rm -v orderer1.nagarsetu.gov.in:/data -v /backup:/backup alpine tar czf /backup/orderer1_$(date +%F).tar.gz /data
   docker run --rm -v peer0.municipal.nagarsetu.gov.in:/data -v /backup:/backup alpine tar czf /backup/peer0_municipal_$(date +%F).tar.gz /data
   ```

### B. Ledger State Resynchronization
If an individual peer loses disk state or falls behind:
1. Stop the affected peer container.
2. Clear the corrupted `/var/hyperledger/production` volume.
3. Restart the peer container.
4. Gossip protocol and channel participation will automatically re-fetch blocks 0 through latest from available consortium peers.

---

## 4. Key Management & Certificate Lifecycle
- TLS certificates expire after 1 year.
- Renew client certificates using Fabric CA client 30 days prior to expiration:
  ```bash
  fabric-ca-client reenroll -u https://peer0:password@ca.municipal.nagarsetu.gov.in:7054
  ```

---

## 5. Rollback Plan
If chaincode update or configuration change fails during rollout:
1. Set `FABRIC_PEER_ENDPOINT=""` in backend `.env` to gracefully engage local proof engine mode.
2. NAGARSETU seamlessly resumes transactional outbox buffering with zero user-facing downtime.
3. Reverse chaincode definition approve/commit sequence to previous approved sequence number.
