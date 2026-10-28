import { formatClock } from './clock';
import type { Update } from './types';
import type { useRestReminder } from './useRestReminder';
export default function RestPanel({
  rest,
  disabled,
  update,
  reminder,
  collapsed,
  setCollapsed,
  nextGroup,
}: {
  rest: number;
  disabled: boolean;
  update: Update;
  reminder: ReturnType<typeof useRestReminder>;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  nextGroup: string;
}) {
  return (
    <section className={`card rest-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label="组间休息">
      <div className="rest-heading">
        <div>
          <h3>组间休息</h3>
          <div className="rest-time" aria-live="off">
            {formatClock(rest)}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost rest-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开休息面板' : '收起休息面板'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>
      <div className="rest-content">
        <p className="muted">{rest ? '呼吸放缓，准备下一组。' : '按自己的状态开始下一组。'}</p>
        <p className="rest-next wrap-cjk">下一组：{nextGroup}</p>
        <div className="row">
          <button
            className="btn btn-secondary"
            disabled={disabled}
            onClick={() => void update((s) => ({ ...s, restUntil: Math.max(Date.now(), s.restUntil ?? 0) + 30000 }))}
          >
            +30 秒
          </button>
          <button
            className="btn btn-ghost"
            disabled={disabled || !rest}
            onClick={() => void update((s) => ({ ...s, restUntil: null }))}
          >
            跳过休息
          </button>
        </div>
        <details className="rest-options">
          <summary>休息提醒设置</summary>
          <div className="rest-alert-toggles">
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="声音提醒"
              aria-pressed={reminder.sound}
              data-haptic="selection"
              onClick={() => reminder.setSound(!reminder.sound)}
            >
              声音{reminder.sound ? '开' : '关'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="震动提醒"
              aria-pressed={reminder.vibration}
              data-haptic="selection"
              onClick={() => reminder.setVibration(!reminder.vibration)}
            >
              震动{reminder.vibration ? '开' : '关'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={reminder.testAlert}>
              测试提醒
            </button>
          </div>
          <div className="rest-alert-toggles">
            <button type="button" className="btn btn-secondary" aria-label="训练时保持亮屏"
              aria-pressed={reminder.keepAwake} data-haptic="selection" disabled={disabled}
              onClick={() => reminder.setKeepAwake(!reminder.keepAwake)}>
              训练常亮{reminder.keepAwake ? '开' : '关'}
            </button>
            {reminder.native && <button type="button" className="btn btn-secondary"
              disabled={disabled || reminder.notificationBusy} aria-pressed={reminder.notificationState === 'granted'}
              onClick={() => void reminder.setBackgroundReminder(reminder.notificationState !== 'granted')}>
              {reminder.notificationBusy ? '正在检查通知…' : reminder.notificationState === 'granted' ? '关闭后台提醒' : '启用后台提醒'}
            </button>}
          </div>
          {reminder.keepAwake && <p className="muted" role="status">
            {reminder.wakeState === 'on' ? '训练前台亮屏中，暂停或离开应用会释放。' : reminder.wakeState === 'unavailable' ? '当前环境未能保持亮屏，可检查系统自动锁屏设置。' : '回到训练前台后尝试保持亮屏。'}
          </p>}
          {reminder.native && <p className="muted" role="status">
            {reminder.notificationState === 'denied' ? '通知未授权，返回前台仍可查看剩余休息。' : reminder.notificationState === 'error' ? '后台提醒暂不可用，前台计时与记录不受影响。' : reminder.notificationState === 'granted' ? '已授权后台提醒；跳过、暂停和结束会取消排期。' : reminder.notificationState === 'off' ? '后台提醒已关闭，前台提醒仍按开关执行。' : '开启后台提醒后，锁屏时由系统到点通知。'}
          </p>}
          <p className="muted">
            提醒开关仅本次使用有效。{reminder.vibrationSupported ? '震动效果取决于设备。' : '当前浏览器不支持震动。'}
            {reminder.native ? '后台通知的声音和震动受系统设置控制；如需完全静音，请关闭后台提醒。' : ''}
            {reminder.sound && !reminder.audioReady ? '点击测试以启用声音。' : ''}
          </p>
        </details>
      </div>
    </section>
  );
}
