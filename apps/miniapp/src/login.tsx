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

/** Регистрация и вход по почте и паролю: Telegram не нужен */
function SiteForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"register" | "login" | "forgot">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const switchMode = (m: typeof mode) => {
    setMode(m);
    setError(null);
    setSent(false);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        await api.post("/web-auth/forgot", { email });
        setSent(true);
      } else {
        const r = await api.post<{ token: string }>(`/web-auth/${mode}`, { name, email, password });
        setWebSession(r.token);
        onDone();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (mode === "forgot") {
    return (
      <section className="card login-card">
        <h2 className="login-h">Восстановить пароль</h2>
        {sent ? (
          <>
            <div className="login-sent">
              <IconTile icon="mail" tone="task" />
              <p>
                Если <b>{email}</b> зарегистрирована, на неё пришло письмо со ссылкой. Ссылка действует 1 час. Не видите
                письмо? Загляните в «Спам».
              </p>
            </div>
            <button className="btn btn-primary wide" onClick={() => switchMode("login")}>
              Вернуться ко входу
            </button>
          </>
        ) : (
          <form className="form" onSubmit={submit}>
            <p className="muted small">Укажите почту, с которой вы регистрировались. Пришлём ссылку, чтобы задать новый пароль.</p>
            <label>
              Почта
              <input type="email" value={email} autoComplete="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && <p className="login-error">{error}</p>}
            <button className="btn btn-primary wide" disabled={busy || !email}>
              Прислать ссылку
            </button>
            <button type="button" className="btn btn-ghost wide" onClick={() => switchMode("login")}>
              Назад
            </button>
          </form>
        )}
      </section>
    );
  }
  return (
    <section className="card login-card">
      <div className="seg">
        <button className={mode === "register" ? "on" : ""} onClick={() => switchMode("register")}>
          Регистрация
        </button>
        <button className={mode === "login" ? "on" : ""} onClick={() => switchMode("login")}>
          Вход
        </button>
      </div>
      <form className="form" onSubmit={submit}>
        {mode === "register" && (
          <label>
            Имя или ник для рейтинга
            <input value={name} maxLength={32} autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          Почта
          <input type="email" value={email} autoComplete="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            placeholder={mode === "register" ? "не короче 6 символов" : ""}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="btn btn-primary wide" disabled={busy || !email || !password || (mode === "register" && !name.trim())}>
          {mode === "register" ? "Создать аккаунт" : "Войти"}
        </button>
        {mode === "login" && (
          <button type="button" className="link-btn" onClick={() => switchMode("forgot")}>
            Забыли пароль?
          </button>
        )}
      </form>
      <p className="muted small login-foot">
        Telegram не нужен. Если захотите, подключите его потом в профиле: прогресс и оплата станут общими.
      </p>
    </section>
  );
}

/** Новый пароль по ссылке из письма (?reset=...) */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError("Пароли не совпадают");
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ token: string }>("/web-auth/reset", { token, password });
      setWebSession(r.token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="login-main">
        <div className="intro">
          <IconTile icon="leaf" tone="task" size="lg" />
          <h1 className="title">Новый пароль</h1>
          <p className="subtitle">Придумайте пароль, с ним вы будете входить на сайт.</p>
        </div>
        <section className="card login-card">
          <form className="form" onSubmit={submit}>
            <label>
              Новый пароль
              <input type="password" value={password} autoComplete="new-password" placeholder="не короче 6 символов" onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>
              Ещё раз
              <input type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
            </label>
            {error && <p className="login-error">{error}</p>}
            <button className="btn btn-primary wide" disabled={busy || password.length < 6 || !again}>
              Сохранить и войти
            </button>
            <button type="button" className="btn btn-ghost wide" onClick={() => onDone()}>
              Отмена
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

/** Вход через Telegram: бот подтверждает, страница ждёт сама. На ПК есть QR-код. */
function TelegramLogin({ onDone }: { onDone: () => void }) {
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
      setQr(await QRCode.toDataURL(s.url, { margin: 1, width: 360, color: { dark: "#0f172a", light: "#ffffff" } }));
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

  // ссылка на самого бота: там кнопка, которая открывает приложение внутри Telegram
  const botLink = start?.url.split("?")[0];

  return (
    <div className="login-tg">
      <section className="card login-card">
        <h2 className="card-title">Пользоваться в Telegram</h2>
        <p className="muted">Приложение откроется прямо в Telegram, задания и напоминания будут приходить от бота.</p>
        <a className={`btn btn-primary wide${botLink ? "" : " is-disabled"}`} href={botLink ?? "#"} target="_blank" rel="noopener noreferrer">
          <Icon name="telegram" size={22} weight="fill" />
          Открыть в Telegram
        </a>
      </section>
      <section className="card login-card">
        <h2 className="card-title">Войти на сайт через Telegram</h2>
        <p className="muted">Если вы уже участвуете через Telegram, войдите тем же аккаунтом: задания, баллы, чат и оплата общие.</p>
        {error ? (
          <>
            <p className="login-error">{error}</p>
            <button className="btn btn-soft wide" onClick={() => void fetchCode()}>
              Попробовать ещё раз
            </button>
          </>
        ) : (
          <a
            className={`btn btn-soft wide${start ? "" : " is-disabled"}`}
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
          <Step n={1} icon="telegram" tone="rank" title="Откроется бот" text="Нажмите кнопку выше." />
          <Step n={2} icon="check" tone="good" title="Нажмите «Войти»" text="Бот спросит, вы ли это." />
          <Step n={3} icon="desktop" tone="task" title="Вернитесь сюда" text="Страница сама откроет кабинет." />
        </div>
        {qr && (
          <div className="login-qr">
            <img src={qr} alt="QR-код для входа" width={168} height={168} />
            <p className="muted small">Или наведите камеру телефона на код</p>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Первый экран в обычном браузере (ПК, планшет, телефон).
 * Человек сам выбирает: заниматься на сайте (почта и пароль) или в Telegram.
 */
export function Login({ onDone }: { onDone: () => void }) {
  const [way, setWay] = useState<"site" | "tg">("site");
  return (
    <div className="login">
      <div className="login-main">
        <div className="intro">
          <IconTile icon="leaf" tone="task" size="lg" />
          <h1 className="title">Челленджи</h1>
          <p className="subtitle">30 дней. Каждый день одно простое действие.</p>
        </div>
        <p className="login-ask">Где удобнее заниматься?</p>
        <div className="seg seg-big">
          <button className={way === "site" ? "on" : ""} onClick={() => setWay("site")}>
            <Icon name="desktop" size={18} weight="bold" /> На сайте
          </button>
          <button className={way === "tg" ? "on" : ""} onClick={() => setWay("tg")}>
            <Icon name="telegram" size={18} weight="fill" /> В Telegram
          </button>
        </div>
        {way === "site" ? <SiteForm onDone={onDone} /> : <TelegramLogin onDone={onDone} />}
      </div>
    </div>
  );
}
