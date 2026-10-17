import { useEffect, useState } from "react";
import { api } from "../api";

interface Stats {
  today: string;
  users: number;
  enrollments: number;
  paymentsCount: number;
  revenue: number;
  newUsers7d: number;
  streams: { id: number; challenge: string; startDate: string; phase: string; day: number; participants: number; reportedToday: number }[];
}

const PHASE: Record<string, string> = { UPCOMING: "Скоро старт", RUNNING: "Идёт", FINISHED: "Завершён" };

export function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get<Stats>("/stats").then(setS).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="error">{err}</div>;
  if (!s) return <div>Загрузка…</div>;
  return (
    <>
      <h1>Статистика</h1>
      <div className="tiles">
        <div className="tile"><span>Пользователей</span><b>{s.users}</b></div>
        <div className="tile"><span>Новых за 7 дней</span><b>{s.newUsers7d}</b></div>
        <div className="tile"><span>Участий</span><b>{s.enrollments}</b></div>
        <div className="tile"><span>Оплат</span><b>{s.paymentsCount}</b></div>
        <div className="tile"><span>Сумма оплат (как присылает Tribute)</span><b>{s.revenue}</b></div>
      </div>
      <h2>Потоки</h2>
      <table>
        <thead>
          <tr><th>Челлендж</th><th>Старт</th><th>Статус</th><th>День</th><th>Участников</th><th>Отчитались сегодня</th><th></th></tr>
        </thead>
        <tbody>
          {s.streams.map((x) => (
            <tr key={x.id}>
              <td>{x.challenge}</td>
              <td>{x.startDate}</td>
              <td>{PHASE[x.phase]}</td>
              <td>{x.phase === "RUNNING" ? x.day : "—"}</td>
              <td>{x.participants}</td>
              <td>
                {x.phase === "RUNNING" ? `${x.reportedToday} (${x.participants ? Math.round((x.reportedToday / x.participants) * 100) : 0}%)` : "—"}
              </td>
              <td><a href={`#/participants?stream=${x.id}`}>участники →</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
