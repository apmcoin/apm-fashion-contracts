import { expect } from "chai";
import {
  assertPlanHash,
  buildAllocationArtifact,
  buildDeploymentPlan,
  RecipientNetwork,
} from "../scripts/lib/allocation-plan";

const EXPECTED = [
  ["genesis_allocation", "1598200000", "1598200000000000000000000000"],
  ["ecosystem_network_growth", "1501800000", "1501800000000000000000000000"],
  ["foundation", "2500000000", "2500000000000000000000000000"],
  ["rewards", "3000000000", "3000000000000000000000000000"],
  ["investors", "500000000", "500000000000000000000000000"],
  ["exchange_allocation", "700000000", "700000000000000000000000000"],
  ["liquidity_supply", "200000000", "200000000000000000000000000"],
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
  it("calculates the approved seven-pool policy exactly", () => {
    const artifact = buildAllocationArtifact();
    expect(artifact.totalSupplyWei).to.equal("10000000000000000000000000000");
    expect(artifact.allocations.map(({ id, amountTokens, amountWei }) => [
      id,
      amountTokens,
      amountWei,
    ]))
      .to.deep.equal(EXPECTED.map((entry) => [...entry]));
    expect(artifact.policyHash).to.match(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds a hash-locked deployment plan", () => {
    const plan = buildDeploymentPlan(buildAllocationArtifact(), "bsc", validNetwork());
    expect(plan.chainId).to.equal(56);
    expect(plan.constructorArgs.recipients).to.have.length(7);
    expect(plan.constructorArgs.amounts).to.deep.equal(EXPECTED.map((entry) => entry[2]));
    expect(() => assertPlanHash(plan)).not.to.throw();

    const tampered = { ...plan, totalSupplyWei: "1" };
    expect(() => assertPlanHash(tampered)).to.throw("Deployment plan hash mismatch");
  });

  it("keeps logical pools separate when they share one mint destination", () => {
    const network = validNetwork();
    network.recipients.exchange_allocation = network.recipients.ecosystem_network_growth;
    const plan = buildDeploymentPlan(buildAllocationArtifact(), "bsc", network);

    expect(plan.allocations).to.have.length(7);
    expect(plan.constructorArgs.recipients).to.have.length(7);
    expect(plan.constructorArgs.recipients[1]).to.equal(plan.constructorArgs.recipients[5]);
    expect([plan.constructorArgs.amounts[1], plan.constructorArgs.amounts[5]]).to.deep.equal([
      "1501800000000000000000000000",
      "700000000000000000000000000",
    ]);
  });

  it("rejects missing recipients", () => {
    const artifact = buildAllocationArtifact();
    const missing = validNetwork();
    missing.recipients.liquidity_supply = null;
    expect(() => buildDeploymentPlan(artifact, "bsc", missing)).to.throw(
      "Missing recipient for liquidity_supply"
    );
  });
});
