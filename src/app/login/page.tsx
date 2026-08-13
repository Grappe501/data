import { loginAction } from "@/app/login/actions";
import { getAdminSecret } from "@/lib/auth";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const configured = Boolean(getAdminSecret());

  return (
    <div className="wrap">
      <p className="kicker">Contact Intelligence</p>
      <h1>Sign in</h1>
      <p className="lede">Use the same Campaign Manager passphrase as RedDirt (`ADMIN_SECRET`).</p>
      {error === "config" ? <p className="banner banner-error">ADMIN_SECRET is not set.</p> : null}
      {error === "auth" ? <p className="banner banner-error">That passphrase did not match.</p> : null}
      {configured ? (
        <form action={loginAction} className="card" style={{ maxWidth: 420 }}>
          <label>
            Passphrase
            <input name="password" type="password" autoComplete="current-password" />
          </label>
          <p>
            <button className="btn btn-primary" type="submit">
              Sign in
            </button>
          </p>
        </form>
      ) : (
        <p className="muted">Login is disabled until ADMIN_SECRET is available from RedDirt env.</p>
      )}
    </div>
  );
}
