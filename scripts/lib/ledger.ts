import { DeviceActionState, DeviceActionStatus, DeviceManagementKitBuilder } from "@ledgerhq/device-management-kit";
import { nodeHidTransportFactory } from "@ledgerhq/device-transport-kit-node-hid";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { filter, firstValueFrom, Observable, timeout } from "rxjs";
import { getAddress, getBytes, Signature, Transaction } from "ethers";

async function complete<T>(action: {
  observable: Observable<DeviceActionState<T, unknown, unknown>>;
  cancel: () => void;
}): Promise<T> {
  try {
    const state = await firstValueFrom(action.observable.pipe(
      filter((value) => value.status !== DeviceActionStatus.NotStarted && value.status !== DeviceActionStatus.Pending),
      timeout(120_000)
    ));
    if (state.status === DeviceActionStatus.Error) throw state.error;
    if (state.status !== DeviceActionStatus.Completed) throw new Error("Ledger action cancelled");
    return state.output;
  } finally {
    action.cancel();
  }
}

export function attachSignature(transaction: Transaction, signature: { r: string; s: string; v: number }, expected: string) {
  const signed = Transaction.from(transaction.unsignedSerialized);
  signed.signature = Signature.from(signature);
  if (signed.from !== getAddress(expected)) throw new Error("Ledger signing address mismatch");
  return signed.serialized;
}

export async function signWithLedger(transaction: Transaction, expected: string) {
  const path = process.env.LEDGER_PATH;
  if (!path) throw new Error("Set LEDGER_PATH");
  const dmk = new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
  let sessionId: string | undefined;
  try {
    const device = await firstValueFrom(dmk.startDiscovering({}).pipe(timeout(10_000)));
    sessionId = await dmk.connect({ device });
    const signer = new SignerEthBuilder({ dmk, sessionId }).build();
    const address = await complete(signer.getAddress(path, { checkOnDevice: false }));
    if (getAddress(address.address) !== getAddress(expected)) throw new Error("Ledger address does not match configured deployer");
    console.log("Confirm the deployer address on Ledger, then review the deployment transaction.");
    await complete(signer.getAddress(path, { checkOnDevice: true, chainId: Number(transaction.chainId) }));
    const signature = await complete(signer.signTransaction(path, getBytes(transaction.unsignedSerialized)));
    return attachSignature(transaction, signature, expected);
  } finally {
    try { if (sessionId) await dmk.disconnect({ sessionId }); }
    finally { dmk.close(); }
  }
}
