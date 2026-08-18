/** Reference implementation of CogniMesh economics (mirrors Solidity). */

export const MAX_SUPPLY = 1_000_000_000;
export const REPUTATION_SCALE = 1e6;
export const MIN_STAKE = 100;
export const BPS_PROVIDER = 7000;
export const BPS_TREASURY = 2000;
export const BPS_BURN = 1000;
export const FLASH_FEE_BPS = 30;
export const BASE_SLASH = 50;

export function splitStream(amount) {
  const provider = (amount * BPS_PROVIDER) / 10_000;
  const treasury = (amount * BPS_TREASURY) / 10_000;
  const burn = amount - provider - treasury;
  return { provider, treasury, burn };
}

export function flashFee(amount) {
  return (amount * FLASH_FEE_BPS) / 10_000;
}

export function creditLimit(reputation, stake) {
  if (!reputation || !stake) return 0;
  return (reputation * stake) / REPUTATION_SCALE;
}

export function applySuccess(rep) {
  return Math.min(10e6, rep + 1000);
}

export function applySlashRep(rep) {
  return Math.max(1, rep - 50_000);
}

export class MeshState {
  constructor() {
    this.supply = MAX_SUPPLY;
    this.balances = new Map();
    this.agents = new Map();
    this.channels = new Map();
    this.burned = 0;
    this.treasury = "treasury";
    this.balances.set("treasury", 0);
  }

  mintTo(addr, amt) {
    this.balances.set(addr, (this.balances.get(addr) ?? 0) + amt);
  }

  bal(addr) {
    return this.balances.get(addr) ?? 0;
  }

  transfer(from, to, amt) {
    if (this.bal(from) < amt) throw new Error("insufficient");
    this.balances.set(from, this.bal(from) - amt);
    this.balances.set(to, this.bal(to) + amt);
  }

  burn(from, amt) {
    if (this.bal(from) < amt) throw new Error("insufficient");
    this.balances.set(from, this.bal(from) - amt);
    this.supply -= amt;
    this.burned += amt;
  }

  register(addr, stake) {
    if (this.agents.has(addr)) throw new Error("registered");
    if (stake < MIN_STAKE) throw new Error("stake");
    this.transfer(addr, "registry", stake);
    this.agents.set(addr, { stake, reputation: REPUTATION_SCALE });
  }

  openChannel(payer, provider, deposit, nonce) {
    const id = `${payer}:${provider}:${nonce}`;
    this.transfer(payer, "escrow", deposit);
    this.channels.set(id, { payer, provider, deposit, settled: 0, open: true });
    return id;
  }

  settle(id, amount) {
    const c = this.channels.get(id);
    if (!c?.open) throw new Error("closed");
    if (amount > c.deposit || amount < c.settled) throw new Error("amount");
    const delta = amount - c.settled;
    c.settled = amount;
    const s = splitStream(delta);
    this.balances.set("escrow", this.bal("escrow") - delta);
    this.balances.set(c.provider, this.bal(c.provider) + s.provider);
    this.balances.set(this.treasury, this.bal(this.treasury) + s.treasury);
    this.supply -= s.burn;
    this.burned += s.burn;
    return s;
  }

  slash(agent, amount = BASE_SLASH) {
    const a = this.agents.get(agent);
    if (!a) throw new Error("no agent");
    const take = Math.min(a.stake, amount);
    a.stake -= take;
    a.reputation = applySlashRep(a.reputation);
    const half = take / 2;
    this.balances.set("registry", this.bal("registry") - take);
    this.balances.set("challenger", this.bal("challenger") + half);
    this.supply -= take - half;
    this.burned += take - half;
    return take;
  }

  success(agent) {
    const a = this.agents.get(agent);
    a.reputation = applySuccess(a.reputation);
  }

  flash(agent, amount, work) {
    const a = this.agents.get(agent);
    if (!a) throw new Error("no agent");
    const limit = creditLimit(a.reputation, a.stake);
    if (amount > limit) throw new Error("limit");
    const fee = flashFee(amount);
    this.mintTo(agent, amount); // liquidity pool abstraction
    work(amount, fee);
    if (this.bal(agent) < amount + fee) throw new Error("unpaid");
    this.balances.set(agent, this.bal(agent) - amount - fee);
    const burn = fee / 2;
    this.supply -= burn;
    this.burned += burn;
    this.balances.set(this.treasury, this.bal(this.treasury) + (fee - burn));
    return fee;
  }
}
