import { useEffect, useRef, useState } from "react";
import { api, type CatalogItem, type DayReport, type DayTask, type LeaderRow, type Me, type State, type User } from "./api";
import type { Screen } from "./App";
import { alertMsg, compressImage, countdown, GOALS, haptic, humanDate, openTgLink, plural } from "./util";
import { drawCertificate } from "./certificate";

interface Props {
  state: State;
  setState: (s: State) => void;
  go: (s: Screen) => void;
  me: Me;
}

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  // В Telegram работает системная кнопка «Назад», в браузере показываем свою
  const inTg = Boolean(window.Telegram?.WebApp.initData);
  return (
    <div className="header">
      {!inTg && onBack && (
        <button className="back" onClick={onBack}>
          ←
        </button>
      )}
      <h2>{title}</h2>
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}

// ---------------- Главный экран ----------------

export function Home({ state, setState, go }: Props) {
  const ch = state.challenge;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.phase !== "upcoming") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);
  const day = Math.min(Math.max(state.day, 0), ch.durationDays);
  const passed = state.phase === "running" ? state.day - (state.todayReport ? 0 : 1) : 0;

  return (
    <div className="page">
      <div className="hero">
        <h1>{ch.title.toUpperCase()}</h1>
        <p className="muted">{ch.tagline}</p>
      </div>

      {state.phase === "upcoming" ? (
        <div className="card">
          <div className="label">Старт: {humanDate(state.stream.startDate)}</div>
          <div className="big">До старта</div>
          <div className="timer">{countdown(new Date(state.stream.startsAt).getTime() - now)}</div>
          <p className="muted">Утром в день старта бот пришлёт первое задание.</p>
        </div>
      ) : (
        <div className="card">
          <div className="label">Текущий прогресс</div>
          <div className="big">
            ДЕНЬ {day} из {ch.durationDays}
          </div>
          <ProgressBar value={day} max={ch.durationDays} />
          <div className="stats">
            <div>
              <span>Серия</span>
              <b>🔥 {state.score.currentStreak} {plural(state.score.currentStreak, "день", "дня", "дней")}</b>
            </div>
            <div>
              <span>Выполнено</span>
              <b>
                {state.score.doneCount}/{Math.max(passed, state.score.doneCount)}
              </b>
            </div>
            <div>
              <span>Место</span>
              <b>
                #{state.rank ?? "—"} из {state.participants}
              </b>
            </div>
            <div>
              <span>Баллы</span>
              <b>⭐ {state.score.points}</b>
            </div>
          </div>
        </div>
      )}

      {state.canSaveStreak && <SaveStreak state={state} setState={setState} />}

      <div className="menu">
        {state.phase === "running" && (
          <button className="primary wide" onClick={() => go("today")}>
            {state.todayReport ? "✓ Сегодняшнее задание" : "Сегодняшнее задание"}
          </button>
        )}
        <button onClick={() => go("progress")}>📅 Мой прогресс</button>
        <button onClick={() => go("leaderboard")}>🏆 Рейтинг</button>
        <button onClick={() => go("rewards")}>🏅 Награды</button>
        <button onClick={() => go("rules")}>📜 Правила</button>
        {ch.chatLink && <button onClick={() => openTgLink(ch.chatLink!)}>💬 Чат участников</button>}
        <button onClick={() => go("profile")}>👤 Профиль</button>
      </div>
    </div>
  );
}

function SaveStreak({ state, setState }: { state: State; setState?: (s: State) => void }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const s = await api.post<State>(`/enrollments/${state.enrollmentId}/save-streak`);
      haptic("success");
      if (setState) setState(s);
      else location.reload();
    } catch (e) {
      alertMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card warn">
      <b>Серия 🔥 {state.streakBeforeBreak} прервалась</b>
      <p>
        Можно спасти её за {state.challenge.streakSaveCost} баллов. Осталось попыток: {state.streakSavesLeft}.
      </p>
      <button className="primary" disabled={busy} onClick={save}>
        Спасти серию
      </button>
    </div>
  );
}

// ---------------- Задание дня ----------------

