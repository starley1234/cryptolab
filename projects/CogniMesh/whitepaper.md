# CogniMesh Whitepaper

**Proof-of-Verifiable-Task and streaming settlement for agent-to-agent markets.**

## 1. Problem

Autonomous agents need:

1. identity that is not a human KYC passport;
2. payments cheaper than the API call they settle;
3. cryptographic or economic assurance that work was done.

Existing L1s batch human-sized transfers. GPU DePINs rent hours. Neither prices **a single generated token** nor slashes a lying model.

## 2. Architecture

### 2.1 AgentRegistry

`register(did, endpointHash, stake)` binds an address to a DID and locks COGNI. Reputation starts at `1e6` (1.0). Success increments; slash decrements and may unbond.

### 2.2 StreamPayment

Two agents open a channel with deposit. Off-chain they exchange signed vouchers `(channelId, amount, nonce, workHash)`. `settle(sigA, sigB, amount)` closes or checkpoints on-chain. Split: 70 / 20 / 10.

### 2.3 SlashManager (PoVT)

Anyone posts `challenge(agent, taskHash, proofType)` with bond. Within `CHALLENGE_WINDOW`:

- **TEE attestation** (demo: committee signature);
- **Optimistic**: no counter-proof → slash;
- **zk stub**: verifier returns true for well-formed proof bytes.

Slash: `min(stake, baseSlash * severity)` → 50% challenger, 50% burn.

### 2.4 FlashCompute

`borrow(amount)` if `amount <= reputation * stake / REPUTATION_SCALE` and no open loan. Must `repay` in same tx via callback `onFlashCompute`. Fee 30 bps, half burned.

This models “rent GPU, deliver job, repay from invoice” without human credit.

## 3. Token

| Item | Value |
|---|---|
| Ticker | COGNI |
| Supply | 1e9, fixed |
| Decimals | 18 |
| Permit | EIP-2612 |
| Sinks | stream burn, slash burn, flash fee burn, registry stake |

Allocation (off-chain policy, minted to treasury):

- 40% ecosystem / agent rewards
- 20% community + airdrop
- 20% team (vest)
- 15% treasury
- 5% MM / launch

## 4. Consensus note

CogniMesh v0 is an **app-chain module set on EVM** (L2). PoVT is an *application* consensus over tasks, not a replacement for the host chain’s BFT. v1 may become a dedicated rollup whose sequencer orders voucher batches.

## 5. Security

- No admin mint.
- Streams require both signatures or timeout + unisig after `TIMEOUT`.
- Flash loan reentrancy: status lock + checks-effects-interactions.
- Reputation cannot exceed `10e6` or fall below `1`.

## 6. Go-to-market

LangChain / CrewAI / Eliza adapters. One import: `AgentWallet.stream_pay()`. See `marketing/launch-plan.md`.
