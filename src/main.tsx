import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './lib/store';
import { createDemoSource } from './lib/data/demoSource';
import { createSupabaseSource } from './lib/data/supabaseSource';
import './styles.css';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const DEMO = import.meta.env.MODE === 'demo' || !URL_ || !KEY;

function DemoRoot() {
  const source = useMemo(createDemoSource, []);
  return (
    <StoreProvider source={source}>
      <App onResetDemo={() => source.reset()} />
    </StoreProvider>
  );
}

function SupabaseRoot() {
  const source = useMemo(() => createSupabaseSource(URL_!, KEY!), []);
  const [session, setSession] = useState<any>(undefined);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    source.client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = source.client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [source]);

  if (session === undefined) return <div className="pad muted">Loading…</div>;
  if (!session) {
    return (
      <div className="login">
        <form className="panel" onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          const { error } = await source.client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
          if (error) setErr(error.message); else setSent(true);
        }}>
          <div className="brand"><span className="brand-mark">SDR</span> Renovation PM</div>
          {sent ? <p>Check <b>{email}</b> for a sign-in link.</p> : (
            <>
              <label className="field"><span>Work email</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@sdandr.com" />
              </label>
              <button className="primary" type="submit">Email me a sign-in link</button>
            </>
          )}
          {err && <div className="err">{err}</div>}
        </form>
      </div>
    );
  }
  return (
    <StoreProvider source={source}>
      <App onSignOut={() => source.client.auth.signOut()} />
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{DEMO ? <DemoRoot /> : <SupabaseRoot />}</StrictMode>,
);
