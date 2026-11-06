import { useEffect, useState } from "react";
import { api } from "../api";

interface Row {
  enrollmentId: number;
  userId: number;
  telegramId: string | null;
  email?: string | null;
  username: string | null;
  name: string;
  displayName: string | null;
  seenBot: boolean;
  registeredAt: string;
  challenge: string;
  challengeId: number;
  durationDays: number;
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
  status: string;
}

interface AddResult {
  enrollmentId: number;
  created: boolean;
  startDate: string;
  name: string;
  telegramId: string | null;
  email?: string | null;
  seenBot: boolean;
  notified: boolean | null;
}

/** 2026-11-02 → 02.11.2026 */
const fmtDate = (d: string) => d.split("-").reverse().join(".");
const ST: Record<string, string> = { ACTIVE: "Активен", COMPLETED: "Завершил", CANCELLED: "Отключён" };

/** Бесплатный доступ к челленджу тому, кого выбрал организатор */
function AddParticipant({ chs, initial, onAdded }: { chs: Ch[]; initial: string; onAdded: () => void }) {
  const [challengeId, setChallengeId] = useState(initial);
  const [who, setWho] = useState("");
  const [today, setToday] = useState(false);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (initial) setChallengeId(initial);
  }, [initial]);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<AddResult>("/participants", { who, challengeId: Number(challengeId), startToday: today, notify });
      const title = chs.find((c) => String(c.id) === challengeId)?.title ?? "";
      const label = r.seenBot ? r.name : `${r.telegramId ? `Telegram ID ${r.telegramId}` : r.email}`;
      if (!r.created) {
        setMsg({ ok: true, text: `${label} уже участвует в «${title}», день 1: ${fmtDate(r.startDate)}. Ничего не меняли.` });
      } else {
        const parts = [`${label} добавлен в «${title}» бесплатно, день 1: ${fmtDate(r.startDate)}.`];
        if (!r.seenBot) {
          parts.push(
            "Этот человек ещё ни разу не открывал бота, поэтому бот не может ему написать. Проверьте, что ID верный, и попросите его открыть бота: челлендж уже будет его ждать.",
          );
        } else if (r.notified === true) parts.push("Бот отправил ему сообщение со ссылкой на челлендж.");
        else if (r.notified === false) parts.push("Написать ему в бот не получилось: похоже, он заблокировал бота. Доступ всё равно открыт.");
        setMsg({ ok: true, text: parts.join(" ") });
      }
      setWho("");
      onAdded();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Добавить участника бесплатно</h2>
      <p className="muted">Для подарков, тестов и оплат мимо Tribute: человек получает доступ к челленджу без оплаты.</p>
      {msg && <div className={msg.ok ? "ok" : "error"}>{msg.text}</div>}
      <div className="row">
        <select value={challengeId} onChange={(e) => setChallengeId(e.target.value)}>
          <option value="">Выберите челлендж</option>
          {chs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.status === "DRAFT" ? " (черновик)" : c.status === "ARCHIVED" ? " (архив)" : ""}
            </option>
          ))}
        </select>
        <input placeholder="@username, Telegram ID или почта с сайта" value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === "Enter" && challengeId && who.trim() && add()} />
        <button className="primary" disabled={!challengeId || !who.trim() || busy} onClick={add}>
          Добавить бесплатно
        </button>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} /> День 1 сегодня
        </label>
        <label className="check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Написать ему в бот
        </label>
      </div>
      <p className="muted small">
        Без галочки «День 1 сегодня» он начинает завтра (или в дату открытия челленджа, если она ещё впереди). По @username находим того, кто уже
        открывал бота. Telegram ID можно узнать у @userinfobot.
      </p>
    </div>
  );
}

