import { expect } from "chai";
import {
  assertPlanHash,
  buildAllocationArtifact,
  buildDeploymentPlan,
  RecipientNetwork,
} from "../scripts/lib/allocation-plan";

const EXPECTED = [
  ["ecosystem_network_growth", 3100, "3100000000000000000000000000"],
  ["foundation", 2500, "2500000000000000000000000000"],
  ["rewards", 3000, "3000000000000000000000000000"],
  ["investors", 500, "500000000000000000000000000"],
  ["exchange_allocation", 700, "700000000000000000000000000"],
  ["liquidity_supply", 200, "200000000000000000000000000"],
] as const;

function validNetwork(): RecipientNetwork {
  return {
    chainId: 56,
    recipients: Object.fromEntries(
      EXPECTED.map(([id], index) => [id, `0x${(index + 1).toString(16).padStart(40, "0")}`])
    ),
  };
}

describe("allocation toolchain", () => {
  it("calculates the approved six-pool policy exactly", () => {
    const artifact = buildAllocationArtifact();
    expect(artifact.totalSupplyWei).to.equal("10000000000000000000000000000");
    expect(artifact.allocations.map(({ id, shareBps, amountWei }) => [id, shareBps, amountWei]))
      .to.deep.equal(EXPECTED.map((entry) => [...entry]));
    expect(artifact.policyHash).to.match(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds a hash-locked deployment plan", () => {
    const plan = buildDeploymentPlan(buildAllocationArtifact(), "bsc", validNetwork());
    expect(plan.chainId).to.equal(56);
    expect(plan.constructorArgs.recipients).to.have.length(6);
    expect(plan.constructorArgs.amounts).to.deep.equal(EXPECTED.map((entry) => entry[2]));
    expect(() => assertPlanHash(plan)).not.to.throw();

    const tampered = { ...plan, totalSupplyWei: "1" };
    expect(() => assertPlanHash(tampered)).to.throw("Deployment plan hash mismatch");
  });

  it("rejects missing and duplicate recipients", () => {
    const artifact = buildAllocationArtifact();
    const missing = validNetwork();
    missing.recipients.liquidity_supply = null;
    expect(() => buildDeploymentPlan(artifact, "bsc", missing)).to.throw(
      "Missing recipient for liquidity_supply"
    );

    const duplicate = validNetwork();
    duplicate.recipients.liquidity_supply = duplicate.recipients.exchange_allocation;
    expect(() => buildDeploymentPlan(artifact, "bsc", duplicate)).to.throw("Duplicate recipient");
  });
});
