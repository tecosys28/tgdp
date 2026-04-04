// ═══════════════════════════════════════════════════════════════════════════
// TGDP CONTRACT DEPLOYMENT SCRIPT
// Deploy order: TGDPToken → GICToken → FTRToken → TGDPRegistry → IPRRegistry
// After deploy: update Firestore /config/contracts with all addresses.
//
// Run:
//   npx hardhat run scripts/deploy.js --network amoy
// ═══════════════════════════════════════════════════════════════════════════

const { ethers, run, network } = require('hardhat');
const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

// Load service account for Firestore update
// Place your serviceAccountKey.json in the blockchain/ directory
let serviceAccount;
try {
  serviceAccount = require('../scripts/serviceAccountKey.json');
} catch {
  console.warn('⚠ serviceAccountKey.json not found — Firestore update skipped.');
}

async function main() {
  const [deployer, registrar] = await ethers.getSigners();
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  TGDP Contract Deployment');
  console.log('  Network   :', network.name);
  console.log('  Deployer  :', deployer.address);
  console.log('  Registrar :', registrar ? registrar.address : deployer.address);
  console.log('═══════════════════════════════════════════════════\n');

  const registrarAddress = registrar ? registrar.address : deployer.address;

  // ── 1. TGDPToken ────────────────────────────────────────────────────────────
  process.stdout.write('Deploying TGDPToken...');
  const TGDPToken = await ethers.getContractFactory('TGDPToken');
  const tgdp      = await TGDPToken.deploy();
  await tgdp.waitForDeployment();
  const tgdpAddr  = await tgdp.getAddress();
  console.log(' ✓', tgdpAddr);

  // Grant MINTER_ROLE to registrar wallet (used by Cloud Functions)
  await (await tgdp.grantRole(await tgdp.MINTER_ROLE(), registrarAddress)).wait();
  console.log('  MINTER_ROLE granted to registrar');

  // ── 2. GICToken ─────────────────────────────────────────────────────────────
  process.stdout.write('Deploying GICToken...');
  const GICToken = await ethers.getContractFactory('GICToken');
  const gic      = await GICToken.deploy();
  await gic.waitForDeployment();
  const gicAddr  = await gic.getAddress();
  console.log(' ✓', gicAddr);

  await (await gic.grantRole(await gic.CREDITOR_ROLE(), registrarAddress)).wait();
  console.log('  CREDITOR_ROLE granted to registrar');

  // ── 3. FTRToken ─────────────────────────────────────────────────────────────
  process.stdout.write('Deploying FTRToken...');
  const FTRToken = await ethers.getContractFactory('FTRToken');
  const ftr      = await FTRToken.deploy(tgdpAddr);
  await ftr.waitForDeployment();
  const ftrAddr  = await ftr.getAddress();
  console.log(' ✓', ftrAddr);

  await (await ftr.grantRole(await ftr.OPERATOR_ROLE(), registrarAddress)).wait();
  console.log('  OPERATOR_ROLE granted to registrar');

  // ── 4. TGDPRegistry ─────────────────────────────────────────────────────────
  process.stdout.write('Deploying TGDPRegistry...');
  const TGDPRegistry = await ethers.getContractFactory('TGDPRegistry');
  const registry     = await TGDPRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(' ✓', registryAddr);

  await (await registry.grantRole(await registry.REGISTRAR_ROLE(), registrarAddress)).wait();
  console.log('  REGISTRAR_ROLE granted to registrar');

  // ── 5. IPRRegistry ──────────────────────────────────────────────────────────
  process.stdout.write('Deploying IPRRegistry...');
  const IPRRegistry = await ethers.getContractFactory('IPRRegistry');
  const ipr         = await IPRRegistry.deploy();
  await ipr.waitForDeployment();
  const iprAddr     = await ipr.getAddress();
  console.log(' ✓', iprAddr);

  await (await ipr.grantRole(await ipr.REGISTRAR_ROLE(), registrarAddress)).wait();
  console.log('  REGISTRAR_ROLE granted to registrar');

  // ── Summary ─────────────────────────────────────────────────────────────────
  const addresses = {
    tgdpToken:   tgdpAddr,
    ftrToken:    ftrAddr,
    gicToken:    gicAddr,
    registry:    registryAddr,
    iprRegistry: iprAddr,
    network:     network.name,
    chainId:     network.config.chainId,
    deployedAt:  new Date().toISOString(),
    deployer:    deployer.address,
    registrar:   registrarAddress,
  };

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Contract Addresses');
  console.log('  TGDP Token  :', tgdpAddr);
  console.log('  FTR Token   :', ftrAddr);
  console.log('  GIC Token   :', gicAddr);
  console.log('  Registry    :', registryAddr);
  console.log('  IPR Registry:', iprAddr);
  console.log('═══════════════════════════════════════════════════\n');

  // ── Save to JSON ─────────────────────────────────────────────────────────────
  const outPath = path.join(__dirname, `../deployed-${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log('Addresses saved to:', outPath);

  // ── Update Firestore /config/contracts ───────────────────────────────────────
  if (serviceAccount) {
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    const db = admin.firestore();
    await db.collection('config').doc('contracts').set(addresses, { merge: true });
    console.log('✓ Firestore /config/contracts updated');
  }

  // ── Verify on Polygonscan (optional) ─────────────────────────────────────────
  if (network.name !== 'hardhat' && process.env.POLYGONSCAN_API_KEY) {
    console.log('\nVerifying contracts on Polygonscan...');
    for (const [name, addr] of [
      ['TGDPToken',   tgdpAddr],
      ['GICToken',    gicAddr],
      ['TGDPRegistry', registryAddr],
      ['IPRRegistry', iprAddr],
    ]) {
      try {
        await run('verify:verify', { address: addr, constructorArguments: [] });
        console.log(`  ✓ ${name} verified`);
      } catch (e) {
        console.log(`  ✗ ${name}: ${e.message}`);
      }
    }
    // FTRToken has constructor arg
    try {
      await run('verify:verify', { address: ftrAddr, constructorArguments: [tgdpAddr] });
      console.log('  ✓ FTRToken verified');
    } catch (e) {
      console.log(`  ✗ FTRToken: ${e.message}`);
    }
  }

  console.log('\nDeployment complete!');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
