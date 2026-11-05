import { useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, AuthUser, Department, prefetchDepartment, UNAUTHORIZED_EVENT } from "./api";
import Login from "./pages/Login";
import Monitor from "./pages/Dashboard";
import DepartmentPage from "./pages/DepartmentPage";
import Analytics from "./pages/Analytics";
import Displacement from "./pages/Displacement";
import Geodata from "./pages/Geodata";
import { DeptIcon, IconChart, IconDatabase, IconHome, IconMountain } from "./components/icons";
import UpdateBanner from "./components/UpdateBanner";
import WorkspaceSearch from "./components/WorkspaceSearch";

/** Цэсэнд багтах богино нэр — бүтэн нэр нь толгой мөр ба title-д */
const DEPT_SHORT: Record<string, string> = {
  GMH: "Геологи, маркшейдер",
  COM: "Холбоо шугам",
  GHE: "Геологи хайгуул",
  BOH: "Байгаль орчин",
  NHT: "Ногоон хөгжил",
  HSE: "ХАБЭА",
  MEC: "Механик",
};

const PAGE_TITLES: Record<string, string> = {
  "/monitor": "Хяналтын самбар",
  "/displacement": "Уулын цулын шилжилт",
  "/analytics": "Дүн шинжилгээ",
  "/geodata": "Геомэдээллийн сан",
};

function WorkspaceHeader({ user, departments, onLogout }: { user: AuthUser; departments: Department[]; onLogout: () => void }) {
  const { pathname } = useLocation();
  const dept = departments.find((d) => pathname.toLowerCase() === `/dept/${d.code.toLowerCase()}`);
  const crumbs = dept ? ["Хэлтэс", dept.name] : [PAGE_TITLES[pathname] ?? ""];
  return (
    <header className="wk-head">
      <NavLink to="/monitor" className="wk-logo" title="Хяналтын самбар">
        <img src="/img/logo.png" alt="Эрдэнэт үйлдвэр ТӨҮГ" />
      </NavLink>
      <div className="wk-id">
        <b>Эрдэнэт үйлдвэрийн нэгдсэн систем</b>
        <nav aria-label="Байршил">
          {crumbs.filter(Boolean).map((c, i) => (
            <span key={c}>
              {i > 0 && <i aria-hidden>›</i>}
              {c}
            </span>
          ))}
        </nav>
      </div>
      <div className="spacer" />
      <WorkspaceSearch departments={departments} />
      <span className="wk-sep" />
      <span className="wk-user">
        <span className="sb-avatar" title={user.full_name}>{user.full_name.slice(0, 1).toUpperCase()}</span>
        <span className="who">
          {user.full_name}
          <small>{user.source === "arcgis" ? "ArcGIS · EMC" : "Дотоод эрх"}</small>
        </span>
      </span>
      <button className="wk-icon" onClick={onLogout} title="Системээс гарах" aria-label="Гарах">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
          <path d="M10 16l-4-4 4-4" />
          <path d="M6 12h10" />
        </svg>
      </button>
    </header>
  );
}

function Shell({ user, departments, onLogout }: { user: AuthUser; departments: Department[]; onLogout: () => void }) {
  return (
    <div className="app">
      <aside className="wk-dock">
        <nav aria-label="Үндсэн цэс">
          <NavLink to="/monitor" title="Хяналтын самбар">
            <IconHome size={20} />
            <span>Хяналтын самбар</span>
          </NavLink>
          <i className="wk-div" />
          {departments.map((d) => (
            <NavLink key={d.code} to={`/dept/${d.code}`} onMouseEnter={() => prefetchDepartment(d.code)} title={d.name} aria-label={d.name}>
              <DeptIcon code={d.code} color={d.color} size={20} />
              <span>{DEPT_SHORT[d.code] ?? d.name}</span>
            </NavLink>
          ))}
          <i className="wk-div" />
          <NavLink to="/displacement" title="Уулын цулын шилжилт">
            <IconMountain size={20} />
            <span>Цулын шилжилт</span>
          </NavLink>
          <NavLink to="/analytics" title="Дүн шинжилгээ">
            <IconChart size={20} />
            <span>Дүн шинжилгээ</span>
          </NavLink>
          <NavLink to="/geodata" title="Геомэдээллийн сан">
            <IconDatabase size={20} />
            <span>Геомэдээллийн сан</span>
          </NavLink>
        </nav>
      </aside>
      <main>
        <WorkspaceHeader user={user} departments={departments} onLogout={onLogout} />
        <Routes>
          {/* Нэвтэрсний дараа шууд үндсэн систем — тусдаа нүүр хуудасгүй */}
          <Route path="/" element={<Navigate to="/monitor" replace />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/analytics" element={<div className="page"><Analytics departments={departments} /></div>} />
          <Route path="/displacement" element={<Displacement />} />
          <Route path="/geodata" element={<Geodata />} />
          <Route path="/dept/:code" element={<DepartmentPage departments={departments} />} />
          <Route path="*" element={<div className="page empty">Хуудас олдсонгүй</div>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  // undefined = шалгаж байна, null = нэвтрээгүй
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [departments, setDepartments] = useState<Department[]>([]);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (user) api.departments().then(setDepartments).catch(() => setDepartments([]));
  }, [user]);

  // Хаалт {} заавал — шинэ Chrome-д scrollTo() нь Promise буцаадаг тул түүнийг effect-ийн
  // цэвэрлэгээ гэж React дуудаж, хэлтэс солих үед хуудас бүхэлдээ унаж (харанхуй) байсан.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    navigate("/");
  }, [navigate]);

  if (user === undefined) return <div className="boot">Ачаалж байна…</div>;
  if (user === null) return <Login onLogin={setUser} />;

  return (
    <>
      <UpdateBanner />
      <Shell user={user} departments={departments} onLogout={logout} />
    </>
  );
}
