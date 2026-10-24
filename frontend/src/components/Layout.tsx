import { NavLink, Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { apiBaseUrl, apiBaseUrlSource } from '../config';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link is-active' : 'nav-link';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="app-header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              场
            </span>
            <span className="brand-text">
              <strong>场地预约系统</strong>
              <small>Cloud Native Lab 1</small>
            </span>
          </Link>

          <nav className="nav" aria-label="主导航">
            <NavLink to="/" end className={navClass}>
              场地列表
            </NavLink>
            <NavLink to="/reservations" className={navClass}>
              预约记录
            </NavLink>
          </nav>

          <span
            className="api-chip"
            title={`前端请求的后端地址：${apiBaseUrl}（来源：${apiBaseUrlSource}）`}
          >
            API <code>{apiBaseUrl}</code>
          </span>
        </div>
      </header>

      <main className="container main">{children}</main>

      <footer className="container footer">
        <span>数据来自后端 Web API，前端不直接访问数据库。</span>
        <span>云原生软件技术 · Lab 1</span>
      </footer>
    </div>
  );
}
