import { useCallback, useEffect, useState } from "react";
import { api, type Me, type State } from "./api";
import { Icon, type IconName } from "./icons";
import { Catalog, Final, Home, Leaderboard, Onboarding, Profile, Progress, Rewards, Rules, Today } from "./screens";
import { theme } from "./theme";

export type Screen = "home" | "today" | "progress" | "leaderboard" | "rewards" | "rules" | "profile" | "final";

const TABS: Array<{ id: Screen; label: string; icon: IconName }> = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "progress", label: "Прогресс", icon: "progress" },
  { id: "leaderboard", label: "Рейтинг", icon: "rating" },
  { id: "rewards", label: "Награды", icon: "medal" },
  { id: "profile", label: "Профиль", icon: "profile" },
];
const isTab = (s: Screen) => s === "final" || TABS.some((t) => t.id === s);

function TabBar({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => {
        const on = screen === t.id || (t.id === "home" && screen === "final");
        return (
          <button key={t.id} className={`tab${on ? " on" : ""}`} onClick={() => go(t.id)}>
            <Icon name={t.icon} size={24} weight={on ? "fill" : theme.tabWeight} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

const initialScreen = (new URLSearchParams(location.search).get("screen") as Screen | null) ?? "home";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.post("/timezone", { timezone: tz }).catch(() => undefined);
      const m = await api.get<Me>("/me");
      setMe(m);
      if (m.primaryEnrollmentId) setState(await api.get<State>(`/enrollments/${m.primaryEnrollmentId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (error) return <div className="center muted">{error}</div>;
  if (!me) return <div className="center muted">Загрузка…</div>;
  if (!me.user.onboarded) return <Onboarding user={me.user} onDone={(u) => setMe({ ...me, user: u })} />;
  if (!state) return <Catalog />;

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo(0, 0);
  };
  const props = { state, setState, go, me };
  const effective = screen === "home" && state.phase === "finished" ? "final" : screen;

  const page = (() => {
    switch (effective) {
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
      default:
        return <Home {...props} />;
    }
  })();

  return (
    <>
      {page}
      {isTab(effective) && <TabBar screen={effective} go={go} />}
    </>
  );
}
