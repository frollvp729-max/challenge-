import { useEffect, useState } from "react";
import { api } from "../api";

interface Msg {
  id: number;
  text: string;
  photoUrl: string | null;
  deleted: boolean;
  createdAt: string;
  author: { userId: number | null; name: string; organizer: boolean; badge: string | null; banned: boolean };
  replyTo: { id: number; name: string; text: string } | null;
}
interface Ch {
  id: number;
  title: string;
  status: string;
}

export function Chats() {
  const [chs, setChs] = useState<Ch[]>([]);
  const [challenge, setChallenge] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<Ch[]>("/challenges").then((list) => {
      setChs(list);
      const first = list.find((c) => c.status === "ACTIVE") ?? list[0];
      if (first) setChallenge(String(first.id));
    });
  }, []);

  const load = () => {
    if (!challenge) return;
    api
      .get<Msg[]>(`/chat?challengeId=${challenge}`)
      .then((m) => setMsgs(m.reverse()))
      .catch((e) => setErr(e.message));
  };
  useEffect(load, [challenge]);

  const send = async () => {
    if (!text.trim()) return;
    try {
      await api.post("/chat", { challengeId: Number(challenge), text, replyToId: replyTo?.id ?? null });
      setText("");
      setReplyTo(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const del = async (m: Msg) => {
    await api.post(`/chat/${m.id}/delete`, { deleted: !m.deleted });
    load();
  };
  const ban = async (m: Msg) => {
    if (!m.author.userId) return;
    const banned = !m.author.banned;
    if (banned && !confirm(`Запретить ${m.author.name} писать во все чаты?`)) return;
    await api.post(`/chat/users/${m.author.userId}/ban`, { banned });
    load();
  };

  return (
    <>
      <h1>Чаты участников</h1>
      <div className="row">
        <select value={challenge} onChange={(e) => setChallenge(e.target.value)}>
          {chs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button onClick={load}>Обновить</button>
      </div>
      <p className="muted">
        В чате каждого челленджа пишут только те, кто его оплатил. Ваши сообщения подписаны «Организатор». Удалённое сообщение участники видят как «Сообщение удалено».
      </p>
      {err && <div className="error">{err}</div>}

      <div className="panel">
        {replyTo && (
          <div className="row small">
            Ответ на сообщение <b>{replyTo.author.name}</b>: «{replyTo.text.slice(0, 80)}»
            <button className="small" onClick={() => setReplyTo(null)}>
              отменить
            </button>
          </div>
        )}
        <textarea rows={3} placeholder="Сообщение от организатора" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button className="btn" onClick={send} disabled={!text.trim()}>
            Отправить в чат
          </button>
        </div>
      </div>

      {msgs.length === 0 && <p className="muted">В этом чате пока нет сообщений.</p>}
      <div className="chat-list">
        {msgs.map((m) => (
          <div key={m.id} className={`rcard${m.deleted ? " rejected" : ""}`}>
            <div className="row space">
              <b>
                {m.author.name}
                {m.author.organizer && <span className="badge">организатор</span>}
                {m.author.badge && <span className="badge">{m.author.badge}</span>}
                {m.author.banned && <span className="badge">не может писать</span>}
              </b>
              <span className="muted small">{new Date(m.createdAt).toLocaleString("ru")}</span>
            </div>
            {m.replyTo && (
              <div className="muted small">
                ↩ {m.replyTo.name}: «{m.replyTo.text}»
              </div>
            )}
            {m.photoUrl && (
              <a href={m.photoUrl} target="_blank" rel="noreferrer">
                <img src={m.photoUrl} alt="" style={{ maxHeight: 200 }} />
              </a>
            )}
            {m.text && <p style={{ whiteSpace: "pre-wrap" }}>{m.text}</p>}
            <div className="row">
              <button className="small" onClick={() => setReplyTo(m)}>
                Ответить
              </button>
              <button className="small" onClick={() => del(m)}>
                {m.deleted ? "Вернуть" : "Удалить"}
              </button>
              {m.author.userId && (
                <button className="small" onClick={() => ban(m)}>
                  {m.author.banned ? "Разрешить писать" : "Запретить писать"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
