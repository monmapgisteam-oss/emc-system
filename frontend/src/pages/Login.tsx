import { useState } from "react";
import { api, AuthUser } from "../api";

export default function Login({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api.login(username, password));
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden />
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <img src="/img/logo.png" alt="Эрдэнэт үйлдвэр ТӨҮГ" />
        </div>
        <h1>Нэгдсэн систем</h1>
        <p className="login-sub">Эрдэнэт үйлдвэрийн мэдээллийн нэгдсэн орчин</p>

        <label className="login-field">
          <span>Нэвтрэх нэр</span>
          <input
            type="text"
            autoComplete="username"
            autoFocus
            placeholder="ArcGIS хэрэглэгчийн нэр"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="login-field">
          <span>Нууц үг</span>
          <div className="pw">
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? "Нуух" : "Харуулах"}>
              {show ? "Нуух" : "Харуулах"}
            </button>
          </div>
        </label>

        {error && <div className="login-error" role="alert">{error}</div>}

        <button type="submit" className="login-btn" disabled={busy || !username || !password}>
          {busy ? "Шалгаж байна…" : "Нэвтрэх"}
        </button>

        <div className="login-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
          </svg>
          <span>
            Зөвхөн Эрдэнэт үйлдвэрийн <b>ArcGIS Online (EMC)</b> эрхээр нэвтэрнэ. Нууц үг тань манай серверт хадгалагдахгүй.
          </span>
        </div>
      </form>
      <footer className="login-foot">© {new Date().getFullYear()} Эрдэнэт үйлдвэр ТӨҮГ · Утас: 7035-1111</footer>
    </div>
  );
}
