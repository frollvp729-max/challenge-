import { useEffect, useState } from "react";
import { api } from "../api";

interface Row {
  id: number;
  slug: string;
  title: string;
  tagline: string;
  status: string;
  priceRub: number;
  daysCount: number;
  durationDays: number;
  participants: number;
}

export const STATUS: Record<string, string> = { DRAFT: "Черновик", ACTIVE: "Активен", ARCHIVED: "Архив" };

export function Challenges() {
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [err, setErr] = useState("");
  const load = () => api.get<Row[]>("/challenges").then(setRows).catch((e) => setErr(e.message));
  useEffect(() => void load(), []);
  const create = async () => {
    try {
      const c = await api.post<{ id: number }>("/challenges", { title, slug, status: "DRAFT" });
      await api.post(`/challenges/${c.id}/days/generate`);
      location.hash = `#/challenges/${c.id}`;
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <h1>Челленджи</h1>
      {err && <div className="error">{err}</div>}
      <table>
        <thead>
          <tr><th>#</th><th>Название</th><th>Описание</th><th>Дней</th><th>Цена</th><th>Участников</th><th>Статус</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="link" onClick={() => (location.hash = `#/challenges/${r.id}`)}>
              <td>{i + 1}</td>
              <td><b>{r.title}</b></td>
              <td className="muted">{r.tagline}</td>
              <td>{r.daysCount}/{r.durationDays}</td>
              <td>{r.priceRub} ₽</td>
              <td>{r.participants}</td>
              <td><span className={`badge ${r.status}`}>{STATUS[r.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Новый челлендж</h2>
      <div className="row">
        <input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="slug (латиницей, для ссылок)" value={slug} onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, ""))} />
        <button className="primary" disabled={!title || !slug} onClick={create}>Создать</button>
      </div>
      <p className="muted">Порядок запуска: название → 30 заданий → правила → цена и Tribute → поток с датой старта → статус «Активен».</p>
    </>
  );
}
