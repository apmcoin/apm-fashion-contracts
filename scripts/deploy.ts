import { ethers, network } from "hardhat";

/**
 * apM Fashion deployment.
 *
 * Flow:
 *   1) Deploy one CliffVestingWallet per locked tranche (team / backer / treasury ...)
 *      with its OWN schedule (start, duration, cliff). owner == beneficiary cold wallet.
 *   2) Deploy ApmFashion, minting the full 10,000,000,000 supply across:
 *        - vesting contract addresses (locked tranches)
 *        - cold-wallet EOAs (immediately needed: exchange / liquidity / manual re-issuance)
 *      The constructor enforces sum == TOTAL_SUPPLY.
 *
 * ALL numbers/schedules below are PLACEHOLDERS. Fill final values AFTER exchange
 * negotiations, right before deploy. No contract code change is needed - only args.
 */

const E18 = 10n ** 18n;
const TOTAL = 10_000_000_000n * E18;
const DAY = 24 * 60 * 60;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  // ----- TODO: replace with real cold-wallet addresses -----
  const TEAM_COLD = "0x0000000000000000000000000000000000000001";
  const BACKER_COLD = "0x0000000000000000000000000000000000000002";
  const TREASURY_COLD = "0x0000000000000000000000000000000000000003";
  const EXCHANGE_COLD = "0x0000000000000000000000000000000000000004";

  const now = Math.floor(Date.now() / 1000);
  const start = now + 7 * DAY; // TGE in the future (must be >= block.timestamp at deploy)

  const Vest = await ethers.getContractFactory("CliffVestingWallet");

  // ----- TODO: replace amounts/schedules with final tokenomics -----
  const teamVest = await Vest.deploy(TEAM_COLD, start, 730 * DAY, 180 * DAY);
  await teamVest.waitForDeployment();
  const backerVest = await Vest.deploy(BACKER_COLD, start, 365 * DAY, 90 * DAY);
  await backerVest.waitForDeployment();

  const TEAM_AMT = 1_500_000_000n * E18;
  const BACKER_AMT = 1_000_000_000n * E18;
  const TREASURY_AMT = 3_500_000_000n * E18;
  const EXCHANGE_AMT = TOTAL - TEAM_AMT - BACKER_AMT - TREASURY_AMT;

  const recipients = [
    await teamVest.getAddress(),
    await backerVest.getAddress(),
    TREASURY_COLD,
    EXCHANGE_COLD,
  ];
  const amounts = [TEAM_AMT, BACKER_AMT, TREASURY_AMT, EXCHANGE_AMT];

  const sum = amounts.reduce((a, b) => a + b, 0n);
  if (sum !== TOTAL) {
    throw new Error(`allocation sum ${sum} != TOTAL_SUPPLY ${TOTAL}`);
  }

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(recipients, amounts);
  await token.waitForDeployment();

  console.log(`ApmFashion:        ${await token.getAddress()}`);
  console.log(`Team vesting:      ${await teamVest.getAddress()}`);
  console.log(`Backer vesting:    ${await backerVest.getAddress()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
