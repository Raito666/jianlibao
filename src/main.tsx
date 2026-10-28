import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { getInstallController } from './pwa/install';
import { getPwaRuntime } from './pwa/runtime';
import { isIos } from './platform/native';

// Capture the browser event before users navigate to the installation guide.
getInstallController();

class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="main">
          <h1>页面暂时无法显示</h1>
          <p>你的本地记录仍保存在此浏览器中。请重新加载；不要清除浏览器数据。</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            重新加载
          </button>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
if (import.meta.env.PROD && !isIos() && 'serviceWorker' in navigator) {
  const start = () => { void getPwaRuntime().register(); };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
