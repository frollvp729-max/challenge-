import { useEffect, useState } from "react";
import { api } from "../api";

interface Row {
  enrollmentId: number;
  telegramId: string;
  username: string | null;
  name: string;
  registeredAt: string;
  challenge: string;
  streamStart: string;
  payment: string;
  day: number;
  currentStreak: number;
  bestStreak: number;
  points: number;
  doneCount: number;
  rank: number | null;
  status: string;
  botBlocked: boolean;
}
interface Ch {
  id: number;
  title: string;
  streams: { id: number; startDate: string; title: string }[];
}

const ST: Record<string, string> = { ACTIVE: "Активен", COMPLETED: "Завершил", CANCELLED: "Отключён" };

export function Participants({ initialStream }: { initialStream: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [chs, setChs] = useState<Ch[]>([]);
  const [stream, setStream] = useState(initialStream);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [grantTg, setGrantTg] = useState("");

  const load = () => {
    const p = new URLSearchParams();
    if (stream) p.set("streamId", stream);
    if (q) p.set("q", q);
    api.get<Row[]>(`/participants?${p}`).then(setRows).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    api.get<Ch[]>("/challenges").then(setChs);
  }, []);
  useEffect(load, [stream]);

  const sorted = stream ? [...rows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)) : rows;

  const exportCsv = () => {
    const head = ["telegramId", "username", "name", "registeredAt", "challenge", "streamStart", "payment", "day", "streak", "points", "rank", "status"];
    const lines = sorted.map((r) =>
      [r.telegramId, r.username ?? "", r.name, r.registeredAt.slice(0, 10), r.challenge, r.streamStart, r.payment, r.day, r.currentStreak, r.points, r.rank ?? "", r.status]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "participants.csv";
    a.click();
  };

  const setStatus = async (id: number, status: string) => {
    await api.put(`/participants/${id}`, { status });
    load();
  };
  const grant = async () => {
    try {
      await api.post("/participants", { telegramId: grantTg, streamId: Number(stream) });
      setGrantTg("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <h1>Участники {stream ? "и рейтинг потока" : ""}</h1>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <select value={stream} onChange={(e) => setStream(e.target.value)}>
          <option value="">Все потоки</option>
          {chs.flatMap((c) =>
            c.streams.map((s) => (
              <option key={s.id} value={s.id}>
                {c.title} — {s.startDate} {s.title}
              </option>
            )),
          )}
        </select>
        <input placeholder="Поиск: имя, @username, Telegram ID" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button onClick={load}>Найти</button>
        <button onClick={exportCsv}>CSV</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Место</th><th>Telegram ID</th><th>Имя</th><th>Username</th><th>Регистрация</th><th>Челлендж</th><th>Оплата</th>
            <th>День</th><th>Серия</th><th>Баллы</th><th>Статус</th><th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.enrollmentId}>
              <td>{r.rank ?? "—"}</td>
              <td>{r.telegramId}</td>
              <td>{r.name}{r.botBlocked && <span className="muted"> (бот заблокирован)</span>}</td>
              <td>{r.username ? `@${r.username}` : ""}</td>
              <td>{r.registeredAt.slice(0, 10)}</td>
              <td>{r.challenge}<div className="muted">{r.streamStart}</div></td>
              <td>{r.payment}</td>
              <td>{r.day < 1 ? "до старта" : r.day}</td>
              <td>🔥 {r.currentStreak} <span className="muted">(рекорд {r.bestStreak})</span></td>
              <td><b>{r.points}</b></td>
              <td>{ST[r.status]}</td>
              <td>
                {r.status !== "CANCELLED" ? (
                  <button className="small" onClick={() => setStatus(r.enrollmentId, "CANCELLED")}>Отключить</button>
                ) : (
                  <button className="small" onClick={() => setStatus(r.enrollmentId, "ACTIVE")}>Вернуть</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {stream && (
        <>
          <h2>Добавить участника вручную</h2>
          <div className="row">
            <input placeholder="Telegram ID" value={grantTg} onChange={(e) => setGrantTg(e.target.value.replace(/\D/g, ""))} />
            <button className="primary" disabled={!grantTg} onClick={grant}>Добавить в поток</button>
          </div>
          <p className="muted">Для подарков, тестов и оплат мимо Tribute. Telegram ID можно узнать у @userinfobot.</p>
        </>
      )}
    </>
  );
}
