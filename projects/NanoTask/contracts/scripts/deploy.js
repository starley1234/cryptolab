// Deploys NanoTask on Base / Base Sepolia
//   npx hardhat run scripts/deploy.js --no-compile --network baseSepolia
// Env:
//   DEPLOYER_PRIVATE_KEY  funded deployer
//   TREASURY_ADDRESS      (optional, defaults to deployer)
import hre from "hardhat";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const network = hre.network?.name ?? "hardhat";
  const { viem } = await hre.network.connect();
  const [deployer] = await viem.getWalletClients();
  console.log("network:", network);
  console.log("deployer:", deployer.account.address);
  const treasury = process.env.TREASURY_ADDRESS || deployer.account.address;
  console.log("treasury:", treasury);

  // load artifacts compiled via node scripts/compile.js
  const root = dirname(fileURLToPath(import.meta.url));
  const load = (name) => JSON.parse(readFileSync(join(root, "..", "artifacts", `${name}.json`), "utf8"));

  const tokenArt = load("NanoToken");
  const escrowArt = load("TaskEscrow");

  console.log("\n── deploy NanoToken ($TASK) — 1B fixed supply → treasury ──");
  const tokenHash = await deployer.deployContract({
    abi: tokenArt.abi,
    bytecode: tokenArt.bytecode,
    args: [treasury],
  });
  const tokenAddr = tokenHash;
  // viem deploy returns hash, need to wait; simpler via write
  // Actually viem's deployContract via walletClient returns hash — fetch receipt
  // For brevity, use hre.viem deploy helper if available
  // fallback: use public client to wait
  console.log("  tx:", tokenHash);
  // In hardhat v3, deployContract returns address directly when using hre
  // Try alternate path:
  let tokenAddress = tokenHash;
  if (typeof tokenHash === "string" && tokenHash.startsWith("0x") && tokenHash.length === 66) {
    const publicClient = await viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
    tokenAddress = receipt.contractAddress;
  }
  console.log("NanoToken:", tokenAddress);

  console.log("\n── deploy TaskEscrow — fee 2% (98/1/1), minStake 50 ──");
  const escrowHash = await deployer.deployContract({
    abi: escrowArt.abi,
    bytecode: escrowArt.bytecode,
    args: [tokenAddress, treasury],
  });
  let escrowAddress = escrowHash;
  if (typeof escrowHash === "string" && escrowHash.startsWith("0x") && escrowHash.length === 66) {
    const publicClient = await viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash: escrowHash });
    escrowAddress = receipt.contractAddress;
  }
  console.log("TaskEscrow:", escrowAddress);

  const out = {
    network,
    deployer: deployer.account.address,
    treasury,
    NanoToken: tokenAddress,
    TaskEscrow: escrowAddress,
    feeBps: 200,
    burnBps: 100,
    minStake: "50000000000000000000",
    timestamp: new Date().toISOString(),
  };
  const outFile = join(root, "..", `deploy-${network}.json`);
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\n✔ saved → ${outFile}`);
  console.log(JSON.stringify(out, null, 2));
  console.log(`
next:
  1) Basescan verify: solc 0.8.28, optimizer 200, Evm cancun
  2) set backend env: TASK_TOKEN_ADDRESS=${tokenAddress} TASK_ESCROW_ADDRESS=${escrowAddress}
  3) fund agents via token.transfer()
  4) stake 50 TASK → createTask → submitResult → approve (98/1/1)
`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
