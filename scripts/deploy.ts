import { ethers, network } from "hardhat";

/**
 * apM Fashion deployment.
 *
 * Vesting uses OpenZeppelin's stock VestingWallet (no custom contract). Each schedule is
 * expressed purely via (start, duration):
 *   - pure linear:        start = TGE,          duration = linear period
 *   - cliff + linear:     start = TGE + cliff,  duration = linear period
 *   - pure cliff (full):  start = TGE + cliff,  duration = 0  (unlocks 100% at start)
 *
 * Flow:
 *   1) Deploy one VestingWallet per locked allocation (beneficiary = cold wallet).
 *   2) Deploy ApmFashion, minting the full 10,000,000,000 supply across the vesting
 *      contracts and cold-wallet EOAs. The constructor enforces sum == TOTAL_SUPPLY.
 *
 * Distribution & release schedule (tentative - replace addresses/percentages with finals):
 *   Genesis Airdrop    ~44%  24mo linear                 (existing community succession)
 *   Foundation Reserve ~21%  24mo linear
 *   Team               ~10%  12mo cliff + 24mo linear
 *   Rewards Pool       ~15%  6mo cliff (full unlock)
 *   Investors          ~5%   6mo cliff + 18mo linear
 *   Exchange Airdrop   ~5%   unlocked only if required for listing (no vesting)
 */

const E18 = 10n ** 18n;
const TOTAL = 10_000_000_000n * E18;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  // ----- TODO: replace with real cold-wallet addresses -----
  const GENESIS_AIRDROP_COLD = "0x0000000000000000000000000000000000000001";
  const FOUNDATION_COLD = "0x0000000000000000000000000000000000000002";
  const TEAM_COLD = "0x0000000000000000000000000000000000000003";
  const REWARDS_COLD = "0x0000000000000000000000000000000000000004";
  const INVESTORS_COLD = "0x0000000000000000000000000000000000000005";
  const EXCHANGE_COLD = "0x0000000000000000000000000000000000000006";

  const now = Math.floor(Date.now() / 1000);
  const TGE = now + 1 * DAY; // TGE = deploy + 1 day (must be >= block.timestamp at deploy)

  const Vest = await ethers.getContractFactory("VestingWallet");

  // 1) Vesting wallets (start, duration) per the schedule above.
  const genesisVest = await Vest.deploy(GENESIS_AIRDROP_COLD, TGE, 24 * MONTH);
  await genesisVest.waitForDeployment();
  const foundationVest = await Vest.deploy(FOUNDATION_COLD, TGE, 24 * MONTH);
  await foundationVest.waitForDeployment();
  const teamVest = await Vest.deploy(TEAM_COLD, TGE + 12 * MONTH, 24 * MONTH);
  await teamVest.waitForDeployment();
  const rewardsVest = await Vest.deploy(REWARDS_COLD, TGE + 6 * MONTH, 0); // full unlock at cliff
  await rewardsVest.waitForDeployment();
  const investorsVest = await Vest.deploy(INVESTORS_COLD, TGE + 6 * MONTH, 18 * MONTH);
  await investorsVest.waitForDeployment();

  // 2) Allocations (percentages of 10,000,000,000).
  const recipients = [
    await genesisVest.getAddress(),
    await foundationVest.getAddress(),
    await teamVest.getAddress(),
    await rewardsVest.getAddress(),
    await investorsVest.getAddress(),
    EXCHANGE_COLD, // no vesting; released manually only if needed for listing
  ];
  const amounts = [
    4_400_000_000n * E18, // 44% Genesis Airdrop
    2_100_000_000n * E18, // 21% Foundation Reserve
    1_000_000_000n * E18, // 10% Team
    1_500_000_000n * E18, // 15% Rewards Pool
    500_000_000n * E18, //  5% Investors
    500_000_000n * E18, //  5% Exchange Airdrop
  ];

  const sum = amounts.reduce((a, b) => a + b, 0n);
  if (sum !== TOTAL) {
    throw new Error(`allocation sum ${sum} != TOTAL_SUPPLY ${TOTAL}`);
  }

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(recipients, amounts);
  await token.waitForDeployment();

  console.log(`ApmFashion:        ${await token.getAddress()}`);
  console.log(`Genesis vesting:   ${await genesisVest.getAddress()}`);
  console.log(`Foundation vesting:${await foundationVest.getAddress()}`);
  console.log(`Team vesting:      ${await teamVest.getAddress()}`);
  console.log(`Rewards vesting:   ${await rewardsVest.getAddress()}`);
  console.log(`Investors vesting: ${await investorsVest.getAddress()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
