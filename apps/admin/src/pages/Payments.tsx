import { useEffect, useState } from "react";
import { api } from "../api";

interface P {
  id: number;
  event: string;
  amount: number | null;
  currency: string | null;
  challengeId: number | null;
  createdAt: string;
  user: { telegramId: string | null; email: string | null; username: string | null } | null;
  raw: { payload?: { subscription_id?: number; product_id?: number; subscription_name?: string; product_name?: string } };
}

const EV: Record<string, string> = {
  new_subscription: "Новая подписка",
  renewed_subscription: "Продление",
  cancelled_subscription: "Отмена автопродления",
  new_digital_product: "Покупка",
  card_transfer: "Перевод на карту",
};

interface CardSettings {
  number: string;
  holder: string;
  bank: string;
  note: string;
}

interface CardRequest {
  id: number;
  status: "pending" | "approved" | "rejected";
  amount: number;
  note: string;
  createdAt: string;
  challenge: string;
  name: string;
  email: string | null;
  telegramId: string | null;
  username: string | null;
}

const STATUS: Record<CardRequest["status"], string> = { pending: "ждёт проверки", approved: "подтверждён", rejected: "отклонён" };

/** Реквизиты для перевода и заявки «Я оплатил» */
function CardTransfers() {
  const [s, setS] = useState<CardSettings>({ number: "", holder: "", bank: "", note: "" });
  const [list, setList] = useState<CardRequest[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api.get<CardRequest[]>("/card-payments").then(setList);
  useEffect(() => {
    api.get<CardSettings>("/card-settings").then(setS);
    void load();
  }, []);
  const save = async () => {
    try {
      setS(await api.put<CardSettings>("/card-settings", s));
      setMsg({ ok: true, text: s.number ? "Сохранено. Участники видят оплату переводом на карту." : "Сохранено. Номер пустой: оплата на карту выключена." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const decide = async (r: CardRequest, action: "approve" | "reject") => {
    const q =
      action === "approve"
        ? `Подтвердить перевод ${r.amount} ₽ от «${r.name}» за «${r.challenge}»? Участнику откроется доступ.`
        : `Отклонить заявку «${r.name}» за «${r.challenge}»? Доступ не откроется.`;
    if (!confirm(q)) return;
    try {
      await api.post(`/card-payments/${r.id}/${action}`);
      await load();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const who = (r: CardRequest) => [r.email, r.username ? `@${r.username}` : null, r.telegramId && !r.username ? `TG ${r.telegramId}` : null].filter(Boolean).join(" · ");
  const pending = list.filter((r) => r.status === "pending").length;
  return (
    <>
      <h1>Оплата переводом на карту</h1>
      {msg && <div className={msg.ok ? "ok" : "error"}>{msg.text}</div>}
      <div className="panel">
        <div className="row">
          <label className="field" style={{ flex: 2 }}>
            <span>Номер карты или телефон для СБП (пусто = оплата на карту выключена)</span>
            <input value={s.number} onChange={(e) => setS({ ...s, number: e.target.value })} placeholder="2200 0000 0000 0000" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Получатель</span>
            <input value={s.holder} onChange={(e) => setS({ ...s, holder: e.target.value })} placeholder="Виталий П." />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Банк</span>
            <input value={s.bank} onChange={(e) => setS({ ...s, bank: e.target.value })} placeholder="Т-Банк" />
          </label>
        </div>
        <label className="field">
          <span>Подсказка участнику (необязательно)</span>
          <input value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} placeholder="В комментарии к переводу ничего писать не нужно" />
        </label>
        <button className="primary" onClick={() => void save()}>Сохранить</button>
      </div>
      <h2>Заявки «Я оплатил» {pending > 0 && <span className="badge ACTIVE">{pending} ждут</span>}</h2>
      <p className="muted small">Сверьте поступление в банке и нажмите «Подтвердить»: участнику откроется челлендж, и на сайте, и в Telegram.</p>
      <table>
        <thead><tr><th>Дата</th><th>Участник</th><th>Челлендж</th><th>Сумма</th><th>Как найти перевод</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={7} className="muted">Заявок пока нет</td></tr>}
          {list.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleString("ru")}</td>
              <td>{r.name}<div className="muted small">{who(r)}</div></td>
              <td>{r.challenge}</td>
              <td>{r.amount} ₽</td>
              <td>{r.note || <span className="muted">—</span>}</td>
              <td>{STATUS[r.status]}</td>
              <td>
                {r.status === "pending" && (
                  <div className="row" style={{ margin: 0 }}>
                    <button className="primary" onClick={() => void decide(r, "approve")}>Подтвердить</button>
                    <button onClick={() => void decide(r, "reject")}>Отклонить</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Payments() {
  const [rows, setRows] = useState<P[]>([]);
  useEffect(() => {
    api.get<P[]>("/payments").then(setRows);
  }, []);
  return (
    <>
      <CardTransfers />
      <h1 style={{ marginTop: 32 }}>Платежи (вебхуки Tribute и переводы)</h1>
      <table>
        <thead><tr><th>Дата</th><th>Событие</th><th>Пользователь</th><th>Сумма</th><th>Tribute ID</th><th>Челлендж</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.createdAt).toLocaleString("ru")}</td>
              <td>{EV[p.event] ?? p.event}</td>
              <td>{p.user ? (p.user.username ? `@${p.user.username}` : p.user.telegramId ?? p.user.email) : "—"}</td>
              <td>{p.amount != null ? `${p.amount / 100} ${p.currency?.toUpperCase() ?? ""}` : "—"}</td>
              <td>
                {p.raw?.payload?.subscription_id ? `subscription_id ${p.raw.payload.subscription_id}` : p.raw?.payload?.product_id ? `product_id ${p.raw.payload.product_id}` : "—"}
                <div className="muted small">{p.raw?.payload?.subscription_name ?? p.raw?.payload?.product_name}</div>
              </td>
              <td>{p.challengeId ?? <span className="muted">не привязан: впишите этот ID в челлендж (Настройки → subscription_id) и сохраните</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
