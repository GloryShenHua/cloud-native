import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="page">
      <div className="card not-found">
        <span className="not-found-code">404</span>
        <h1>页面不存在</h1>
        <p className="muted">请检查地址输入，或回到场地列表重新开始。</p>
        <Link className="button button--primary" to="/">
          返回场地列表
        </Link>
      </div>
    </section>
  );
}
