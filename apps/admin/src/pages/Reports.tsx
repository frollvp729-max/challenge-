import { useEffect, useState } from "react";
import { api } from "../api";

interface R {
  id: number;
  dayNumber: number;
  status: string;
  proofPhoto: string | null;
  proofText: string | null;
  proofRejected: boolean;
  checklistDone: string[];
  createdAt: string;
  name: string;
  username: string | null;
  challenge: string;
}

export function Reports() {
  const [rows, setRows] = useState<R[]>([]);
  const [day, setDay] = useState("");
  const [withProof, setWithProof] = useState(true);
  const load = () => {
    const p = new URLSearchParams();
    if (day) p.set("day", day);
    if (withProof) p.set("withProof", "1");
    api.get<R[]>(`/reports?${p}`).then(setRows);
  };
  useEffect(load, [day, withProof]);
  const toggle = async (r: R) => {
    await api.put(`/reports/${r.id}`, { proofRejected: !r.proofRejected });
    load();
  };
  return (
    <>
      <h1>Результаты</h1>
      <div className="row">
        <input type="number" placeholder="День" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 100 }} />
        <label className="check">
          <input type="checkbox" checked={withProof} onChange={(e) => setWithProof(e.target.checked)} /> только с доказательством
        </label>
      </div>
      <p className="muted">Отклонённое доказательство снимает +5 баллов у участника, рейтинг пересчитывается сразу.</p>
      <div className="cards">
        {rows.map((r) => (
          <div key={r.id} className={`rcard ${r.proofRejected ? "rejected" : ""}`}>
            <div className="row space">
              <b>{r.name}</b>
              <span>{r.status === "DONE" ? "🟢" : "🔴"} день {r.dayNumber}</span>
            </div>
            <div className="muted small">{r.challenge} · {new Date(r.createdAt).toLocaleString("ru")}</div>
            {r.proofPhoto && (
              <a href={r.proofPhoto} target="_blank" rel="noreferrer">
                <img src={r.proofPhoto} alt="" />
              </a>
            )}
            {r.proofText && <p>«{r.proofText}»</p>}
            {r.checklistDone.length > 0 && <div className="small">✓ {r.checklistDone.join(", ")}</div>}
            {(r.proofPhoto || r.proofText) && (
              <button className="small" onClick={() => toggle(r)}>
                {r.proofRejected ? "Вернуть доказательство" : "Отклонить доказательство"}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
