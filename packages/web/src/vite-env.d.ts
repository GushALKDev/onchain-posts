/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ARWEAVE_GATEWAY?: string;
  readonly VITE_DEMO_MODE?: string;
  /** Comma-separated chain IDs offered in the composer. */
  readonly VITE_CHAINS?: string;
  readonly VITE_RPC_11155111?: string;
  readonly VITE_RPC_84532?: string;
  readonly VITE_RPC_421614?: string;
}
