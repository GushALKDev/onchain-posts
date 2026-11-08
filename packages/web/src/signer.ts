import type { Address, Hex, TypedDataDefinition } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

/**
 * The account that signs intents. Production: the Openfort embedded EOA (ADR-011), used only as a signing identity.
 * Until an Openfort project is configured, the app uses a development key kept in this browser.
 */
export interface PostSigner {
  kind: 'development' | 'openfort';
  label: string;
  /** Used only locally (IndexedDB ownership); never shown to other users or sent anywhere in clear. */
  address: Address;
  signTypedData(definition: TypedDataDefinition): Promise<Hex>;
  signMessage(message: string): Promise<Hex>;
}

const DEV_KEY = 'phi-development-key';

/** Development signer: a random key in localStorage. Not a wallet: clearing site data loses it. */
export function developmentSigner(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): PostSigner {
  let key = storage.getItem(DEV_KEY) as Hex | null;
  if (!key) {
    key = generatePrivateKey();
    storage.setItem(DEV_KEY, key);
  }
  const account = privateKeyToAccount(key);
  return {
    kind: 'development',
    label: 'Development key in this browser (Openfort not configured)',
    address: account.address,
    signTypedData: (definition) => account.signTypedData(definition),
    signMessage: (message) => account.signMessage({ message }),
  };
}
