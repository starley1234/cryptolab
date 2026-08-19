// Compile all contracts with solc-js into artifacts/*.json
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import solc from "solc";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, "..", "src");
const outDir = join(root, "..", "artifacts");
mkdirSync(outDir, { recursive: true });

function collectSol(dir, base = "") {
  const out = {};
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) Object.assign(out, collectSol(full, rel));
    else if (ent.name.endsWith(".sol")) out[rel] = { content: readFileSync(full, "utf8") };
  }
  return out;
}
const sources = collectSol(srcDir);
if (!Object.keys(sources).length) {
  console.error("no .sol found in", srcDir);
  process.exit(1);
}
console.log("sources:", Object.keys(sources).join(", "));

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
let failed = false;
for (const err of output.errors ?? []) {
  if (err.severity === "error") { failed = true; console.error(`✖ ${err.formattedMessage}`); }
  else console.warn(`• ${err.formattedMessage}`);
}
if (failed) process.exit(1);
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, data] of Object.entries(contracts)) {
    if (!data.evm.bytecode.object) continue;
    const artifact = {
      contractName: name,
      sourceFile: basename(file),
      abi: data.abi,
      bytecode: "0x" + data.evm.bytecode.object,
      deployedBytecode: "0x" + data.evm.deployedBytecode.object,
      compiler: { version: solc.version() },
    };
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(artifact, null, 2));
    const kb = (Buffer.byteLength(data.evm.deployedBytecode.object, "utf8") / 2 / 1024).toFixed(2);
    console.log(`✔ ${name} — ${kb} kB`);
  }
}
