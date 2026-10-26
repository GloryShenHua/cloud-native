import { NavLink, Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link is-active' : 'nav-link';

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const currentPage = pathname.startsWith('/reservations') ? '预约记录'
    : pathname.startsWith('/venues/') ? '场地详情' : '场地列表';
  const currentDate = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date());

  return (
    <div className="app">
      <aside className="app-sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="building" width={23} height={23} />
          </span>
          <span className="brand-text">
            <strong>场地预约</strong>
            <small>管理工作台</small>
          </span>
        </Link>

        <nav className="nav" aria-label="主导航">
          <span className="nav-caption">日常管理</span>
          <NavLink to="/" end className={({ isActive }) => navClass({
            isActive: isActive || pathname.startsWith('/venues/'),
          })}>
            <Icon name="list" />
            场地列表
          </NavLink>
          <NavLink to="/reservations" className={navClass}>
            <Icon name="calendar" />
            预约记录
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <span>预约须知</span>
          <p>提交前请确认开放时间。取消预约后，该时段将重新开放。</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="container workspace-header-inner">
            <div className="breadcrumb">
              <span>场地管理</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{currentPage}</span>
            </div>
            <span className="workspace-date">{currentDate}</span>
          </div>
        </header>
        <main className="container main">{children}</main>
      </div>
    </div>
  );
}
