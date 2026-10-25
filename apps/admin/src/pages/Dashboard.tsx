import { useEffect, useState } from "react";
import { api } from "../api";

interface Stats {
  today: string;
  users: number;
  enrollments: number;
  paymentsCount: number;
  revenue: number;
  newUsers7d: number;
  byChallenge: {
    id: number;
    challenge: string;
    startDate: string | null;
    running: number;
    upcoming: number;
    finished: number;
    participants: number;
    reportedToday: number;
  }[];
}

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
      <h2>Челленджи</h2>
      <p className="muted">У каждого участника свои 30 дней, поэтому «сегодня» у всех разный день.</p>
      <table>
        <thead>
          <tr><th>Челлендж</th><th>Открытие</th><th>Ждут старта</th><th>Проходят</th><th>Завершили</th><th>Отчитались сегодня</th><th></th></tr>
        </thead>
        <tbody>
          {s.byChallenge.map((x) => (
            <tr key={x.id}>
              <td>{x.challenge}</td>
              <td>{x.startDate ? x.startDate.split("-").reverse().join(".") : "—"}</td>
              <td>{x.upcoming}</td>
              <td>{x.running}</td>
              <td>{x.finished}</td>
              <td>{x.running ? `${x.reportedToday} (${Math.round((x.reportedToday / x.running) * 100)}%)` : "—"}</td>
              <td><a href={`#/participants?challenge=${x.id}`}>участники →</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
