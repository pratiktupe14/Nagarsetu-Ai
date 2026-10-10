# NAGARSETU 3.1 — Production Cryptographic Key Management (KMS & HSM Guide)

## 1. Overview
In NAGARSETU 3.1, cryptographic keys protect:
1. **Privacy HMAC Commitments**: Blinding citizen identities, GPS coordinates, and evidence references.
2. **Hyperledger Fabric Peer & Client Identities**: X.509 EC/RSA signing certificates and private keys.
3. **Transport Layer Security (TLS)**: Dual mutual TLS for Raft orderers and Fabric peers.

---

## 2. Supported Production Key Providers

### A. AWS Key Management Service (AWS KMS)
- **Key Spec**: `ECC_NIST_P256` or `SYMMETRIC_DEFAULT` (AES-256-GCM)
- **Policy**: Least-privilege IAM policy allowing only `kms:Sign`, `kms:Verify`, and `kms:GenerateDataKey`.
- **Environment Variables**:
  ```env
  KMS_PROVIDER=AWS_KMS
  AWS_REGION=ap-south-1
  AWS_KMS_KEY_ARN=arn:aws:kms:ap-south-1:123456789012:key/nagarsetu-integrity-key
  ```

### B. HashiCorp Vault (Transit Secrets Engine)
- **Engine**: Transit
- **Mount Path**: `transit/keys/nagarsetu-blockchain-master`
- **Environment Variables**:
  ```env
  KMS_PROVIDER=HASHICORP_VAULT
  VAULT_ADDR=https://vault.nagarsetu.gov.in:8200
  VAULT_TOKEN=<vault_token>
  VAULT_KEY_NAME=nagarsetu-blockchain-master
  ```

### C. Azure Key Vault
- **Key Type**: `EC-P256` or `RSA-4096`
- **Environment Variables**:
  ```env
  KMS_PROVIDER=AZURE_KEYVAULT
  AZURE_KEYVAULT_URI=https://nagarsetu-kv.vault.azure.net/
  AZURE_TENANT_ID=<tenant_id>
  AZURE_CLIENT_ID=<client_id>
  ```

---

## 3. Strict Production Key Rules

1. **No Hardcoded Keys**: Plaintext private keys must NEVER be stored in source code, committed to Git, or sent to frontend bundles.
2. **Log Redaction**: Key material is strictly masked in log aggregators (`***REDACTED***`).
3. **Key Rotation**:
   - HMAC master keys are rotated on an annual schedule or immediately upon security incident.
   - Key rotation increments the `key_version_id` (e.g. `v1-2026` -> `v2-2027`).
   - Historical records are verified using their associated version key.
4. **Emergency Revocation**:
   - In case of compromise, revoke the affected X.509 certificate via Fabric CA CRL (Certificate Revocation List).
   - Re-enroll the client identity and update `CORE_PEER_MSPCONFIGPATH`.
