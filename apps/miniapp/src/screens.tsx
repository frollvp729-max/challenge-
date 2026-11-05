import { useEffect, useRef, useState } from "react";
import { api, inTelegram, logout, type CardSettings, type CatalogItem, type DayReport, type DayState, type DayTask, type LeaderboardData, type LeaderRow, type Me, type State, type User } from "./api";
import type { Screen } from "./App";
import { Avatar, Icon, IconTile, REWARD_ICONS, type IconName, type Tone } from "./icons";
import { alertMsg, compressImage, countdownParts, GOALS, haptic, humanDate, inChallenges, openTgLink, plural, tomorrowIso } from "./util";
import { ChallengeSwitch, Ring } from "./switcher";
import { drawCertificate } from "./certificate";
import { ChatCard } from "./chat";

interface Props {
  state: State;
  setState: (s: State) => void;
  go: (s: Screen) => void;
  me: Me;
  /** Открыть другой свой челлендж */
  open?: (enrollmentId: number) => void;
}

const days = (n: number) => plural(n, "день", "дня", "дней");
const nameOf = (u: User) => u.displayName || u.firstName || (u.username ? `@${u.username}` : "Участник");

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  // В Telegram работает системная кнопка «Назад», в браузере показываем свою
  const inTg = inTelegram();
  return (
    <header className="header">
      {!inTg && onBack && (
        <button className="icon-btn" onClick={onBack} aria-label="Назад">
          <Icon name="back" size={20} weight="bold" />
        </button>
      )}
      <div>
        <h1 className="title">{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
    </header>
  );
}

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** Неделя вокруг сегодняшнего дня: прошлые отметки, сегодня и следующие дни */
function WeekStrip({ state }: { state: State }) {
  const total = state.challenge.durationDays;
  const count = Math.min(7, total);
  const first = Math.min(Math.max(state.day - 3, 1), Math.max(total - count + 1, 1));
  const [y, m, d] = state.stream.startDate.slice(0, 10).split("-").map(Number);
  return (
    <div className="week">
      {Array.from({ length: count }, (_, i) => first + i).map((n) => {
        const st = state.score.dayStates[n - 1];
        const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d + n - 1)).getUTCDay()];
        const mark =
          st === "done_proof" || st === "done" || st === "saved" ? (
            <Icon name="check" size={14} weight="bold" />
          ) : st === "violated" ? (
            <Icon name="x" size={14} weight="bold" />
          ) : (
            n
          );
        return (
          <div key={n} className={`wday ${st}${n === state.day ? " is-today" : ""}`}>
            <span className="wd">{wd}</span>
            <span className="wdot">{mark}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Обратный отсчёт до старта: дни, часы, минуты, секунды в отдельных плашках */
function Countdown({ ms }: { ms: number }) {
  const [d, h, m, s] = countdownParts(ms);
  const units: Array<[number, string]> = [
    [d, plural(d, "день", "дня", "дней")],
    [h, plural(h, "час", "часа", "часов")],
    [m, plural(m, "минута", "минуты", "минут")],
    [s, plural(s, "секунда", "секунды", "секунд")],
  ];
  return (
    <div className="countdown">
      {units.map(([n, label], i) => (
        <div key={i} className="cd-unit">
          <b>{i ? String(n).padStart(2, "0") : n}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({
  icon,
  tone,
  value,
  unit,
  label,
  className = "",
  onClick,
}: {
  icon: IconName;
  tone: Tone;
  value: string | number;
  unit?: string;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div className={`tile ${className}${onClick ? " tap" : ""}`} onClick={onClick}>
      <IconTile icon={icon} tone={tone} />
      <div className="tile-body">
        <div className="tile-value">
          {value}
          {unit && <small> {unit}</small>}
        </div>
        <div className="tile-label">{label}</div>
      </div>
    </div>
  );
}

function ListRow({ icon, tone = "neutral", label, onClick }: { icon: IconName; tone?: Tone; label: string; onClick: () => void }) {
  return (
    <button className="row" onClick={onClick}>
      <IconTile icon={icon} tone={tone} size="sm" />
      <span className="row-label">{label}</span>
      <Icon name="chevron" size={16} weight="bold" />
    </button>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 17) return "Добрый день";
  if (h >= 17 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

// ---------------- Главный экран ----------------

export function Home({ state, setState, go, me, open }: Props) {
  const ch = state.challenge;
  const s = state.score;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.phase !== "upcoming") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);
  const day = Math.min(Math.max(state.day, 0), ch.durationDays);
  const passed = state.phase === "running" ? state.day - (state.todayReport ? 0 : 1) : 0;
  const left = ch.durationDays - day;
  const name = nameOf(me.user);

  return (
    <div className="page tabs">
      <div className="topbar">
        <Avatar name={name} photo={me.user.photoUrl} size={44} />
        <div className="topbar-text">
          <div className="eyebrow">{greeting()}</div>
          <div className="topbar-name">{name}</div>
        </div>
        <button className="pill" onClick={() => go("progress")}>
          <Icon name="star" size={16} weight="fill" /> {s.points}
        </button>
      </div>
      <ChallengeSwitch me={me} current={state.enrollmentId} open={open} go={go} />

      {state.phase === "upcoming" ? (
        <>
          <section className="hero">
            <div className="eyebrow">Твой день 1: {humanDate(state.stream.startDate)}</div>
            <div className="hero-title">{ch.title}</div>
            <Countdown ms={new Date(state.stream.startsAt).getTime() - now} />
            <p className="hero-note">Утром в день старта бот пришлёт первое задание.</p>
          </section>
          <section className="card">
            <h3 className="card-title">Как это будет</h3>
            <div className="steps">
              <Step icon="sun" tone="star" title="Каждое утро новое задание" text="Одно простое действие на день." />
              <Step
                icon="camera"
                tone="rank"
                title="Отмечай и подтверждай"
                text={`Нажми «Я выполнил» и приложи фото: +${ch.pointsProof} баллов.`}
              />
              <Step icon="medal" tone="fire" title="Серии, рейтинг, награды" text="А в финале сертификат участника." />
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="hero">
            <div className="hero-row">
              <div className="hero-main">
                <div className="eyebrow">{ch.title}</div>
                <div className="hero-day">
                  День {day} <small>из {ch.durationDays}</small>
                </div>
                <div className="hero-note">{left > 0 ? `Осталось ${left} ${days(left)}` : "Финишная прямая"}</div>
              </div>
              <Ring value={day} max={ch.durationDays} />
            </div>
            <WeekStrip state={state} />
          </section>

          {state.canSaveStreak && <SaveStreak state={state} setState={setState} />}
          <TodayCard state={state} go={go} />

          <div className="bento">
            <Tile
              className="tall"
              icon="fire"
              tone="fire"
              value={s.currentStreak}
              unit={days(s.currentStreak)}
              label={`серия · рекорд ${s.bestStreak}`}
              onClick={() => go("progress")}
            />
            <Tile
              icon="trophy"
              tone="rank"
              value={`#${state.rank ?? "—"}`}
              label={`место из ${state.participants}`}
              onClick={() => go("leaderboard")}
            />
            <Tile
              icon="done"
              tone="good"
              value={`${s.doneCount}/${Math.max(passed, s.doneCount)}`}
              label="выполнено"
              onClick={() => go("progress")}
            />
          </div>
        </>
      )}

      <ChatCard state={state} go={go} />

      <div className="list">
        <ListRow icon="rules" label="Правила челленджа" onClick={() => go("rules")} />
        <ListRow icon="medal" tone="star" label="Награды" onClick={() => go("rewards")} />
        {ch.chatLink && <ListRow icon="users" tone="rank" label="Группа в Telegram" onClick={() => openTgLink(ch.chatLink!)} />}
        <ListRow icon="catalog" tone="task" label="Другие челленджи" onClick={() => go("catalog")} />
      </div>
    </div>
  );
}

function Step({ icon, tone, title, text }: { icon: IconName; tone: Tone; title: string; text: string }) {
  return (
    <div className="step">
      <IconTile icon={icon} tone={tone} />
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}

function TodayCard({ state, go }: { state: State; go: (s: Screen) => void }) {
  const task = state.todayTask;
  const report = state.todayReport;
  if (state.phase !== "running" || !task) return null;
  const done = report?.status === "DONE";
  const bad = report?.status === "VIOLATED";
  return (
    <section className="card task-card">
      <div className="card-head">
        <IconTile icon="leaf" tone="task" size="sm" />
        <span className="eyebrow">Задание дня</span>
        <span className={`chip${done ? " chip-good" : bad ? " chip-bad" : ""}`}>
          {done ? "Выполнено" : bad ? "Нарушение" : `+${state.challenge.pointsDone} баллов`}
        </span>
      </div>
      <h2 className="task-title">{task.title}</h2>
      {task.task && <p className="task-text clamp">{task.task}</p>}
      <button className={`btn wide ${done || bad ? "btn-soft" : "btn-primary"}`} onClick={() => go("today")}>
        {done || bad ? "Открыть задание" : "Выполнить задание"}
        <Icon name="arrow" size={18} weight="bold" />
      </button>
    </section>
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
    <section className="card notice tone-star">
      <div className="card-head">
        <IconTile icon="lifebuoy" tone="star" size="sm" />
        <b>
          Серия {state.streakBeforeBreak} {days(state.streakBeforeBreak)} прервалась
        </b>
      </div>
      <p>
        Можно спасти её за {state.challenge.streakSaveCost} баллов. Осталось попыток: {state.streakSavesLeft}.
      </p>
      <button className="btn btn-primary wide" disabled={busy} onClick={save}>
        Спасти серию
      </button>
    </section>
  );
}

// ---------------- Задание дня ----------------

function TaskCard({ task, day, total }: { task: DayTask; day: number; total: number }) {
  return (
    <section className="card">
      <div className="card-head">
        <span className="chip">
          День {day} из {total}
        </span>
      </div>
      <h2 className="task-title big">{task.title}</h2>
      {task.description && <p className="muted task-desc">{task.description}</p>}
      {task.imageUrl && <img className="task-img" src={task.imageUrl} alt="" />}
      {task.task && (
        <div className="task-box">
          <span className="eyebrow">Задание</span>
          <p className="task-text">{task.task}</p>
        </div>
      )}
      {task.hint && (
        <div className="hint">
          <IconTile icon="bulb" tone="star" size="sm" />
          <div>
            <b>Совет</b>
            <p>{task.hint}</p>
          </div>
        </div>
      )}
    </section>
  );
}

export function Today({ state, setState, go, me, open }: Props) {
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
        <ChallengeSwitch me={me} current={state.enrollmentId} open={open} go={go} />
        <Header title="Задание" onBack={() => go("home")} />
        <div className="card muted">{state.phase === "upcoming" ? "Челлендж ещё не начался." : "Задание дня пока не заполнено."}</div>
      </div>
    );
  }

  const id = state.enrollmentId;
  const ch = state.challenge;
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
    const msg = `Отметить нарушение? Будет −${Math.abs(ch.pointsViolation)} баллов и серия обнулится.`;
    if (tg?.initData) tg.showConfirm(msg, (ok) => ok && doIt());
    else if (confirm(msg)) void doIt();
  };
  // после отправки доказательства сразу показываем итог: фото или текст и кнопку «На главную»
  const proofSaved = () => {
    haptic("success");
    setProofStep(false);
  };
  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    const blob = await compressImage(f);
    await run(() => api.upload<State>(`/enrollments/${id}/report/photo`, blob, "proof.jpg"), proofSaved);
  };
  const sendText = () => run(() => api.post<State>(`/enrollments/${id}/report`, { proofText: text }), proofSaved);

  const allowPhoto = task.proofType === "photo" || task.proofType === "photo_or_text";
  const allowText = task.proofType === "text" || task.proofType === "photo_or_text";
  const hasProof = Boolean(report?.proofPhoto || report?.proofText);

  return (
    <div className="page">
      <ChallengeSwitch me={me} current={state.enrollmentId} open={open} go={go} />
      <Header title="Задание дня" onBack={() => go("home")} />
      <TaskCard task={task} day={state.day} total={ch.durationDays} />

      {task.checklist.length > 0 && (
        <section className="card">
          <h3 className="card-title">Чек-лист</h3>
          {task.checklist.map((item) => (
            <label key={item} className="check">
              <input
                type="checkbox"
                disabled={report?.status === "DONE"}
                checked={checked.includes(item)}
                onChange={(e) => setChecked(e.target.checked ? [...checked, item] : checked.filter((x) => x !== item))}
              />
              <span className="box">
                <Icon name="check" size={14} weight="bold" />
              </span>
              {item}
            </label>
          ))}
        </section>
      )}

      {!report && (
        <>
          <div className="rewards-row">
            <span>
              <Icon name="done" size={18} /> +{ch.pointsDone} за выполнение
            </span>
            {task.proofType !== "none" && (
              <span>
                <Icon name="camera" size={18} /> +{ch.pointsProof} за доказательство
              </span>
            )}
          </div>
          <div className="actions">
            <button className="btn btn-primary wide" disabled={busy || checked.length < task.checklist.length} onClick={markDone}>
              <Icon name="check" size={20} weight="bold" /> Я выполнил
            </button>
            <button className="btn btn-ghost wide" disabled={busy} onClick={markViolated}>
              Я нарушил
            </button>
          </div>
        </>
      )}

      {report?.status === "VIOLATED" && (
        <section className="card notice tone-bad">
          <div className="card-head">
            <IconTile icon="x" tone="bad" size="sm" weight="bold" />
            <b>Нарушение отмечено</b>
          </div>
          <p>Серия обнулилась, но челлендж продолжается. Завтра можно начать новую серию.</p>
        </section>
      )}

      {report?.status === "DONE" && (
        <section className="card notice tone-good">
          <div className="card-head">
            <IconTile icon="seal" tone="good" size="sm" />
            <b>{hasProof && !report.proofRejected ? "Выполнено с доказательством" : "Выполнено"}</b>
          </div>
          {report.proofRejected && <p className="muted">Доказательство отклонено модератором. Можно загрузить новое.</p>}
          {(proofStep || !hasProof || report.proofRejected) && task.proofType !== "none" ? (
            <>
              <p>{hasProof ? "Можно обновить подтверждение." : `Отлично! Теперь добавь подтверждение: +${ch.pointsProof} баллов.`}</p>
              {allowPhoto && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
                  <button className="btn btn-primary wide" disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Icon name="camera" size={20} /> {report.proofPhoto ? "Заменить фото" : "Загрузить фото"}
                  </button>
                </>
              )}
              {allowText && (
                <div className="text-proof">
                  <div className="eyebrow">{task.proofPrompt}</div>
                  <textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} rows={3} />
                  <button className="btn btn-soft wide" disabled={busy || !text.trim()} onClick={sendText}>
                    <Icon name="note" size={18} /> Отправить текст
                  </button>
                </div>
              )}
              {!hasProof && !task.proofRequired && (
                <button className="btn btn-ghost wide" onClick={() => go("home")}>
                  Пропустить доказательство
                </button>
              )}
            </>
          ) : null}
          {report.proofPhoto && <img className="proof-img" src={report.proofPhoto} alt="" />}
          {report.proofText && !proofStep && <p className="quote">«{report.proofText}»</p>}
          {hasProof && (
            <button className="btn btn-soft wide" onClick={() => go("home")}>
              На главную
            </button>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------- Прогресс ----------------

const LEGEND: Array<[DayState, string]> = [
  ["done_proof", "с доказательством"],
  ["done", "без доказательства"],
  ["violated", "нарушение"],
  ["missed", "пропуск"],
  ["saved", "серия спасена"],
];

export function Progress({ state, me, open: openChallenge, go }: Props) {
  const [open, setOpen] = useState<{ day: DayTask | null; report: DayReport | null; n: number } | null>(null);
  const s = state.score;
  const ch = state.challenge;
  const openDay = async (n: number) => {
    try {
      const r = await api.get<{ day: DayTask | null; report: DayReport | null }>(`/enrollments/${state.enrollmentId}/days/${n}`);
      setOpen({ ...r, n });
    } catch (e) {
      alertMsg((e as Error).message);
    }
  };
  return (
    <div className="page tabs">
      <ChallengeSwitch me={me} current={state.enrollmentId} open={openChallenge} go={go} />
      <Header title="Мой прогресс" subtitle={ch.title} />
      <div className="stats">
        <Tile icon="done" tone="good" value={`${s.doneCount}/${ch.durationDays}`} label="выполнено" />
        <Tile icon="fire" tone="fire" value={s.currentStreak} label="серия" />
        <Tile icon="crown" tone="rank" value={s.bestStreak} label="рекорд серии" />
        <Tile icon="star" tone="star" value={s.points} label="баллов" />
      </div>
      <section className="card">
        <div className="card-head">
          <h3 className="card-title">Календарь</h3>
          {state.phase !== "upcoming" && <span className="muted small">нажми на день</span>}
        </div>
        <div className="cal">
          {s.dayStates.map((st, i) => (
            <button key={i} className={`cell ${st}${i + 1 === state.day ? " is-today" : ""}`} disabled={st === "future"} onClick={() => openDay(i + 1)}>
              {i + 1}
            </button>
          ))}
        </div>
        <div className="legend">
          {LEGEND.map(([st, label]) => (
            <span key={st}>
              <i className={`swatch ${st}`} />
              {label}
            </span>
          ))}
        </div>
      </section>
      {open && open.day && (
        <div className="sheet" onClick={() => setOpen(null)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <TaskCard task={open.day} day={open.n} total={ch.durationDays} />
            {open.report ? (
              <section className="card">
                <b>
                  {open.report.status === "DONE"
                    ? open.report.proofPhoto || open.report.proofText
                      ? "Выполнено с доказательством"
                      : "Выполнено"
                    : "Нарушение"}
                </b>
                {open.report.proofPhoto && <img className="proof-img" src={open.report.proofPhoto} alt="" />}
                {open.report.proofText && <p className="quote">«{open.report.proofText}»</p>}
              </section>
            ) : (
              <div className="card muted">{open.n === state.day ? "Сегодня, отчёта пока нет." : "Отчёта не было."}</div>
            )}
            <button className="btn btn-soft wide" onClick={() => setOpen(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Рейтинг ----------------

function Podium({ rows }: { rows: LeaderRow[] }) {
  const order = [rows[1], rows[0], rows[2]].filter(Boolean);
  return (
    <div className="podium">
      {order.map((r) => (
        <div key={r.enrollmentId} className={`podium-col p${r.rank}${r.isMe ? " me" : ""}`}>
          {r.rank === 1 && (
            <span className="podium-crown">
              <Icon name="crown" size={22} weight="fill" />
            </span>
          )}
          <Avatar name={r.name} photo={r.photoUrl} size={r.rank === 1 ? 64 : 52} />
          <div className="podium-name">{r.name}</div>
          {inChallenges(r.challenges) && <div className="podium-sub">{inChallenges(r.challenges)}</div>}
          <div className="podium-points">{r.points}</div>
          <div className="podium-stand">{r.rank}</div>
        </div>
      ))}
    </div>
  );
}

export function Leaderboard({ state, me, open, go }: Props) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [mode, setMode] = useState<"all" | "day">("all");
  useEffect(() => {
    api.get<LeaderboardData>(`/enrollments/${state.enrollmentId}/leaderboard`).then(setData).catch((e) => alertMsg(e.message));
  }, [state.enrollmentId]);
  const dayN = data?.sameDay.day ?? 0;
  const view = data && (mode === "day" && dayN >= 1 ? data.sameDay : data);
  const total = view?.total ?? 0;
  return (
    <div className="page tabs with-pin">
      <ChallengeSwitch me={me} current={state.enrollmentId} open={open} go={go} />
      <Header
        title="Рейтинг"
        subtitle={
          view
            ? mode === "day"
              ? `Очки за дни 1–${dayN}: ${total} ${plural(total, "участник", "участника", "участников")}`
              : `${total} ${plural(total, "участник", "участника", "участников")} за всё время`
            : undefined
        }
      />
      {data && dayN >= 1 && (
        <div className="seg">
          <button className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>
            Общий
          </button>
          <button className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>
            На твоём {dayN}-м дне
          </button>
        </div>
      )}
      {!view ? (
        <div className="muted center">Загрузка…</div>
      ) : (
        <>
          {mode === "day" && (
            <p className="muted center-text seg-note">
              У каждого свои 30 дней. Здесь все сравниваются на одном и том же дне: сколько очков было у каждого к концу его {dayN}-го дня.
            </p>
          )}
          <Podium rows={view.top.slice(0, 3)} />
          {view.top.length > 3 && (
            <section className="card board">
              {view.top.slice(3).map((r) => (
                <div key={r.enrollmentId} className={`board-row${r.isMe ? " me" : ""}`}>
                  <span className="board-rank">{r.rank}</span>
                  <Avatar name={r.name} photo={r.photoUrl} size={36} />
                  <span className="board-name">
                    {r.name}
                    {(mode === "all" || inChallenges(r.challenges)) && (
                      <span className="board-day">
                        {[mode === "all" ? (r.finished ? "прошёл 30 дней" : `день ${r.day}`) : "", inChallenges(r.challenges)].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="board-streak">
                    <Icon name="fire" size={15} weight="fill" /> {r.currentStreak}
                  </span>
                  <span className="board-points">{r.points}</span>
                </div>
              ))}
            </section>
          )}
          {view.me && (
            <div className="pin">
              <span>
                Ты на <b>{view.me.rank}</b> месте из {view.total}
              </span>
              <span className="pin-stats">
                <Icon name="fire" size={16} weight="fill" /> {view.me.currentStreak}
                <Icon name="star" size={16} weight="fill" /> {view.me.points}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- Награды ----------------

export function Rewards({ state, me, open, go }: Props) {
  const earned = state.rewards.filter((r) => r.earned).length;
  return (
    <div className="page tabs">
      <ChallengeSwitch me={me} current={state.enrollmentId} open={open} go={go} />
      <Header title="Награды" subtitle={`Получено ${earned} из ${state.rewards.length}`} />
      <div className="badges">
        {state.rewards.map((r) => {
          const look = REWARD_ICONS[r.code];
          return (
            <div key={r.code} className={`badge ${r.earned ? "earned" : "locked"} tone-${look?.tone ?? "star"}`}>
              <div className="badge-icon">
                {look ? <Icon name={look.icon} size={30} /> : <span className="emoji">{r.icon}</span>}
                {!r.earned && (
                  <span className="badge-lock">
                    <Icon name="lock" size={12} weight="bold" />
                  </span>
                )}
              </div>
              <b>{r.title}</b>
              <span>{r.description}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Правила ----------------

/**
 * Текст из админки: короткая строка без точки в начале абзаца становится заголовком,
 * строки с «•» или «-» становятся пунктами списка
 */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim());
  return (
    <div className="rich">
      {lines.map((line, i) => {
        if (!line) return null;
        const bullet = /^[•\-–—]\s+/.exec(line);
        if (bullet) {
          return (
            <p key={i} className="bullet">
              {line.slice(bullet[0].length)}
            </p>
          );
        }
        const startsBlock = i === 0 || !lines[i - 1];
        const hasMore = lines.slice(i + 1).some(Boolean);
        if (startsBlock && hasMore && line.length <= 60 && !/[.!?…:;,)]$/.test(line)) return <h3 key={i}>{line}</h3>;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export function Rules({ state, me, open, go }: Props) {
  return (
    <div className="page">
      <ChallengeSwitch me={me} current={state.enrollmentId} open={open} go={go} />
      <Header title="Правила" subtitle={state.challenge.title} onBack={() => go("home")} />
      <section className="card">
        {state.challenge.rules ? <RichText text={state.challenge.rules} /> : <p className="muted">Правила скоро появятся.</p>}
      </section>
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
      <div className="form-row">
        <label>
          Возраст
          <input inputMode="numeric" placeholder="необязательно" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label>
          Страна
          <input placeholder="необязательно" value={country} onChange={(e) => setCountry(e.target.value)} />
        </label>
      </div>
      <div className="eyebrow">Моя цель</div>
      <div className="choices">
        {GOALS.map(([code, title]) => (
          <label key={code} className={`choice${goal === code ? " on" : ""}`}>
            <input type="radio" name="goal" checked={goal === code} onChange={() => setGoal(code)} />
            {title}
          </label>
        ))}
      </div>
      {goal === "other" && <input placeholder="Твоя цель" value={goalOther} onChange={(e) => setGoalOther(e.target.value)} />}
      <button className="btn btn-primary wide" disabled={busy || !displayName.trim()} onClick={submit}>
        {submitText}
      </button>
    </div>
  );
}

export function Onboarding({ user, onDone }: { user: User; onDone: (u: User) => void }) {
  return (
    <div className="page">
      <div className="intro">
        <IconTile icon="sparkle" tone="task" size="lg" />
        <h1 className="title">Привет{user.firstName ? `, ${user.firstName}` : ""}!</h1>
        <p className="subtitle">Пара вопросов перед стартом.</p>
      </div>
      <section className="card">
        <ProfileForm user={user} submitText="Готово" onSaved={onDone} />
      </section>
    </div>
  );
}

/** Где можно заниматься: сайт (почта и пароль) и Telegram. Аккаунт один, прогресс и оплата общие. */
function AccountCard({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(!user.email);
  const [busy, setBusy] = useState(false);
  const [waitingTg, setWaitingTg] = useState(false);

  // после подтверждения в боте у аккаунта появится Telegram
  useEffect(() => {
    if (!waitingTg) return;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const m = await api.get<Me>("/me");
        if (m.user.telegramId) {
          setWaitingTg(false);
          haptic("success");
          // аккаунты могли объединиться: перезагружаем, чтобы подтянуть челленджи из Telegram
          location.reload();
        }
      } catch {
        /* проверим ещё раз */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [waitingTg]);

  const linkTelegram = async () => {
    // окно открываем сразу по нажатию, иначе браузер его заблокирует
    const w = window.open("", "_blank");
    try {
      const r = await api.post<{ url: string }>("/account/telegram-link");
      if (w) w.location.href = r.url;
      else location.href = r.url;
      setWaitingTg(true);
    } catch (e) {
      w?.close();
      alertMsg((e as Error).message);
    }
  };

  const saveCredentials = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ user: User }>("/account/credentials", { email, password });
      haptic("success");
      setPassword("");
      setEditing(false);
      onSaved(r.user);
    } catch (e) {
      alertMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card account-card">
      <h2 className="card-title">Где заниматься</h2>
      <p className="muted small">Аккаунт один: задания, баллы, чат и оплата общие на сайте и в Telegram.</p>
      <div className="account-row">
        <IconTile icon="telegram" tone="rank" size="sm" />
        <div className="account-text">
          <b>Telegram</b>
          <span>{user.telegramId ? `подключён${user.username ? ` · @${user.username}` : ""}` : "не подключён: нет напоминаний от бота"}</span>
        </div>
        {user.telegramId ? (
          <span className="chip chip-good">
            <Icon name="check" size={14} weight="bold" />
          </span>
        ) : (
          <button className="btn btn-soft btn-sm" onClick={() => void linkTelegram()}>
            Подключить
          </button>
        )}
      </div>
      {waitingTg && (
        <div className="login-wait">
          <span className="dot-pulse" aria-hidden="true" />
          Нажмите «Подключить» в боте. Страница обновится сама.
        </div>
      )}
      <div className="account-row">
        <IconTile icon="mail" tone="task" size="sm" />
        <div className="account-text">
          <b>Сайт</b>
          <span>{user.email ? user.email : "вход по почте и паролю не задан"}</span>
        </div>
        {user.email && !editing && (
          <button className="btn btn-soft btn-sm" onClick={() => setEditing(true)}>
            Изменить
          </button>
        )}
      </div>
      {editing && (
        <div className="form account-form">
          <label>
            Почта
            <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            {user.email ? "Новый пароль" : "Пароль"}
            <input type="password" value={password} autoComplete="new-password" placeholder="не короче 6 символов" onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn btn-primary wide" disabled={busy || !email || password.length < 6} onClick={() => void saveCredentials()}>
            Сохранить вход на сайт
          </button>
          <p className="muted small">Сайт: {location.host}</p>
        </div>
      )}
    </section>
  );
}

export function Profile({ me, go, onSaved }: Props & { onSaved: (u: User) => void }) {
  const name = nameOf(me.user);
  return (
    <div className="page tabs">
      <Header title="Профиль" />
      <section className="card profile-head">
        <Avatar name={name} photo={me.user.photoUrl} size={60} />
        <div>
          <div className="profile-name">{name}</div>
          {me.user.username && <div className="muted small">@{me.user.username}</div>}
        </div>
      </section>
      <section className="card">
        <ProfileForm
          user={me.user}
          submitText="Сохранить"
          onSaved={(u) => {
            onSaved(u);
            go("home");
          }}
        />
      </section>
      <AccountCard user={me.user} onSaved={onSaved} />
      <div className="list">
        <ListRow icon="rules" label="Правила челленджа" onClick={() => go("rules")} />
        {!inTelegram() && <ListRow icon="logout" tone="bad" label="Выйти с сайта" onClick={logout} />}
      </div>
      <p className="muted small center-text">Часовой пояс: {me.user.timezone}. Напоминания приходят по нему.</p>
    </div>
  );
}

// ---------------- Каталог (нет участия) ----------------

/** Выбор оплаты: перевод на карту (подтверждает организатор) или Tribute в Telegram */
function PaySheet({
  item,
  card,
  hasTelegram,
  price,
  onClose,
  onRequested,
}: {
  item: CatalogItem;
  card: CardSettings | null;
  hasTelegram: boolean;
  price: string;
  onClose: () => void;
  onRequested: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(item.cardPending);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text.replace(/\s/g, "")).then(
      () => haptic("success"),
      () => undefined,
    );
  };
  const requestCard = async () => {
    setBusy(true);
    try {
      await api.post(`/challenges/${item.id}/card-payment`, { note });
      haptic("success");
      setSent(true);
      onRequested();
    } catch (e) {
      alertMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-body" role="dialog" aria-label="Оплата" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2 className="sheet-title">{item.title}</h2>
        <p className="muted sheet-sub">Стоимость {price}. После оплаты челлендж открывается и на сайте, и в Telegram.</p>
        {card && (
          <section className="card pay-card">
            <div className="card-head">
              <IconTile icon="card" tone="good" size="sm" />
              <b>Перевод на карту</b>
            </div>
            {sent ? (
              <div className="login-wait">
                <span className="dot-pulse" aria-hidden="true" />
                Заявка отправлена. Доступ откроется, как только организатор подтвердит перевод.
              </div>
            ) : (
              <>
                <button className="pay-number" onClick={() => copy(card.number)} aria-label="Скопировать номер">
                  <span>{card.number}</span>
                  <Icon name="copy" size={18} weight="bold" />
                </button>
                {(card.holder || card.bank) && (
                  <p className="muted small pay-holder">{[card.holder, card.bank].filter(Boolean).join(" · ")}</p>
                )}
                <p className="pay-amount">
                  Сумма: <b>{item.priceRub} ₽</b> за 30 дней
                </p>
                {card.note && <p className="muted small">{card.note}</p>}
                <div className="form">
                  <label>
                    Как вас найти в переводах
                    <input placeholder="имя или 4 последние цифры карты" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <button className="btn btn-primary wide" disabled={busy} onClick={() => void requestCard()}>
                    Я оплатил
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {item.tributeLink && (
          <section className="card pay-card">
            <div className="card-head">
              <IconTile icon="telegram" tone="rank" size="sm" />
              <b>Оплата в Telegram</b>
            </div>
            <p className="muted small">
              Через Tribute{item.paymentMode === "SUBSCRIPTION" ? ", с автоматическим продлением каждый месяц" : ""}. Доступ откроется сам.
              {!hasTelegram && " Для этой оплаты нужен Telegram: потом подключите его в профиле, и челлендж появится здесь."}
            </p>
            <button className="btn btn-soft wide" onClick={() => openTgLink(item.tributeLink!)}>
              Оплатить в Telegram
            </button>
          </section>
        )}
        {!card && !item.tributeLink && <div className="card muted">Оплата скоро откроется.</div>}
      </div>
    </div>
  );
}

/** Все открытые челленджи. Без участия это стартовый экран, с участием вкладка «Челленджи». */
export function Catalog({
  current,
  onOpen,
  user,
  onSaved,
}: {
  current?: number;
  onOpen?: (enrollmentId: number) => void;
  /** Стартовый экран без участия: внизу карточка «Где заниматься» (подключить Telegram, вход на сайт) */
  user?: User;
  onSaved?: (u: User) => void;
}) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [bot, setBot] = useState("");
  const [organizer, setOrganizer] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [card, setCard] = useState<CardSettings | null>(null);
  const [hasTelegram, setHasTelegram] = useState(true);
  const [paying, setPaying] = useState<CatalogItem | null>(null);
  const load = () =>
    api
      .get<{ challenges: CatalogItem[]; botUsername: string; organizer?: boolean; card: CardSettings | null; hasTelegram: boolean }>("/challenges")
      .then((r) => {
        setItems(r.challenges);
        setBot(r.botUsername);
        setOrganizer(Boolean(r.organizer));
        setCard(r.card);
        setHasTelegram(r.hasTelegram);
      })
      .catch((e) => alertMsg(e.message));
  useEffect(() => {
    void load();
  }, []);
  const inTabs = current !== undefined;
  const join = async (c: CatalogItem) => {
    // организатор участвует бесплатно и сразу попадает в челлендж
    if (organizer && onOpen) {
      setBusy(c.id);
      try {
        const r = await api.post<{ enrollmentId: number }>(`/challenges/${c.id}/join`);
        haptic("success");
        onOpen(r.enrollmentId);
      } catch (e) {
        alertMsg((e as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }
    if (card || c.tributeLink) setPaying(c);
    else if (bot) openTgLink(`https://t.me/${bot}?start=c_${c.slug}`);
  };
  const price = (c: CatalogItem) =>
    c.paymentMode === "FREE" ? "бесплатно" : `${c.priceRub} ₽${c.paymentMode === "SUBSCRIPTION" ? "/мес" : ""}`;
  return (
    <div className={`page${inTabs ? " tabs" : ""}`}>
      <div className="intro">
        <IconTile icon="leaf" tone="task" size="lg" />
        <h1 className="title">Челленджи</h1>
        <p className="subtitle">
          30 дней. Каждый день одно простое действие.
          <br />
          Можно участвовать в нескольких сразу.
        </p>
      </div>
      {organizer && (
        <div className="card organizer-note">
          <IconTile icon="seal" tone="rank" size="sm" />
          <span>Вы организатор: любой челлендж бесплатно, ваш день 1 начинается сразу. Черновики видите только вы.</span>
        </div>
      )}
      {!items && <div className="center muted">Загрузка…</div>}
      {items?.length === 0 && <div className="card muted">Скоро здесь появятся челленджи.</div>}
      {items?.map((c) => {
        const j = c.joined && c.joined.phase !== "finished" ? c.joined : null;
        const isCurrent = j?.enrollmentId === current;
        return (
          <section key={c.id} className={`card catalog-card${j ? " joined" : ""}`}>
            {c.coverUrl && <img className="task-img" src={c.coverUrl} alt="" />}
            <h2 className="task-title big">{c.title}</h2>
            <p className="muted">{c.tagline}</p>
            <div className="card-head">
              {j ? (
                <span className="chip chip-good">
                  <Icon name="check" size={14} weight="bold" />
                  {j.phase === "running" ? "Ты участвуешь" : `Ты записан · старт ${humanDate(j.startDate)}`}
                </span>
              ) : (
                <>
                  {c.draft && <span className="chip">Черновик</span>}
                  {c.cardPending && <span className="chip chip-wait">Ждём подтверждения оплаты</span>}
                  {c.joined?.phase === "finished" && <span className="chip chip-good">Пройден</span>}
                  {organizer ? (
                    <span className="chip">Старт сегодня</span>
                  ) : (
                    c.nextStart && (
                      <span className="chip">{c.nextStart === tomorrowIso() ? "Старт завтра" : `Старт ${humanDate(c.nextStart)}`}</span>
                    )
                  )}
                </>
              )}
            </div>
            {j && onOpen ? (
              <button className="btn btn-soft wide" disabled={isCurrent} onClick={() => onOpen(j.enrollmentId)}>
                {isCurrent ? "Открыт сейчас" : "Открыть"}
              </button>
            ) : (
              <button className="btn btn-primary wide" disabled={busy === c.id} onClick={() => void join(c)}>
                {c.joined ? "Пройти ещё раз" : "Участвовать"} · {organizer ? "бесплатно" : price(c)}
              </button>
            )}
          </section>
        );
      })}
      {items && items.length > 0 && !organizer && (
        <p className="muted small center-text">После оплаты вернись сюда: доступ откроется автоматически.</p>
      )}
      {!inTabs && user && onSaved && <AccountCard user={user} onSaved={onSaved} />}
      {!inTabs && !inTelegram() && (
        <div className="list">
          <ListRow icon="logout" tone="bad" label="Выйти с сайта" onClick={logout} />
        </div>
      )}
      {paying && (
        <PaySheet
          item={paying}
          card={card}
          hasTelegram={hasTelegram}
          price={price(paying)}
          onClose={() => setPaying(null)}
          onRequested={() => void load()}
        />
      )}
    </div>
  );
}

// ---------------- Финал и сертификат ----------------

export function Final({ state, me, go, open }: Props) {
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
    <div className="page tabs">
      <ChallengeSwitch me={me} current={state.enrollmentId} open={open} go={go} />
      <div className="intro">
        <IconTile icon="trophy" tone="star" size="lg" />
        <h1 className="title">Челлендж завершён</h1>
        <p className="subtitle">«{ch.title}»</p>
      </div>
      <div className="stats">
        <Tile icon="done" tone="good" value={`${s.doneCount}/${ch.durationDays}`} label="выполнено" />
        <Tile icon="fire" tone="fire" value={s.bestStreak} label="лучшая серия" />
        <Tile icon="trophy" tone="rank" value={`#${state.rank ?? "—"}`} label="место" />
        <Tile icon="star" tone="star" value={s.points} label="баллов" />
      </div>
      <section className="card">
        <h3 className="card-title">Твой результат</h3>
        <p>
          {fullyDone
            ? `Ты прошёл ${ch.durationDays} дней челленджа «${ch.title}».`
            : `Ты выполнил ${s.doneCount} ${days(s.doneCount)} из ${ch.durationDays}. Новый круг — шанс пройти все ${ch.durationDays}.`}
        </p>
      </section>
      {cert && <img className="cert" src={cert.url} alt="Сертификат" />}
      <div className="actions">
        <button className="btn btn-primary wide" disabled={busy} onClick={getCertificate}>
          <Icon name="cert" size={20} /> {cert ? "Отправить сертификат ещё раз" : "Получить сертификат"}
        </button>
        <button className="btn btn-soft wide" onClick={share}>
          <Icon name="share" size={20} /> Поделиться результатом
        </button>
      </div>
      <ChatCard state={state} go={go} />
    </div>
  );
}
