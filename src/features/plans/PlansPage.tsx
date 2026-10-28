import type { AppData, WorkoutTemplate } from '../../domain/types';
import { uid } from '../../domain/training';
import Icon from '../../components/Icon';
import { useRef } from 'react';
import { useListMotion } from '../../motion/presentation';
type Props = {
  data: AppData;
  templates: WorkoutTemplate[];
  showArchived: boolean;
  writable: boolean;
  mutate: (fn: (data: AppData) => AppData) => Promise<boolean>;
  openStart: (template: WorkoutTemplate | 'free') => void;
  setTemplateEditor: (template: WorkoutTemplate | 'new') => void;
  setArchiveTemplate: (template: WorkoutTemplate) => void;
  setShowArchived: (show: boolean) => void;
};
export default function PlansPage({
  data,
  templates,
  showArchived,
  writable,
  mutate,
  openStart,
  setTemplateEditor,
  setArchiveTemplate,
  setShowArchived,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useListMotion(
    ref,
    JSON.stringify([showArchived, templates.map((template) => template.id)]),
    ':scope > .template-card',
  );
  const templateCards = (
    <div className="template-grid" ref={ref}>
      {(showArchived ? data.templates : templates).map((t) => (
        <section className="card template-card" key={t.id}>
          <div>
            <h2 className="truncate" title={t.name}>{t.name}</h2>
            <p className="muted wrap-cjk">{t.description}</p>
            <div className="template-meta">
              <span>{t.items.length} 个动作</span>
              <span>{t.items.reduce((n, item) => n + item.sets, 0)} 组</span>
              <span>休息 {t.restSeconds} 秒</span>
            </div>
          </div>
          {t.archived ? (
            <button
              className="btn btn-secondary"
              disabled={!writable}
              onClick={() =>
                void mutate((d) => ({
                  ...d,
                  templates: d.templates.map((x) =>
                    x.id === t.id ? { ...x, archived: false, updatedAt: new Date().toISOString() } : x,
                  ),
                }))
              }
            >
              恢复模板
            </button>
          ) : (
            <>
              <button className="btn btn-primary" disabled={!writable} onClick={() => openStart(t)}>
                <span className="truncate">选择 {t.name}</span>
                <Icon name="arrow" size={16} />
              </button>
              <div className="row template-actions">
                <button className="btn btn-ghost" disabled={!writable} onClick={() => setTemplateEditor(t)}>
                  <Icon name="edit" size={16} />
                  编辑
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!writable}
                  onClick={() =>
                    void mutate((d) => ({
                      ...d,
                      templates: [
                        ...d.templates,
                        {
                          ...structuredClone(t),
                          id: uid(),
                          name: `${t.name.slice(0, 110)}（副本）`,
                          updatedAt: new Date().toISOString(),
                        },
                      ],
                    }))
                  }
                >
                  <Icon name="copy" size={16} />
                  复制
                </button>
                <button
                  className="icon-button danger-text"
                  disabled={!writable}
                  aria-label={`归档模板${t.name}`}
                  onClick={() => setArchiveTemplate(t)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>训练日模板</h2>
          <p className="muted">安排是目标，记录是实际。模板修改不会改变过去的训练。</p>
        </div>
        <button className="btn btn-primary" disabled={!writable} onClick={() => setTemplateEditor('new')}>
          <Icon name="plus" />
          新建模板
        </button>
      </div>
      {templateCards}
      <div className="row wrap section-spacer">
        <button className="btn btn-secondary" disabled={!writable} onClick={() => openStart('free')}>
          直接开始自由训练
        </button>
        <button className="btn btn-ghost" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? '隐藏已归档模板' : '查看已归档模板'}
        </button>
      </div>
      {!templates.length && !showArchived && (
        <div className="card empty-state">
          <h2>安排下一场训练。</h2>
          <p>创建模板，或直接开始自由训练。</p>
        </div>
      )}
    </>
  );
}
