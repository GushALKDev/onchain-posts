import { AccountTypeEnum, ChainTypeEnum, EmbeddedState, Openfort, OpenfortConfiguration, RecoveryMethod, ShieldConfiguration } from '@openfort/openfort-js';
import { getAddress, recoverTypedDataAddress, type Hex, type TypedDataDefinition } from 'viem';
import type { PostSigner } from './signer.ts';

const env = import.meta.env;

/** Openfort is used when both public keys are set; otherwise the app falls back to the development signer. */
export const OPENFORT_CONFIGURED = Boolean(env.VITE_OPENFORT_PUBLISHABLE_KEY && env.VITE_OPENFORT_SHIELD_PUBLISHABLE_KEY);

let client: Openfort | null = null;

export function openfortClient(): Openfort {
  client ??= new Openfort({
    baseConfiguration: new OpenfortConfiguration({ publishableKey: env.VITE_OPENFORT_PUBLISHABLE_KEY ?? '' }),
    shieldConfiguration: new ShieldConfiguration({ shieldPublishableKey: env.VITE_OPENFORT_SHIELD_PUBLISHABLE_KEY ?? '' }),
  });
  return client;
}

export { EmbeddedState };

/** bigint is not JSON-serialisable; EIP-712 integers are passed as decimal strings to the signer. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

/**
 * Embedded EOA used only as a signing identity (ADR-011): EOA account type, password recovery, so the platform cannot
 * reconstruct the key. It never sends a transaction.
 */
export async function configureWallet(openfort: Openfort, password: string): Promise<void> {
  await openfort.embeddedWallet.configure({
    recoveryParams: { recoveryMethod: RecoveryMethod.PASSWORD, password },
    chainType: ChainTypeEnum.EVM,
    accountType: AccountTypeEnum.EOA,
  });
}

export async function openfortSigner(openfort: Openfort, label: string): Promise<PostSigner> {
  const account = await openfort.embeddedWallet.get();
  const address = getAddress(account.address);
  return {
    kind: 'openfort',
    label,
    address,
    async signTypedData(definition: TypedDataDefinition) {
      const { domain, types, message } = definition as unknown as { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; message: Record<string, unknown> };
      const signature = (await openfort.embeddedWallet.signTypedData(domain as never, types as never, jsonSafe(message) as never)) as Hex;
      // The signature must recover to this account for exactly this payload; this also catches a signer that would add
      // a chainId to the chain-agnostic "Phi Posts" domain (ADR-011, ADR-012).
      const recovered = await recoverTypedDataAddress({ ...(definition as object), signature } as Parameters<typeof recoverTypedDataAddress>[0]);
      if (recovered !== address) throw new Error('Openfort returned a signature that does not match this payload and account');
      return signature;
    },
    signMessage: async (message: string) => (await openfort.embeddedWallet.signMessage(message)) as Hex,
  };
}
