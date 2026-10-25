import { useEffect, useState } from "react";
import { api } from "../api";
import { STATUS } from "./Challenges";

interface Day {
  id: number;
  dayNumber: number;
  title: string;
  description: string;
  task: string;
  hint: string;
  imageUrl: string | null;
  points: number | null;
  proofType: string;
  proofPrompt: string;
  proofRequired: boolean;
  checklist: string[];
}
interface Challenge {
  id: number;
  [k: string]: any;
  days: Day[];
  participants: number;
}

type FieldDef = [key: string, label: string, kind?: "text" | "area" | "number" | "select" | "image" | "date", options?: Array<[string, string]>];

const SETTINGS: Array<[string, FieldDef[]]> = [
  [
    "Основное",
    [
      ["title", "Название"],
      ["slug", "Slug (ссылка t.me/бот?start=c_slug)"],
      ["status", "Статус", "select", [["DRAFT", "Черновик"], ["ACTIVE", "Активен"], ["ARCHIVED", "Архив"]]],
      ["tagline", "Короткое описание"],
      ["intro", "Приветствие в боте (HTML: <b>жирный</b>)", "area"],
      ["rules", "Правила", "area"],
      ["coverUrl", "Обложка", "image"],
      ["startDate", "Дата открытия (кто записался раньше, начнёт в этот день; позже — на следующий день после оплаты)", "date"],
      ["durationDays", "Длительность, дней", "number"],
      ["chatLink", "Ссылка на чат участников"],
      ["sortOrder", "Порядок в каталоге", "number"],
    ],
  ],
  [
    "Оплата (Tribute)",
    [
      ["priceRub", "Цена, ₽ (для показа)", "number"],
      ["paymentMode", "Тип оплаты", "select", [["SUBSCRIPTION", "Подписка с автосписанием"], ["ONE_TIME", "Разовая покупка (цифровой товар)"], ["FREE", "Бесплатно"]]],
      ["tributeLink", "Ссылка на оплату в Tribute"],
      ["tributeSubscriptionId", "subscription_id подписки Tribute", "number"],
      ["tributeProductId", "product_id цифрового товара Tribute", "number"],
    ],
  ],
  [
    "Очки и напоминания",
    [
      ["pointsDone", "За выполнение", "number"],
      ["pointsProof", "За доказательство", "number"],
      ["pointsViolation", "За нарушение (отрицательное)", "number"],
      ["streakSaveCost", "Цена «спасти серию»", "number"],
      ["streakSavesAllowed", "Сколько раз можно спасти серию", "number"],
      ["morningHour", "Час утреннего задания (по времени участника)", "number"],
      ["eveningHour", "Час вечернего напоминания", "number"],
    ],
  ],
];

function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="row">
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
      <label className="btn">
        Загрузить
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onChange((await api.upload(f)).url);
          }}
        />
      </label>
      {value && <img className="thumb" src={value} alt="" />}
    </div>
  );
}