function TaskCard({ task, day, total }: { task: DayTask; day: number; total: number }) {
  return (
    <div className="card">
      <div className="label">
        ДЕНЬ {day} из {total}
      </div>
      <h3>{task.title}</h3>
      {task.imageUrl && <img className="task-img" src={task.imageUrl} alt="" />}
      {task.description && <p className="muted">{task.description}</p>}
      {task.task && <p>{task.task}</p>}
      {task.hint && <p className="hint">{task.hint}</p>}
    </div>
  );
}

export function Today({ state, setState, go }: Props) {
  const task = state.todayTask;
  const report = state.todayReport;
  const [checked, setChecked] = useState<string[]>(report?.checklistDone ?? []);
  const [text, setText] = useState(report?.proofText ?? "");
  const [busy, setBusy] = useState(false);
  const [proofStep, setProofStep] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (state.phase !== "running" || !task) {
    return (
      <div className="page">
        <Header title="Задание" onBack={() => go("home")} />
        <div className="card muted">{state.phase === "upcoming" ? "Челлендж ещё не начался." : "Задание дня пока не заполнено."}</div>
      </div>
    );
  }

  const id = state.enrollmentId;
  const run = async (fn: () => Promise<State>, ok?: () => void) => {
    setBusy(true);
    try {
      setState(await fn());
      ok?.();
    } catch (e) {
      haptic("error");
      alertMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const markDone = () =>
    run(
      () => api.post<State>(`/enrollments/${id}/report`, { status: "DONE", checklistDone: checked }),
      () => {
        haptic("success");
        setProofStep(true);
      },
    );
  const markViolated = () => {
    const doIt = () => run(() => api.post<State>(`/enrollments/${id}/report`, { status: "VIOLATED", checklistDone: checked }));
    const tg = window.Telegram?.WebApp;
    const msg = `Отметить нарушение? Будет −${Math.abs(state.challenge.pointsViolation)} баллов и серия обнулится.`;
    if (tg?.initData) tg.showConfirm(msg, (ok) => ok && doIt());
    else if (confirm(msg)) void doIt();
  };
  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    const blob = await compressImage(f);
    await run(() => api.upload<State>(`/enrollments/${id}/report/photo`, blob, "proof.jpg"), () => haptic("success"));
  };
  const sendText = () => run(() => api.post<State>(`/enrollments/${id}/report`, { proofText: text }), () => haptic("success"));

  const allowPhoto = task.proofType === "photo" || task.proofType === "photo_or_text";
  const allowText = task.proofType === "text" || task.proofType === "photo_or_text";
  const hasProof = Boolean(report?.proofPhoto || report?.proofText);

  return (
    <div className="page">
      <Header title="Сегодня" onBack={() => go("home")} />
      <TaskCard task={task} day={state.day} total={state.challenge.durationDays} />

      {task.checklist.length > 0 && (
        <div className="card">
          <div className="label">Чек-лист</div>
          {task.checklist.map((item) => (
            <label key={item} className="check">
              <input
                type="checkbox"
                disabled={report?.status === "DONE"}
                checked={checked.includes(item)}
                onChange={(e) => setChecked(e.target.checked ? [...checked, item] : checked.filter((x) => x !== item))}
              />
              {item}
            </label>
          ))}
        </div>
      )}

      {!report && (
        <div className="actions">
          <button
            className="primary wide"
            disabled={busy || checked.length < task.checklist.length}
            onClick={markDone}
          >
            ✓ Я выполнил
          </button>
          <button className="ghost wide" disabled={busy} onClick={markViolated}>
            Я нарушил
          </button>
        </div>
      )}

      {report?.status === "VIOLATED" && (
        <div className="card bad">
          <b>🔴 Нарушение отмечено</b>
          <p>Серия обнулилась, но челлендж продолжается. Завтра можно начать новую серию.</p>
        </div>
      )}

      {report?.status === "DONE" && (
        <div className="card good">
          <b>{hasProof && !report.proofRejected ? "🟢 Выполнено с доказательством" : "🟡 Выполнено"}</b>
          {report.proofRejected && <p className="muted">Доказательство отклонено модератором. Можно загрузить новое.</p>}
          {(proofStep || !hasProof || report.proofRejected) && task.proofType !== "none" ? (
            <>
              <p>{hasProof ? "Можно обновить подтверждение." : `Отлично. Теперь добавь подтверждение (+${state.challenge.pointsProof} баллов).`}</p>
              {allowPhoto && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => void onPhoto(e.target.files?.[0])}
                  />
                  <button className="primary wide" disabled={busy} onClick={() => fileRef.current?.click()}>
                    {report.proofPhoto ? "ЗАМЕНИТЬ ФОТО" : "ЗАГРУЗИТЬ ФОТО"}
                  </button>
                </>
              )}
              {allowText && (
                <div className="text-proof">
                  <div className="label">{task.proofPrompt}</div>
                  <textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} rows={3} />
                  <button disabled={busy || !text.trim()} onClick={sendText}>
                    Отправить текст
                  </button>
                </div>
              )}
              {!hasProof && !task.proofRequired && (
                <button className="ghost wide" onClick={() => go("home")}>
                  Пропустить доказательство
                </button>
              )}
            </>
          ) : null}
          {report.proofPhoto && <img className="proof-img" src={report.proofPhoto} alt="" />}
          {report.proofText && !proofStep && <p className="quote">«{report.proofText}»</p>}
          {hasProof && (
            <button className="wide" onClick={() => go("home")}>
              На главную
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Прогресс ----------------

const STATE_LABEL: Record<string, string> = {
  done_proof: "🟢 выполнил + доказательство",
  done: "🟡 выполнил без доказательства",
  violated: "🔴 нарушил",
  missed: "⚪ пропуск",
  saved: "🛟 серия спасена",
};

export function Progress({ state, go }: Props) {
  const [open, setOpen] = useState<{ day: DayTask | null; report: DayReport | null; n: number } | null>(null);
  const s = state.score;
  const openDay = async (n: number) => {
    try {
      const r = await api.get<{ day: DayTask | null; report: DayReport | null }>(`/enrollments/${state.enrollmentId}/days/${n}`);
      setOpen({ ...r, n });
    } catch (e) {
      alertMsg((e as Error).message);
    }
  };
  return (
    <div className="page">
      <Header title="Мой прогресс" onBack={() => go("home")} />
      <div className="card">
        <div className="stats">
          <div>
            <span>Выполнено</span>
            <b>
              {s.doneCount}/{state.challenge.durationDays}
            </b>
          </div>
          <div>
            <span>Серия</span>
            <b>🔥 {s.currentStreak}</b>
          </div>
          <div>
            <span>Рекорд</span>
            <b>🔥 {s.bestStreak}</b>
          </div>
          <div>
            <span>Баллы</span>
            <b>⭐ {s.points}</b>
          </div>
        </div>
      </div>
      <div className="grid">
        {s.dayStates.map((st, i) => (
          <button key={i} className={`cell ${st}`} disabled={st === "future"} onClick={() => openDay(i + 1)}>
            {i + 1}
          </button>
        ))}
      </div>
      <div className="legend muted">
        {Object.values(STATE_LABEL).map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      {open && open.day && (
        <div className="sheet" onClick={() => setOpen(null)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <TaskCard task={open.day} day={open.n} total={state.challenge.durationDays} />
            {open.report ? (
              <div className="card">
                <b>{open.report.status === "DONE" ? (open.report.proofPhoto || open.report.proofText ? "🟢 Выполнено" : "🟡 Выполнено") : "🔴 Нарушение"}</b>
                {open.report.proofPhoto && <img className="proof-img" src={open.report.proofPhoto} alt="" />}
                {open.report.proofText && <p className="quote">«{open.report.proofText}»</p>}
              </div>
            ) : (
              <div className="card muted">{open.n === state.day ? "Сегодня, отчёта пока нет." : "Отчёта не было."}</div>
            )}
            <button className="wide" onClick={() => setOpen(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Рейтинг ----------------

export function Leaderboard({ state, go }: Props) {
  const [data, setData] = useState<{ top: LeaderRow[]; me: LeaderRow | null; total: number } | null>(null);
  useEffect(() => {
    api.get<typeof data>(`/enrollments/${state.enrollmentId}/leaderboard`).then(setData).catch((e) => alertMsg(e.message));
  }, [state.enrollmentId]);
  return (
    <div className="page with-pin">
      <Header title="🏆 Рейтинг" onBack={() => go("home")} />
      {!data ? (
        <div className="muted center">Загрузка…</div>
      ) : (
        <>
          <table className="board">
            <thead>
              <tr>
                <th>Место</th>
                <th>Участник</th>
                <th>Серия</th>
                <th>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((r) => (
                <tr key={r.enrollmentId} className={r.isMe ? "me" : ""}>
                  <td>{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
                  <td>{r.name}</td>
                  <td>🔥 {r.currentStreak}</td>
                  <td>{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.me && (
            <div className="pin">
              <span>
                ТЫ — <b>#{data.me.rank}</b> из {data.total}
              </span>
              <span>
                🔥 {data.me.currentStreak} · ⭐ {data.me.points}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- Награды ----------------

export function Rewards({ state, go }: Props) {
  return (
    <div className="page">
      <Header title="Мои награды" onBack={() => go("home")} />
      {state.rewards.map((r) => (
        <div key={r.code} className={`card reward ${r.earned ? "" : "locked"}`}>
          <div className="reward-icon">{r.icon}</div>
          <div>
            <b>{r.title}</b>
            <div className="muted">{r.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Правила ----------------

export function Rules({ state, go }: Props) {
  return (
    <div className="page">
      <Header title="Правила" onBack={() => go("home")} />
      <div className="card pre">{state.challenge.rules || "Правила скоро появятся."}</div>
    </div>
  );
}

// ---------------- Профиль и регистрация ----------------

function ProfileForm({ user, submitText, onSaved }: { user: User; submitText: string; onSaved: (u: User) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName ?? user.firstName ?? "");
  const [age, setAge] = useState(user.age ? String(user.age) : "");
  const [country, setCountry] = useState(user.country ?? "");
  const [goal, setGoal] = useState(user.goal ?? "");
  const [goalOther, setGoalOther] = useState(user.goalOther ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ user: User }>("/profile", {
        displayName,
        age: age || null,
        country,
        goal: goal || null,
        goalOther,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      haptic("success");
      onSaved(r.user);
    } catch (e) {
      alertMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form">
      <label>
        Имя или ник для рейтинга
        <input value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        Возраст (необязательно)
        <input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} />
      </label>
      <label>
        Страна (необязательно)
        <input value={country} onChange={(e) => setCountry(e.target.value)} />
      </label>
      <div className="label">Моя цель:</div>
      {GOALS.map(([code, title]) => (
        <label key={code} className="check">
          <input type="radio" name="goal" checked={goal === code} onChange={() => setGoal(code)} />
          {title}
        </label>
      ))}
      {goal === "other" && <input placeholder="Твоя цель" value={goalOther} onChange={(e) => setGoalOther(e.target.value)} />}
      <button className="primary wide" disabled={busy || !displayName.trim()} onClick={submit}>
        {submitText}
      </button>
    </div>
  );
}

export function Onboarding({ user, onDone }: { user: User; onDone: (u: User) => void }) {
  return (
    <div className="page">
      <div className="hero">
        <h1>Привет{user.firstName ? `, ${user.firstName}` : ""}!</h1>
        <p className="muted">Пара вопросов перед стартом.</p>
      </div>
      <div className="card">
        <ProfileForm user={user} submitText="Готово" onSaved={onDone} />
      </div>
    </div>
  );
}

export function Profile({ me, go, onSaved }: Props & { onSaved: (u: User) => void }) {
  return (
    <div className="page">
      <Header title="Профиль" onBack={() => go("home")} />
      <div className="card">
        <ProfileForm
          user={me.user}
          submitText="Сохранить"
          onSaved={(u) => {
            onSaved(u);
            go("home");
          }}
        />
      </div>
      <p className="muted small">Часовой пояс: {me.user.timezone}. Напоминания приходят по нему.</p>
    </div>
  );
}

// ---------------- Каталог (нет участия) ----------------

export function Catalog() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [bot, setBot] = useState("");
  useEffect(() => {
    api
      .get<{ challenges: CatalogItem[]; botUsername: string }>("/challenges")
      .then((r) => {
        setItems(r.challenges);
        setBot(r.botUsername);
      })
      .catch((e) => alertMsg(e.message));
  }, []);
  return (
    <div className="page">
      <div className="hero">
        <h1>Челленджи</h1>
        <p className="muted">30 дней. Каждый день — одно простое действие.</p>
      </div>
      {items?.length === 0 && <div className="card muted">Скоро здесь появятся челленджи.</div>}
      {items?.map((c) => (
        <div key={c.id} className="card">
          {c.coverUrl && <img className="task-img" src={c.coverUrl} alt="" />}
          <h3>{c.title}</h3>
          <p className="muted">{c.tagline}</p>
          {c.nextStart && <p>Старт: {humanDate(c.nextStart)}</p>}
          <button
            className="primary wide"
            onClick={() => {
              if (c.tributeLink) openTgLink(c.tributeLink);
              else if (bot) openTgLink(`https://t.me/${bot}?start=c_${c.slug}`);
            }}
          >
            УЧАСТВОВАТЬ · {c.priceRub} ₽{c.paymentMode === "SUBSCRIPTION" ? "/мес" : ""}
          </button>
        </div>
      ))}
      <p className="muted small">После оплаты вернись сюда: доступ откроется автоматически.</p>
    </div>
  );
}

// ---------------- Финал и сертификат ----------------

export function Final({ state, go, me }: Props) {
  const ch = state.challenge;
  const s = state.score;
  const [cert, setCert] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const link = me.botUsername ? `https://t.me/${me.botUsername}?start=c_${ch.slug}` : location.origin;
  const fullyDone = s.doneCount >= ch.durationDays;

  const getCertificate = async () => {
    setBusy(true);
    try {
      const blob = await drawCertificate({
        name: me.user.displayName || me.user.firstName || "Участник",
        title: ch.title,
        done: s.doneCount,
        duration: ch.durationDays,
        year: Number(state.today.slice(0, 4)),
        link,
      });
      setCert({ url: URL.createObjectURL(blob), blob });
      const r = await api.upload<{ sent: boolean }>(`/enrollments/${state.enrollmentId}/certificate`, blob, "certificate.png");
      if (r.sent) alertMsg("Сертификат отправлен тебе в чат с ботом. Его можно переслать друзьям.");
    } catch (e) {
      alertMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const share = () => {
    const text = `Я прошёл челлендж «${ch.title}»: ${s.doneCount}/${ch.durationDays} дней, ${s.points} баллов${state.rank ? `, место #${state.rank}` : ""}. Присоединяйся!`;
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  };

  return (
    <div className="page">
      <div className="hero">
        <h1>ЧЕЛЛЕНДЖ ЗАВЕРШЁН</h1>
        <p className="muted">«{ch.title}»</p>
      </div>
      <div className="card final">
        <div className="big">
          {s.doneCount} / {ch.durationDays} дней
        </div>
        <div>🔥 Лучшая серия: {s.bestStreak} {plural(s.bestStreak, "день", "дня", "дней")}</div>
        <div>🏆 Итоговое место: #{state.rank ?? "—"}</div>
        <div>⭐ Количество баллов: {s.points}</div>
      </div>
      <div className="card">
        <div className="label">Твой результат</div>
        <p>
          {fullyDone
            ? `Ты прошёл ${ch.durationDays} дней челленджа «${ch.title}».`
            : `Ты выполнил ${s.doneCount} ${plural(s.doneCount, "день", "дня", "дней")} из ${ch.durationDays}. Следующий поток — шанс пройти все ${ch.durationDays}.`}
        </p>
      </div>
      {cert && <img className="cert" src={cert.url} alt="Сертификат" />}
      <div className="actions">
        <button className="primary wide" disabled={busy} onClick={getCertificate}>
          {cert ? "ОТПРАВИТЬ СЕРТИФИКАТ ЕЩЁ РАЗ" : "ПОЛУЧИТЬ СЕРТИФИКАТ"}
        </button>
        <button className="wide" onClick={share}>
          ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ
        </button>
      </div>
      <div className="menu">
        <button onClick={() => go("progress")}>📅 Мой прогресс</button>
        <button onClick={() => go("leaderboard")}>🏆 Рейтинг</button>
        <button onClick={() => go("rewards")}>🏅 Награды</button>
      </div>
    </div>
  );
}
