import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, setWebSession } from "./api";
import { Icon, IconTile, type IconName, type Tone } from "./icons";

interface Start {
  code: string;
  url: string;
  expiresIn: number;
}

function Step({ n, icon, tone, title, text }: { n: number; icon: IconName; tone: Tone; title: string; text: string }) {
  return (
    <div className="step">
      <IconTile icon={icon} tone={tone} />
      <div>
        <b>
          {n}. {title}
        </b>
        <p>{text}</p>
      </div>
    </div>
  );
}

/**
 * Вход на сайт в обычном браузере (ПК, планшет, телефон).
 * Кнопка открывает бота, бот просит подтвердить вход, страница ждёт подтверждения сама.
 * На ПК можно отсканировать QR-код телефоном.
 */
export function Login({ onDone }: { onDone: () => void }) {
  const [start, setStart] = useState<Start | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);

  // одноразовый код; обновляется, когда истекает
  const fetchCode = async () => {
    try {
      const s = await api.post<Start>("/web-auth/start");
      codeRef.current = s.code;
      setStart(s);
      setError(null);
      setQr(await QRCode.toDataURL(s.url, { margin: 1, width: 360, color: { dark: "#0f172a", light: "#ffffff00" } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void fetchCode();
  }, []);

  // ждём подтверждения в боте
  useEffect(() => {
    if (!start) return;
    let stop = false;
    const timer = setInterval(async () => {
      if (stop || document.hidden) return;
      try {
        const r = await api.get<{ status: string; token?: string }>(`/web-auth/status?code=${encodeURIComponent(start.code)}`);
        if (r.status === "confirmed" && r.token) {
          stop = true;
          clearInterval(timer);
          setWebSession(r.token);
          onDone();
        } else if (r.status === "expired" && codeRef.current === start.code) {
          stop = true;
          clearInterval(timer);
          setOpened(false);
          void fetchCode();
        }
      } catch {
        /* сеть моргнула, проверим ещё раз */
      }
    }, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [start]);

  return (
    <div className="login">
      <div className="login-main">
        <div className="intro">
          <IconTile icon="leaf" tone="task" size="lg" />
          <h1 className="title">Челленджи</h1>
          <p className="subtitle">30 дней. Каждый день одно простое действие.</p>
        </div>
        <section className="card login-card">
          <h2 className="card-title">Вход через Telegram</h2>
          <p className="muted">Тот же аккаунт, что в приложении в Telegram: задания, баллы, рейтинг, чат и оплата общие.</p>
          {error ? (
            <>
              <p className="login-error">{error}</p>
              <button className="btn btn-soft wide" onClick={() => void fetchCode()}>
                Попробовать ещё раз
              </button>
            </>
          ) : (
            <a
              className={`btn btn-primary wide${start ? "" : " is-disabled"}`}
              href={start?.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (!start) e.preventDefault();
                else setOpened(true);
              }}
            >
              <Icon name="telegram" size={22} weight="fill" />
              Войти через Telegram
            </a>
          )}
          {opened && !error && (
            <div className="login-wait">
              <span className="dot-pulse" aria-hidden="true" />
              Ждём подтверждения в Telegram. Эта страница обновится сама.
            </div>
          )}
          <div className="steps">
            <Step n={1} icon="telegram" tone="rank" title="Откроется бот" text="Нажмите кнопку выше, Telegram откроет нашего бота." />
            <Step n={2} icon="check" tone="good" title="Нажмите «Войти»" text="Бот спросит, вы ли это. Подтвердите вход." />
            <Step n={3} icon="desktop" tone="task" title="Вернитесь сюда" text="Страница сама откроет ваш кабинет." />
          </div>
        </section>
      </div>
      {qr && (
        <aside className="card login-qr">
          <h2 className="card-title">Или с телефона</h2>
          <p className="muted">Наведите камеру телефона на код и подтвердите вход в Telegram.</p>
          <img src={qr} alt="QR-код для входа" width={200} height={200} />
        </aside>
      )}
    </div>
  );
}
