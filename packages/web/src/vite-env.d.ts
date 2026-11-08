/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Comma-separated gateways tried in order. */
  readonly VITE_ARWEAVE_GATEWAYS?: string;
  readonly VITE_ARWEAVE_GRAPHQL?: string;
  readonly VITE_DEMO_MODE?: string;
  /** Comma-separated chain IDs offered in the composer. */
  readonly VITE_CHAINS?: string;
  readonly VITE_RPC_11155111?: string;
  readonly VITE_RPC_84532?: string;
  readonly VITE_RPC_421614?: string;
  readonly VITE_OPENFORT_PUBLISHABLE_KEY?: string;
  readonly VITE_OPENFORT_SHIELD_PUBLISHABLE_KEY?: string;
}
