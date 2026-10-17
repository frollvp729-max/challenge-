import { useEffect, useState } from "react";
import { getToken } from "./api";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Challenges } from "./pages/Challenges";
import { ChallengeEdit } from "./pages/ChallengeEdit";
import { Participants } from "./pages/Participants";
import { Reports } from "./pages/Reports";
import { Broadcasts } from "./pages/Broadcasts";
import { Payments } from "./pages/Payments";

function useHash() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.slice(1);
}

const NAV: Array<[string, string]> = [
  ["/", "Статистика"],
  ["/challenges", "Челленджи"],
  ["/participants", "Участники"],
  ["/reports", "Результаты"],
  ["/broadcasts", "Рассылка"],
  ["/payments", "Платежи"],
];

export function App() {
  const path = useHash();
  if (!getToken() || path === "/login") return <Login />;

  const [route, query] = path.split("?");
  const params = new URLSearchParams(query);
  let page;
  const m = route.match(/^\/challenges\/(\d+)$/);
  if (m) page = <ChallengeEdit id={Number(m[1])} />;
  else if (route === "/challenges") page = <Challenges />;
  else if (route === "/participants") page = <Participants initialStream={params.get("stream") ?? ""} />;
  else if (route === "/reports") page = <Reports />;
  else if (route === "/broadcasts") page = <Broadcasts />;
  else if (route === "/payments") page = <Payments />;
  else page = <Dashboard />;

  return (
    <div className="layout">
      <nav>
        <div className="brand">Фабрика челленджей</div>
        {NAV.map(([href, title]) => (
          <a key={href} href={`#${href}`} className={route === href || (href !== "/" && route.startsWith(href)) ? "active" : ""}>
            {title}
          </a>
        ))}
      </nav>
      <main>{page}</main>
    </div>
  );
}
