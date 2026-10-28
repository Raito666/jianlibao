import { useState, useSyncExternalStore } from 'react';
import { isIos } from '../platform/native';
import { getInstallController, type InstallPlatform } from '../pwa/install';
import Icon from '../components/Icon';

export default function InstallApp() {
  const controller = getInstallController();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [choice, setChoice] = useState<InstallPlatform>(state.platform === 'other' ? 'ios' : state.platform);
  if (isIos()) return null;
  return (
    <section className="card install-app" aria-labelledby="install-app-title">
      <div className="install-heading">
        <img src="/icon-192.png" width="48" height="48" alt="" />
        <div><h2 id="install-app-title">安装到手机</h2><p className="muted">桌面一点就开，训练时少找一步。</p></div>
      </div>
      {state.installed ? <p className="install-state" role="status"><Icon name="check" />已安装到设备，可从桌面图标打开。</p> : <>
        {state.embedded && <p className="install-hint">当前是应用内浏览器。请先用右上角菜单选择“在浏览器打开”；iPhone 推荐 Safari，安卓推荐 Chrome。</p>}
        {state.available && <button className="btn btn-primary" onClick={() => { void controller.install(); }}><Icon name="download" />安装健力宝</button>}
        {state.installing && <p role="status">请在系统窗口中完成选择…</p>}
        {state.message && <p role="status">{state.message}</p>}
        <details className="install-guide" open={!state.installed}>
          <summary>查看安装步骤</summary>
          <div className="install-platforms" role="group" aria-label="选择安装设备">
            <button className="btn btn-secondary" aria-pressed={choice === 'ios'} onClick={() => setChoice('ios')}>iPhone / iPad</button>
            <button className="btn btn-secondary" aria-pressed={choice === 'android'} onClick={() => setChoice('android')}>安卓手机</button>
          </div>
          {choice === 'ios' ? <ol className="install-steps">
            <li>用 Safari 打开当前健力宝网址。</li>
            <li>点“分享”，选择“添加到主屏幕”；若有“作为 Web App 打开”，请保持开启。</li>
            <li>点“添加”，回到桌面打开“健力宝”。</li>
          </ol> : <ol className="install-steps">
            <li>用 Chrome 打开当前健力宝网址。</li>
            <li>点浏览器菜单，选择“安装应用”或“添加到主屏幕”。不同浏览器名称可能不同。</li>
            <li>按系统提示添加，再从桌面打开“健力宝”。</li>
          </ol>}
          <p className="muted install-caption">没有安装选项时，可先更新浏览器或继续在网页使用。此入口安装的是网页版，无需 Apple 账号、描述文件或定期续签。</p>
        </details>
      </>}
      <p className="muted install-caption">首次打开请联网。训练记录可离线保存；图解请在“动作”的离线图解准备中保存，视频在对应动作讲解中单独保存；云同步需联网。</p>
      <p className="muted install-caption">网页与桌面窗口的存储可能独立。添加前先导出备份，打开后核对记录，必要时导入备份或连接原同步密钥；不要清除原站点数据。</p>
    </section>
  );
}
