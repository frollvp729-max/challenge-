import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type ChatMessage, type ChatPage, type ChatSummary, type State } from "./api";
import type { Screen } from "./App";
import { Avatar, Icon, IconTile } from "./icons";
import { alertMsg, compressImage, haptic, humanDate, plural } from "./util";

const POLL_MS = 4000;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(iso: string) {
  const key = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return "Сегодня";
  if (key === dayKey(y.toISOString())) return "Вчера";
  return humanDate(key);
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
const scrollToBottom = () => window.scrollTo(0, document.documentElement.scrollHeight);

// ---------------- Карточка на главной ----------------

export function ChatCard({ state, go }: { state: State; go: (s: Screen) => void }) {
  const [sum, setSum] = useState<ChatSummary | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<ChatSummary>(`/enrollments/${state.enrollmentId}/chat/summary`)
        .then((s) => alive && setSum(s))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [state.enrollmentId]);
  if (!state.challenge.chatEnabled || (sum && !sum.enabled)) return null;
  const unread = sum?.unread ?? 0;
  return (
    <button className="card chat-card" onClick={() => go("chat")}>
      <IconTile icon="chat" tone="rank" />
      <span className="chat-card-body">
        <span className="chat-card-title">Чат участников</span>
        <span className="chat-card-last">
          {sum?.last ? (
            <>
              <b>{sum.last.name}:</b> {sum.last.text}
            </>
          ) : (
            "Знакомьтесь и поддерживайте друг друга"
          )}
        </span>
      </span>
      {unread > 0 ? <span className="chat-unread">{unread > 99 ? "99+" : unread}</span> : <Icon name="chevron" size={16} weight="bold" />}
    </button>
  );
}

// ---------------- Экран чата ----------------

