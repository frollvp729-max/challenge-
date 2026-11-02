import { useState, type ReactNode } from "react";
import type { Me, MyEnrollment } from "./api";
import type { Screen } from "./App";
import { Icon } from "./icons";
import { humanDate, plural } from "./util";

/** Кольцо прогресса: сколько дней из всех пройдено */
export function Ring({
  value,
  max,
  size = 96,
  stroke = 9,
  label,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  label?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, value / max));
  const mid = size / 2;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ring-track" cx={mid} cy={mid} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-fill"
          cx={mid}
          cy={mid}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </svg>
      <div className="ring-label">{label ?? `${Math.round(p * 100)}%`}</div>
    </div>
  );
}

function statusLine(e: MyEnrollment) {
  const pts = `${e.points} ${plural(e.points, "балл", "балла", "баллов")}`;
  if (e.phase === "upcoming") return `Старт ${humanDate(e.startDate)}`;
  if (e.phase === "finished") return `Пройден · ${pts}`;
  return `День ${e.day} из ${e.durationDays} · ${pts}`;
}

function MiniRing({ e }: { e: MyEnrollment }) {
  if (e.phase === "upcoming") return <Ring value={0} max={1} size={44} stroke={4} label={<Icon name="hourglass" size={18} />} />;
  if (e.phase === "finished") return <Ring value={1} max={1} size={44} stroke={4} label={<Icon name="check" size={18} weight="bold" />} />;
  return <Ring value={e.day} max={e.durationDays} size={44} stroke={4} label={e.day} />;
}

/**
 * Переключатель своих челленджей: капсула вверху экранов челленджа и шторка со списком.
 * Видна, только если у участника больше одного челленджа. Экран при переключении не меняется.
 */
export function ChallengeSwitch({
  me,
  current,
  open,
  go,
}: {
  me: Me;
  current: number;
  open?: (enrollmentId: number) => void;
  go: (s: Screen) => void;
}) {
  const [sheet, setSheet] = useState(false);

  if (!open || me.enrollments.length < 2) return null;
  const list = me.enrollments;
  const cur = list.find((e) => e.id === current);
  const pick = (id: number) => {
    setSheet(false);
    if (id !== current) open(id);
  };

  return (
    <>
      <button className="ctx-switch" onClick={() => setSheet(true)} aria-haspopup="dialog">
        <span className="ctx-title">{cur?.challengeTitle ?? "Мои челленджи"}</span>
        <span className="ctx-count">{list.length}</span>
        <Icon name="updown" size={16} weight="bold" />
      </button>
      {sheet && (
        <div className="sheet" onClick={() => setSheet(false)}>
          <div className="sheet-body" role="dialog" aria-label="Мои челленджи" onClick={(ev) => ev.stopPropagation()}>
            <div className="sheet-grip" />
            <h2 className="sheet-title">Мои челленджи</h2>
            <p className="muted sheet-sub">
              {list.length} {plural(list.length, "челлендж", "челленджа", "челленджей")}. Выбери, куда перейти: экран останется тем же.
            </p>
            <div className="card my-list">
              {list.map((e) => (
                <button key={e.id} className={`my-row${e.id === current ? " on" : ""}`} onClick={() => pick(e.id)}>
                  <MiniRing e={e} />
                  <span className="my-text">
                    <b>{e.challengeTitle}</b>
                    <span>{statusLine(e)}</span>
                  </span>
                  {e.id === current ? (
                    <span className="my-current">
                      <Icon name="check" size={16} weight="bold" />
                    </span>
                  ) : (
                    <Icon name="chevron" size={16} weight="bold" />
                  )}
                </button>
              ))}
            </div>
            <button
              className="btn btn-soft wide"
              onClick={() => {
                setSheet(false);
                go("catalog");
              }}
            >
              <Icon name="catalog" size={18} weight="bold" /> Все челленджи
            </button>
          </div>
        </div>
      )}
    </>
  );
}
