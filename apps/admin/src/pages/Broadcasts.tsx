import { useEffect, useState } from "react";
import { api } from "../api";

interface B {
  id: number;
  text: string;
  audience: string;
  status: string;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}
interface Ch {
  id: number;
  title: string;
  streams: { id: number; startDate: string }[];
}

export function Broadcasts() {
  const [list, setList] = useState<B[]>([]);
  const [chs, setChs] = useState<Ch[]>([]);
  const [text, setText] = useState("");
  const [audience, setAudience] = useState("all");
  const [target, setTarget] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [err, setErr] = useState("");
  const load = () => api.get<B[]>("/broadcasts").then(setList);
  useEffect(() => {
    void load();
    api.get<Ch[]>("/challenges").then(setChs);
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const send = async () => {
    if (!confirm("Отправить рассылку? Отменить её после отправки нельзя.")) return;
    try {
      await api.post("/broadcasts", {
        text,
        audience,
        challengeId: audience === "challenge" ? target : null,
        streamId: audience === "stream" ? target : null,
        buttonText: buttonText || null,
      });
      setText("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <h1>Рассылка</h1>
      {err && <div className="error">{err}</div>}
      <div className="panel">
        <label className="field">
          <span>Текст (HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;, &lt;a href=""&gt;ссылка&lt;/a&gt;)</span>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row">
          <select value={audience} onChange={(e) => { setAudience(e.target.value); setTarget(""); }}>
            <option value="all">Все пользователи бота</option>
            <option value="challenge">Участники челленджа</option>
            <option value="stream">Участники потока</option>
          </select>
          {audience === "challenge" && (
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— выбери —</option>
              {chs.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
          {audience === "stream" && (
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— выбери —</option>
              {chs.flatMap((c) => c.streams.map((s) => <option key={s.id} value={s.id}>{c.title} — {s.startDate}</option>))}
            </select>
          )}
          <input placeholder="Кнопка «открыть приложение» (необязательно)" value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
        </div>
        <button className="primary" disabled={!text.trim() || (audience !== "all" && !target)} onClick={send}>
          Отправить
        </button>
      </div>
      <h2>История</h2>
      <table>
        <thead><tr><th>Дата</th><th>Текст</th><th>Кому</th><th>Статус</th><th>Доставлено</th><th>Ошибок</th></tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.id}>
              <td>{new Date(b.createdAt).toLocaleString("ru")}</td>
              <td className="clip">{b.text}</td>
              <td>{b.audience}</td>
              <td>{{ pending: "в очереди", sending: "отправляется", done: "готово" }[b.status] ?? b.status}</td>
              <td>{b.sentCount}</td>
              <td>{b.failedCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
