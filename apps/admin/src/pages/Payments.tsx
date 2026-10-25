import { useEffect, useState } from "react";
import { api } from "../api";

interface P {
  id: number;
  event: string;
  amount: number | null;
  currency: string | null;
  challengeId: number | null;
  createdAt: string;
  user: { telegramId: string; username: string | null } | null;
  raw: { payload?: { subscription_id?: number; product_id?: number; subscription_name?: string; product_name?: string } };
}

const EV: Record<string, string> = {
  new_subscription: "Новая подписка",
  renewed_subscription: "Продление",
  cancelled_subscription: "Отмена автопродления",
  new_digital_product: "Покупка",
};

export function Payments() {
  const [rows, setRows] = useState<P[]>([]);
  useEffect(() => {
    api.get<P[]>("/payments").then(setRows);
  }, []);
  return (
    <>
      <h1>Платежи (вебхуки Tribute)</h1>
      <table>
        <thead><tr><th>Дата</th><th>Событие</th><th>Пользователь</th><th>Сумма</th><th>Tribute ID</th><th>Челлендж</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.createdAt).toLocaleString("ru")}</td>
              <td>{EV[p.event] ?? p.event}</td>
              <td>{p.user ? (p.user.username ? `@${p.user.username}` : p.user.telegramId) : "—"}</td>
              <td>{p.amount != null ? `${p.amount} ${p.currency?.toUpperCase() ?? ""}` : "—"}</td>
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
