import { useEffect, useState } from 'react';
import { EmbeddedState, configureWallet, openfortClient, openfortSigner } from '../openfort.ts';
import type { PostSigner } from '../signer.ts';

type Step = 'loading' | 'login' | 'otp' | 'password' | 'error';

/** Openfort sign-in: email code (or guest), then the wallet password that protects the recovery share (ADR-011). */
export function Access({ onReady }: { onReady: (signer: PostSigner) => void }) {
  const openfort = openfortClient();
  const [step, setStep] = useState<Step>('loading');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    const state = await openfort.embeddedWallet.getEmbeddedState();
    if (state === EmbeddedState.READY) onReady(await openfortSigner(openfort, 'Openfort embedded wallet'));
    else if (state === EmbeddedState.EMBEDDED_SIGNER_NOT_CONFIGURED) setStep('password');
    else setStep('login');
  }

  useEffect(() => {
    resume().catch((e) => {
      setError((e as Error).message);
      setStep('error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Sign in</h2>
      <p className="hint">Your account signs posts in the browser; the platform publishes them. Openfort learns your email and account address (ADR-011); your address never appears on-chain, on Arweave, or to other users.</p>
      {step === 'loading' && <p>Loading...</p>}
      {step === 'login' && (
        <>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <div className="actions">
            <button disabled={busy || !email} onClick={() => run(async () => { await openfort.auth.requestEmailOtp({ email }); setStep('otp'); })}>Send code</button>
            <button disabled={busy} onClick={() => run(async () => { await openfort.auth.signUpGuest(); await resume(); })}>Continue as guest</button>
          </div>
        </>
      )}
      {step === 'otp' && (
        <>
          <label>
            Code sent to {email}
            <input value={otp} onChange={(e) => setOtp(e.target.value.trim())} placeholder="123456" />
          </label>
          <button disabled={busy || !otp} onClick={() => run(async () => { await openfort.auth.logInWithEmailOtp({ email, otp }); await resume(); })}>Sign in</button>
        </>
      )}
      {step === 'password' && (
        <>
          <label>
            Wallet password (protects the recovery share of your key; the platform never sees it)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button disabled={busy || password.length < 8} onClick={() => run(async () => { await configureWallet(openfort, password); await resume(); })}>
            {busy ? 'Preparing wallet...' : 'Unlock wallet'}
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
