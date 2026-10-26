import { NavLink, Link } from 'react-router-dom';
import type { ReactNode } from 'react';

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
              <small>Venue Booking</small>
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

        </div>
      </header>

      <main className="container main">{children}</main>

      <footer className="container footer">
        <span>场地预约系统</span>
        <span>预约时间以场地开放时间为准。</span>
      </footer>
    </div>
  );
}
