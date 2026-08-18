# Production runbook

1. Audit Solidity in `contracts/src` (token, registry, stream, slash, flash).
2. Deploy CogniToken(treasuryMultisig) → AgentRegistry → setSlashManager → StreamPayment → FlashCompute.
3. Seed flash pool from treasury (separate from circulating rewards).
4. Gateway: set `PORT`, bind `0.0.0.0`, persist state (replace in-memory MeshState).
5. Relayer watches voucher inbox; never holds user keys.
6. Incident: pause via multisig on StreamPayment (add Pausable in audit pass).
7. Never store seed phrases in repo.

Demo gateway is intentionally in-memory.
