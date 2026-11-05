import { Fragment, useCallback, useEffect, useState } from "react";
import { api, inTelegram, needsLogin, logout, setUnauthorizedHandler, type Me, type State } from "./api";
import { Icon, type IconName } from "./icons";
import { Catalog, Final, Home, Leaderboard, Onboarding, Profile, Progress, Rewards, Rules, Today } from "./screens";
import { theme } from "./theme";
import { Chat } from "./chat";
import { Login } from "./login";

export type Screen = "home" | "catalog" | "today" | "progress" | "leaderboard" | "rewards" | "rules" | "profile" | "final" | "chat";

const TABS: Array<{ id: Screen; label: string; icon: IconName }> = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "catalog", label: "Челленджи", icon: "catalog" },
  { id: "progress", label: "Прогресс", icon: "progress" },
  { id: "leaderboard", label: "Рейтинг", icon: "rating" },
  { id: "profile", label: "Профиль", icon: "profile" },
];
const isTab = (s: Screen) => s === "final" || TABS.some((t) => t.id === s);

function TabBar({ screen, go, deskOnly }: { screen: Screen; go: (s: Screen) => void; deskOnly?: boolean }) {
  return (
    <nav className={`tabbar${deskOnly ? " desk-only" : ""}`}>
      {/* на широком экране меню становится боковой панелью с названием */}
      <div className="tabbar-brand">
        <span className="itile itile-sm tone-task">
          <Icon name="leaf" size={16} />
        </span>
        Челленджи
      </div>
      {TABS.map((t) => {
        const on = screen === t.id || (t.id === "home" && screen === "final");
        return (
          <button key={t.id} className={`tab${on ? " on" : ""}`} onClick={() => go(t.id)}>
            <Icon name={t.icon} size={24} weight={on ? "fill" : theme.tabWeight} />
            <span>{t.label}</span>
          </button>
        );
      })}
      {!inTelegram() && (
        <button className="tab tab-logout" onClick={logout}>
          <Icon name="logout" size={24} weight={theme.tabWeight} />
          <span>Выйти</span>
        </button>
      )}
    </nav>
  );
}

// Какой из челленджей участника открыт сейчас (запоминаем на устройстве)
const CURRENT_KEY = "currentEnrollment";
function savedEnrollment(): number | null {
  try {
    return Number(localStorage.getItem(CURRENT_KEY)) || null;
  } catch {
    return null;
  }
}
function saveEnrollment(id: number) {
  try {
    localStorage.setItem(CURRENT_KEY, String(id));
  } catch {
    /* без хранилища просто откроется основной челлендж */
  }
}

const query = new URLSearchParams(location.search);
const initialScreen = (query.get("screen") as Screen | null) ?? "home";
/** Ссылка из уведомления бота может указать, какое участие открыть (например, чат другого челленджа) */
const initialEnrollment = Number(query.get("enrollment")) || null;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState(needsLogin);

  const load = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.post("/timezone", { timezone: tz }).catch(() => undefined);
      const m = await api.get<Me>("/me");
      setMe(m);
      const has = (id: number | null) => id !== null && m.enrollments.some((e) => e.id === id);
      const saved = savedEnrollment();
      const id = has(initialEnrollment) ? initialEnrollment : has(saved) ? saved : m.primaryEnrollmentId;
      if (id) setState(await api.get<State>(`/enrollments/${id}`));
    } catch (e) {
      if (!needsLogin()) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // сессия сайта истекла: показать экран входа
    setUnauthorizedHandler(() => {
      setMe(null);
      setState(null);
      setLogin(true);
    });
    if (!login) void load();
  }, [load, login]);

  // Кнопка «Назад» Telegram возвращает на главный экран с внутренних экранов (у вкладок есть нижнее меню)
  useEffect(() => {
    const bb = window.Telegram?.WebApp.BackButton;
    if (!bb) return;
    const back = () => setScreen("home");
    if (isTab(screen)) bb.hide();
    else bb.show();
    bb.onClick(back);
    return () => bb.offClick(back);
  }, [screen]);

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo(0, 0);
  };
  /**
   * Переключиться на другой свой челлендж.
   * stay: остаться на том же экране (рейтинг → рейтинг другого челленджа), иначе на главную.
   */
  const open = async (id: number, stay = false) => {
    try {
      const [next, m] = await Promise.all([api.get<State>(`/enrollments/${id}`), api.get<Me>("/me")]);
      saveEnrollment(id);
      setMe(m);
      setState(next);
      if (stay) window.scrollTo(0, 0);
      else go("home");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const switchTo = (id: number) => void open(id, true);

  if (login) return <Login onDone={() => setLogin(false)} />;
  if (error) return <div className="center muted">{error}</div>;
  if (!me) return <div className="center muted">Загрузка…</div>;
  if (!me.user.onboarded) return <Onboarding user={me.user} onDone={(u) => setMe({ ...me, user: u })} />;
  if (!state) return <Catalog onOpen={(id) => void open(id)} />;

  const props = { state, setState, go, me, open: switchTo };
  const effective = screen === "home" && state.phase === "finished" ? "final" : screen;

  const page = (() => {
    switch (effective) {
      case "catalog":
        return <Catalog current={state.enrollmentId} onOpen={(id) => void open(id)} />;
      case "today":
        return <Today {...props} />;
      case "progress":
        return <Progress {...props} />;
      case "leaderboard":
        return <Leaderboard {...props} />;
      case "rewards":
        return <Rewards {...props} />;
      case "rules":
        return <Rules {...props} />;
      case "profile":
        return <Profile {...props} onSaved={(u) => setMe({ ...me, user: u })} />;
      case "final":
        return <Final {...props} />;
      case "chat":
        return <Chat state={state} me={me} open={switchTo} go={go} />;
      default:
        return <Home {...props} />;
    }
  })();

  return (
    <>
      {/* другой челлендж: экран собирается заново, без остатков прошлого (лента чата, открытые окна) */}
      <Fragment key={state.enrollmentId}>{page}</Fragment>
      {/* на телефоне меню только на вкладках, на компьютере боковое меню на всех экранах */}
      <TabBar screen={effective} go={go} deskOnly={!isTab(effective)} />
    </>
  );
}
