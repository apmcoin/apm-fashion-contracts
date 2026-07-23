import * as fs from "fs";
import * as path from "path";
import {
  createDeploymentPlan,
  deploymentPlanPath,
  ROOT_DIR,
} from "./lib/allocation-plan";

const networkName = process.argv[2];
if (networkName !== "bsc" && networkName !== "bscTestnet") {
  throw new Error("Usage: ts-node scripts/prepareDeployment.ts <bsc|bscTestnet>");
}

const plan = createDeploymentPlan(networkName);
const outputPath = deploymentPlanPath(networkName);
fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);

console.log(`Deployment plan: ${path.relative(ROOT_DIR, outputPath)}`);
console.log(`Plan hash      : ${plan.planHash}`);
console.log("Review and commit the deployment plan before broadcasting a deployment transaction.");