/** Окно «Изменить участника»: имя, день 1, статус, удаление */
function EditParticipant({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const initialName = row.displayName ?? row.name;
  const [name, setName] = useState(initialName);
  const [start, setStart] = useState(row.streamStart);
  const [status, setStatus] = useState(row.status);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const body: Record<string, string> = { status, startDate: start };
      if (name.trim() !== initialName) body.name = name;
      await api.put(`/participants/${row.enrollmentId}`, body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const text =
      `Удалить из «${row.challenge}»: ${row.name}, ${row.telegramId ? `Telegram ID ${row.telegramId}` : row.email}?\n\n` +
      "Его отчёты, баллы и место в рейтинге удалятся, вернуть их будет нельзя. Оплаты в разделе «Платежи» останутся.\n\n" +
      "Если нужно только закрыть доступ, поставьте статус «Отключён».";
    if (!confirm(text)) return;
    setBusy(true);
    try {
      await api.post(`/participants/${row.enrollmentId}/delete`);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{row.name}</h2>
        <p className="muted">
          {row.challenge} · {row.telegramId ? `Telegram ID ${row.telegramId}` : row.email}
          {row.username ? ` · @${row.username}` : ""} · оплата: {row.payment}
        </p>
        {err && <div className="error">{err}</div>}
        <label className="field">
          <span>Имя в рейтинге и чате (меняется во всех его челленджах)</span>
          <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>День 1</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <span className="muted small">Отчёты остаются на своих номерах дней, баллы и серия пересчитаются.</span>
        </label>
        <label className="field">
          <span>Статус</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(ST).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="muted small">«Отключён» закрывает доступ к челленджу и его чату, данные сохраняются.</span>
        </label>
        <div className="row space">
          <button className="danger" disabled={busy} onClick={remove}>Удалить участие</button>
          <div className="row" style={{ margin: 0 }}>
            <button onClick={onClose}>Отмена</button>
            <button className="primary" disabled={busy || !start} onClick={save}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Organizer {
  id: number;
  telegramId: string;
  username: string | null;
  name: string;
}

/** Организаторы участвуют в любом челлендже бесплатно и видят черновики */
function Organizers() {
  const [list, setList] = useState<Organizer[]>([]);
  const [who, setWho] = useState("");
  const [err, setErr] = useState("");
  const load = () => {
    api.get<Organizer[]>("/organizers").then(setList).catch((e) => setErr(e.message));
  };
  useEffect(load, []);
  const add = async () => {
    setErr("");
    try {
      await api.post("/organizers", { who });
      setWho("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async (o: Organizer) => {
    if (!confirm(`Убрать ${o.name} из организаторов? Его текущие участия останутся.`)) return;
    await api.post(`/organizers/${o.id}/remove`);
    load();
  };
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Организаторы</h2>
      <p className="muted">
        Организатор участвует в любом челлендже бесплатно: в приложении во вкладке «Челленджи» у него кнопка «Участвовать · бесплатно», его
        день 1 начинается сразу. Черновики он тоже видит, чтобы проверить челлендж до запуска.
      </p>
      {err && <div className="error">{err}</div>}
      {list.map((o) => (
        <div key={o.id} className="row">
          <b>{o.name}</b>
          <span className="muted">{o.username ? `@${o.username}` : ""} · ID {o.telegramId}</span>
          <button className="small" onClick={() => remove(o)}>Убрать</button>
        </div>
      ))}
      <div className="row">
        <input placeholder="@username, Telegram ID или почта с сайта" value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="primary" disabled={!who.trim()} onClick={add}>Сделать организатором</button>
      </div>
      <p className="muted small">По @username находим того, кто уже открывал бота. Если не находится, нажмите «Старт» в боте и попробуйте снова.</p>
    </div>
  );
}

export function Participants({ initialChallenge }: { initialChallenge: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [chs, setChs] = useState<Ch[]>([]);
  const [challenge, setChallenge] = useState(initialChallenge);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);

  const load = () => {
    const p = new URLSearchParams();
    if (challenge) p.set("challengeId", challenge);
    if (q) p.set("q", q);
    api.get<Row[]>(`/participants?${p}`).then(setRows).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    api.get<Ch[]>("/challenges").then(setChs);
  }, []);
  useEffect(load, [challenge]);

  const sorted = challenge ? [...rows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)) : rows;

  const exportCsv = () => {
    const head = ["telegramId", "username", "name", "registeredAt", "challenge", "day1", "payment", "day", "streak", "points", "rank", "status"];
    const lines = sorted.map((r) =>
      [r.telegramId ?? r.email ?? "", r.username ?? "", r.name, r.registeredAt.slice(0, 10), r.challenge, r.streamStart, r.payment, r.day, r.currentStreak, r.points, r.rank ?? "", r.status]
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
  const remove = async (r: Row) => {
    const text =
      `Удалить из «${r.challenge}»: ${r.name}, ${r.telegramId ? `Telegram ID ${r.telegramId}` : r.email}?\n\n` +
      "Его отчёты, баллы и место в рейтинге удалятся, вернуть их будет нельзя. Оплаты в разделе «Платежи» останутся.\n\n" +
      "Если нужно только закрыть доступ, нажмите «Отключить».";
    if (!confirm(text)) return;
    try {
      await api.post(`/participants/${r.enrollmentId}/delete`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <h1>Участники {challenge ? "и рейтинг челленджа" : ""}</h1>
      <AddParticipant chs={chs} initial={challenge} onAdded={load} />
      <Organizers />
      {err && <div className="error">{err}</div>}
      <div className="row">
        <select value={challenge} onChange={(e) => setChallenge(e.target.value)}>
          <option value="">Все челленджи</option>
          {chs.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
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
              <td>{r.telegramId ?? <span className="muted">{r.email}</span>}</td>
              <td>
                {r.name}
                {r.botBlocked && <span className="muted"> (бот заблокирован)</span>}
                {!r.seenBot && <div className="muted small">ещё не открывал бота</div>}
              </td>
              <td>{r.username ? `@${r.username}` : ""}</td>
              <td>{r.registeredAt.slice(0, 10)}</td>
              <td>{r.challenge}<div className="muted">день 1: {r.streamStart}</div></td>
              <td>{r.payment}</td>
              <td>{r.day < 1 ? "до старта" : r.day > r.durationDays ? "завершил" : r.day}</td>
              <td>🔥 {r.currentStreak} <span className="muted">(рекорд {r.bestStreak})</span></td>
              <td><b>{r.points}</b></td>
              <td>{ST[r.status]}</td>
              <td>
                <div className="actions">
                  <button className="small" onClick={() => setEditing(r)}>Изменить</button>
                  {r.status !== "CANCELLED" ? (
                    <button className="small" onClick={() => setStatus(r.enrollmentId, "CANCELLED")}>Отключить</button>
                  ) : (
                    <button className="small" onClick={() => setStatus(r.enrollmentId, "ACTIVE")}>Вернуть</button>
                  )}
                  <button className="small danger" onClick={() => remove(r)}>Удалить</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!sorted.length && <p className="muted">Никого не нашли.</p>}
      {editing && (
        <EditParticipant
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}