function Field({ def, value, onChange }: { def: FieldDef; value: any; onChange: (v: any) => void }) {
  const [key, label, kind = "text", options] = def;
  let input;
  if (kind === "area") input = <textarea rows={key === "rules" ? 12 : 4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  else if (kind === "select")
    input = (
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {options!.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    );
  else if (kind === "image") input = <ImageField value={value} onChange={onChange} />;
  else if (kind === "date") input = <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />;
  else input = <input type={kind === "number" ? "number" : "text"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  return (
    <label className="field" key={key}>
      <span>{label}</span>
      {input}
    </label>
  );
}

export function ChallengeEdit({ id }: { id: number }) {
  const [c, setC] = useState<Challenge | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [tab, setTab] = useState<"settings" | "days" | "start">("days");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [editDay, setEditDay] = useState<Day | null>(null);

  const load = async () => {
    try {
      const data = await api.get<Challenge>(`/challenges/${id}`);
      setC(data);
      setDraft(data);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => void load(), [id]);

  const flash = (m: string) => {
    setMsg(m);
    setErr("");
    setTimeout(() => setMsg(""), 2500);
  };
  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      flash(ok);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!c) return <div>{err || "Загрузка…"}</div>;

  const saveSettings = () => {
    const body: Record<string, unknown> = {};
    for (const [, fields] of SETTINGS) for (const [k] of fields) body[k] = draft[k];
    return wrap(async () => {
      const r = await api.put<{ enrolled?: number }>(`/challenges/${id}`, body);
      if (r.enrolled) alert(`Записаны оплатившие: ${r.enrolled}`);
    }, "Сохранено");
  };

  return (
    <>
      <div className="row space">
        <h1>{c.title} <span className={`badge ${c.status}`}>{STATUS[c.status]}</span></h1>
        <a href="#/challenges">← все челленджи</a>
      </div>
      <div className="tabs">
        <button className={tab === "days" ? "on" : ""} onClick={() => setTab("days")}>Задания ({c.days.length})</button>
        <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>Настройки</button>
        <button className={tab === "start" ? "on" : ""} onClick={() => setTab("start")}>Запуск и участники ({c.participants})</button>
      </div>
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="error">{err}</div>}

      {tab === "settings" && (
        <div className="panel">
          {SETTINGS.map(([group, fields]) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {fields.map((def) => (
                <Field key={def[0]} def={def} value={draft[def[0]]} onChange={(v) => setDraft({ ...draft, [def[0]]: v })} />
              ))}
            </fieldset>
          ))}
          <button className="primary" onClick={saveSettings}>СОХРАНИТЬ</button>
        </div>
      )}

      {tab === "days" && (
        <div className="panel">
          {c.days.length < c.durationDays && (
            <div className="row">
              <span className="muted">Заполнено {c.days.length} из {c.durationDays} дней.</span>
              <button onClick={() => wrap(() => api.post(`/challenges/${id}/days/generate`), "Дни созданы")}>
                Создать недостающие дни
              </button>
            </div>
          )}
          <table>
            <thead>
              <tr><th>День</th><th>Заголовок</th><th>Задание</th><th>Доказательство</th><th>Баллы</th></tr>
            </thead>
            <tbody>
              {c.days.map((d) => (
                <tr key={d.id} className="link" onClick={() => setEditDay(d)}>
                  <td>{d.dayNumber}</td>
                  <td><b>{d.title}</b></td>
                  <td className="muted clip">{d.task}</td>
                  <td>{d.proofType === "none" ? "—" : d.proofRequired ? "обязательно" : "по желанию"}</td>
                  <td>{d.points ?? c.pointsDone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "start" && (
        <div className="panel">
          <p>
            Вход в челлендж открыт всегда. Дата открытия: <b>{c.startDate ? c.startDate.split("-").reverse().join(".") : "не задана"}</b>.
          </p>
          <p className="muted">
            Кто оплатил до даты открытия, начинает в этот день. Кто пришёл позже, начинает свои {c.durationDays} дней на следующий день
            после оплаты. При продлении подписки следующий круг начинается сразу после текущего. Рейтинг общий для всех участников,
            плюс в приложении есть сравнение «на том же дне». Дату открытия можно поменять во вкладке «Настройки».
          </p>
          <div className="row">
            <a className="btn" href={`#/participants?challenge=${id}`}>Участники и рейтинг ({c.participants}) →</a>
            <button
              onClick={() =>
                wrap(async () => {
                  const r = await api.post<{ enrolled: number }>(`/challenges/${id}/enroll-paid`);
                  flash(`Записано: ${r.enrolled}`);
                }, "Готово")
              }
            >
              Записать оплативших, у кого нет участия
            </button>
          </div>
        </div>
      )}

      {editDay && (
        <DayEditor
          day={editDay}
          defaultPoints={c.pointsDone}
          onClose={() => setEditDay(null)}
          onSaved={async () => {
            setEditDay(null);
            flash("День сохранён");
            await load();
          }}
        />
      )}
    </>
  );
}

function DayEditor({ day, defaultPoints, onClose, onSaved }: { day: Day; defaultPoints: number; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<any>({ ...day, checklist: day.checklist.join("\n"), points: day.points ?? "" });
  const [err, setErr] = useState("");
  const set = (k: string) => (v: any) => setD({ ...d, [k]: v });
  const save = async () => {
    try {
      await api.put(`/days/${day.id}`, d);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <h2>День {day.dayNumber}</h2>
        {err && <div className="error">{err}</div>}
        <Field def={["title", "Заголовок"]} value={d.title} onChange={set("title")} />
        <Field def={["description", "Описание", "area"]} value={d.description} onChange={set("description")} />
        <Field def={["task", "Задание", "area"]} value={d.task} onChange={set("task")} />
        <Field def={["hint", "Подсказка / что считается нарушением", "area"]} value={d.hint} onChange={set("hint")} />
        <Field def={["imageUrl", "Изображение", "image"]} value={d.imageUrl} onChange={set("imageUrl")} />
        <label className="field">
          <span>Баллы за выполнение (пусто = {defaultPoints})</span>
          <input type="number" value={d.points} onChange={(e) => set("points")(e.target.value)} />
        </label>
        <Field
          def={["proofType", "Доказательство", "select", [["photo_or_text", "Фото или текст"], ["photo", "Только фото"], ["text", "Только текст"], ["none", "Не нужно"]]]}
          value={d.proofType}
          onChange={set("proofType")}
        />
        <label className="check">
          <input type="checkbox" checked={d.proofRequired} onChange={(e) => set("proofRequired")(e.target.checked)} />
          Требуется ли доказательство (без него нельзя пропустить шаг)
        </label>
        <Field def={["proofPrompt", "Вопрос для текстового отчёта"]} value={d.proofPrompt} onChange={set("proofPrompt")} />
        <Field def={["checklist", "Чек-лист (по пункту на строку, необязательно)", "area"]} value={d.checklist} onChange={set("checklist")} />
        <div className="row">
          <button className="primary" onClick={save}>СОХРАНИТЬ</button>
          <button onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
