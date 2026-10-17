import { useState } from "react";
import { api, setToken } from "../api";

export function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ token: string }>("/login", { password });
      setToken(r.token);
      location.hash = "#/";
      location.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>Вход в админку</h1>
      <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <button className="primary">Войти</button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