function Bubble({
  m,
  first,
  open,
  onToggle,
  onReply,
  onDelete,
  onPhoto,
  onImageLoad,
}: {
  m: ChatMessage;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  onReply: () => void;
  onDelete: () => void;
  onPhoto: (url: string) => void;
  onImageLoad: () => void;
}) {
  const mine = m.author.isMe;
  const cls = `msg${mine ? " mine" : ""}${m.author.organizer ? " org" : ""}${first ? " first" : ""}`;
  return (
    <div className={cls} id={`m${m.id}`}>
      {!mine && (
        <div className="msg-ava">
          {first && (m.author.organizer ? <IconTile icon="seal" tone="rank" size="sm" /> : <Avatar name={m.author.name} photo={m.author.photoUrl} size={34} />)}
        </div>
      )}
      <div className="msg-col">
        <div className={`bubble${m.deleted ? " deleted" : ""}`} onClick={m.deleted ? undefined : onToggle}>
          {!mine && first && (
            <div className="msg-author">
              <span>{m.author.name}</span>
              {!m.author.organizer && m.author.badge && <span className="msg-badge">{m.author.badge}</span>}
            </div>
          )}
          {m.replyTo && (
            <div
              className="msg-quote"
              onClick={(e) => {
                e.stopPropagation();
                document.getElementById(`m${m.replyTo!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              <b>{m.replyTo.name}</b>
              <span>{m.replyTo.text}</span>
            </div>
          )}
          {m.deleted ? (
            <span className="msg-text">Сообщение удалено</span>
          ) : (
            <>
              {m.photoUrl && (
                <img
                  className="msg-photo"
                  src={m.photoUrl}
                  alt=""
                  onLoad={onImageLoad}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPhoto(m.photoUrl!);
                  }}
                />
              )}
              {m.text && <span className="msg-text">{m.text}</span>}
            </>
          )}
          <span className="msg-time">{timeOf(m.createdAt)}</span>
        </div>
        {open && (
          <div className="msg-actions">
            <button onClick={onReply}>
              <Icon name="reply" size={16} weight="bold" /> Ответить
            </button>
            {mine && (
              <button className="danger" onClick={onDelete}>
                <Icon name="trash" size={16} weight="bold" /> Удалить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Chat({ state }: { state: State }) {
  const base = `/enrollments/${state.enrollmentId}/chat`;
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [members, setMembers] = useState<number | null>(null);
  const [banned, setBanned] = useState(false);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const msgsRef = useRef<ChatMessage[]>([]);
  const stick = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [pad, setPad] = useState(96);
  msgsRef.current = msgs ?? [];

  const lastId = () => msgsRef.current[msgsRef.current.length - 1]?.id ?? 0;

  const markRead = useCallback(
    (id: number) => {
      if (id) void api.post(`${base}/read`, { lastId: id }).catch(() => undefined);
    },
    [base],
  );

  // первая загрузка
  useEffect(() => {
    api
      .get<ChatPage>(base)
      .then((p) => {
        setMsgs(p.messages);
        setHasMore(p.hasMore);
        setMembers(p.members ?? null);
        setBanned(p.banned);
        markRead(p.messages[p.messages.length - 1]?.id ?? 0);
      })
      .catch((e) => setError((e as Error).message));
  }, [base, markRead]);

  // новые сообщения: опрос раз в несколько секунд, пока экран открыт
  useEffect(() => {
    if (msgs === null) return;
    let alive = true;
    const tick = async () => {
      const after = lastId();
      const from = msgsRef.current[0]?.id ?? 0;
      if (!after) {
        const p = await api.get<ChatPage>(base).catch(() => null);
        if (alive && p && p.messages.length) {
          stick.current = true;
          setMsgs(p.messages);
          markRead(p.messages[p.messages.length - 1].id);
        }
        return;
      }
      const p = await api.get<ChatPage>(`${base}?after=${after}&from=${from}`).catch(() => null);
      if (!alive || !p) return;
      setBanned(p.banned);
      if (p.messages.length || p.deletedIds.length) {
        stick.current = nearBottom();
        setMsgs((cur) => {
          const del = new Set(p.deletedIds);
          const known = new Set((cur ?? []).map((m) => m.id));
          const kept = (cur ?? []).map((m) => (del.has(m.id) && !m.deleted ? { ...m, deleted: true, text: "", photoUrl: null } : m));
          return [...kept, ...p.messages.filter((m) => !known.has(m.id))];
        });
        if (p.messages.length) markRead(p.messages[p.messages.length - 1].id);
      }
    };
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [msgs === null, base, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // запоминаем, читает ли человек низ ленты: тогда новые сообщения прокручивают её
  useEffect(() => {
    const on = () => {
      stick.current = nearBottom();
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // держим ленту внизу, если человек и так был внизу
  useLayoutEffect(() => {
    if (msgs && stick.current) scrollToBottom();
  }, [msgs]);

  const loadOlder = async () => {
    const first = msgsRef.current[0];
    if (!first) return;
    const h = document.documentElement.scrollHeight;
    const p = await api.get<ChatPage>(`${base}?before=${first.id}`).catch((e) => {
      alertMsg((e as Error).message);
      return null;
    });
    if (!p) return;
    stick.current = false;
    setHasMore(p.hasMore);
    setMsgs((cur) => [...p.messages, ...(cur ?? [])]);
    // остаёмся на том же месте ленты
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight - h + window.scrollY));
  };

  const append = (m: ChatMessage) => {
    stick.current = true;
    setMsgs((cur) => ((cur ?? []).some((x) => x.id === m.id) ? cur : [...(cur ?? []), m]));
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const r = await api.post<{ message: ChatMessage }>(base, { text: t, replyToId: replyTo?.id ?? null });
      append(r.message);
      setText("");
      setReplyTo(null);
      haptic("success");
    } catch (e) {
      alertMsg((e as Error).message);
    } finally {
      setSending(false);
      areaRef.current?.focus();
    }
  };

  const sendPhoto = async (file: File) => {
    setSending(true);
    try {
      const blob = await compressImage(file);
      const fields: Record<string, string> = { text: text.trim() };
      if (replyTo) fields.replyToId = String(replyTo.id);
      const r = await api.upload<{ message: ChatMessage }>(`${base}/photo`, blob, "photo.jpg", fields);
      append(r.message);
      setText("");
      setReplyTo(null);
      haptic("success");
    } catch (e) {
      alertMsg((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (m: ChatMessage) => {
    setOpenId(null);
    const ok = await new Promise<boolean>((res) => {
      const tg = window.Telegram?.WebApp;
      if (tg?.initData && tg.showConfirm) tg.showConfirm("Удалить сообщение?", res);
      else res(confirm("Удалить сообщение?"));
    });
    if (!ok) return;
    try {
      await api.post(`${base}/${m.id}/delete`);
      setMsgs((cur) => (cur ?? []).map((x) => (x.id === m.id ? { ...x, deleted: true, text: "", photoUrl: null } : x)));
    } catch (e) {
      alertMsg((e as Error).message);
    }
  };

  // поле ввода растёт вместе с текстом
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // нижний отступ ленты равен высоте поля ввода (оно растёт с текстом и цитатой ответа)
  useEffect(() => {
    const el = composerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const wasBottom = stick.current;
      setPad(el.offsetHeight + 16);
      if (wasBottom) requestAnimationFrame(scrollToBottom);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [msgs === null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="center muted">{error}</div>;

  return (
    <div className="page chat-page" style={{ paddingBottom: pad }}>
      <header className="chat-head">
        <IconTile icon="users" tone="rank" />
        <div>
          <h1 className="chat-title">Чат участников</h1>
          <p className="subtitle">
            {state.challenge.title}
            {members !== null && ` · ${members} ${plural(members, "участник", "участника", "участников")}`}
          </p>
        </div>
      </header>

      {msgs === null ? (
        <div className="muted center">Загрузка…</div>
      ) : (
        <div className="chat-feed" onClick={(e) => e.target === e.currentTarget && setOpenId(null)}>
          {hasMore && (
            <button className="chat-more" onClick={loadOlder}>
              Показать ранние сообщения
            </button>
          )}
          {msgs.length === 0 && (
            <div className="chat-empty">
              <IconTile icon="chat" tone="rank" size="lg" />
              <b>Здесь пока тихо</b>
              <span className="muted">Поздоровайтесь и расскажите, зачем вы в челлендже. Видят только участники.</span>
            </div>
          )}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const first =
              newDay ||
              !prev ||
              prev.author.userId !== m.author.userId ||
              prev.author.organizer !== m.author.organizer ||
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 10 * 60_000;
            return (
              <div key={m.id}>
                {newDay && <div className="chat-day">{dayLabel(m.createdAt)}</div>}
                <Bubble
                  m={m}
                  first={first}
                  open={openId === m.id}
                  onToggle={() => setOpenId(openId === m.id ? null : m.id)}
                  onReply={() => {
                    setReplyTo(m);
                    setOpenId(null);
                    areaRef.current?.focus();
                  }}
                  onDelete={() => void remove(m)}
                  onPhoto={setPhoto}
                  onImageLoad={() => stick.current && scrollToBottom()}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="composer-wrap" ref={composerRef}>
        {banned ? (
          <div className="composer-note">Организатор ограничил вам отправку сообщений</div>
        ) : (
          <>
            {replyTo && (
              <div className="composer-reply">
                <Icon name="reply" size={18} weight="bold" />
                <span>
                  <b>{replyTo.author.name}</b>
                  <span>{replyTo.text || (replyTo.photoUrl ? "Фото" : "")}</span>
                </span>
                <button onClick={() => setReplyTo(null)} aria-label="Отменить ответ">
                  <Icon name="x" size={18} weight="bold" />
                </button>
              </div>
            )}
            <div className="composer">
              <button className="composer-btn" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="Фото">
                <Icon name="image" size={22} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendPhoto(f);
                }}
              />
              <textarea
                ref={areaRef}
                rows={1}
                maxLength={1000}
                placeholder="Сообщение"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button className="composer-send" onClick={() => void send()} disabled={sending || !text.trim()} aria-label="Отправить">
                <Icon name="send" size={20} weight="fill" />
              </button>
            </div>
          </>
        )}
      </div>

      {photo && (
        <div className="lightbox" onClick={() => setPhoto(null)}>
          <img src={photo} alt="" />
        </div>
      )}
    </div>
  );
}
