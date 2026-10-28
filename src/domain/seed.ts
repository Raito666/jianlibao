import type { AppData, Exercise, WorkoutTemplate } from './types';
import { expandCatalog } from '../content/catalog';

export function createInitialData(): AppData {
  const exercises: Exercise[] = [
    { id: 'ex-squat', name: '杠铃深蹲', muscle: '腿部', equipment: '杠铃', kind: 'weight-reps', description: '记录杠铃和杠铃片的总重量。以自己能控制的幅度完成，动作不适时停止。' },
    { id: 'ex-bench', name: '杠铃卧推', muscle: '胸部', equipment: '杠铃', kind: 'weight-reps', description: '记录包含杠的总重量。使用合适的保护装置，保持稳定后再完成每次动作。' },
    { id: 'ex-row', name: '杠铃划船', muscle: '背部', equipment: '杠铃', kind: 'weight-reps', description: '记录包含杠的总重量。保持躯干稳定，在可控制的幅度内完成。' },
    { id: 'ex-press', name: '哑铃推举', muscle: '肩部', equipment: '哑铃', kind: 'weight-reps', description: '双手同时训练时填写两只哑铃的总重量；程序不会额外乘二。' },
    { id: 'ex-rdl', name: '罗马尼亚硬拉', muscle: '腿部', equipment: '杠铃', kind: 'weight-reps', description: '记录包含杠的总重量。以髋部活动为主，选择能稳定控制的重量与幅度。' },
    { id: 'ex-lat', name: '高位下拉', muscle: '背部', equipment: '器械', kind: 'weight-reps', description: '记录当前器械标示的配重；不同器械的读数不宜直接比较。' },
    { id: 'ex-curl', name: '哑铃弯举', muscle: '手臂', equipment: '哑铃', kind: 'weight-reps', description: '双手同时训练记录两只总重；单侧训练左右各记一组，填写当侧重量与次数。' },
    { id: 'ex-lunge', name: '哑铃弓步蹲', muscle: '腿部', equipment: '哑铃', kind: 'weight-reps', description: '单侧动作左右各记录一组，每组填写实际外部总负重和当侧次数。' },
    { id: 'ex-pushup', name: '俯卧撑', muscle: '胸部', equipment: '自重', kind: 'reps', description: '只记录完成次数，不按体重换算重量容量。可选择适合自己的支撑方式。' },
    { id: 'ex-pullup', name: '引体向上', muscle: '背部', equipment: '自重', kind: 'reps', description: '只记录完成次数，不用体重或辅助配重推算有效负重。辅助版本建议另建动作。' },
    { id: 'ex-plank', name: '平板支撑', muscle: '核心', equipment: '自重', kind: 'duration', description: '记录持续秒数，保持可控制的姿势与正常呼吸；不将秒数计入重量容量。' },
    { id: 'ex-crunch', name: '卷腹', muscle: '核心', equipment: '自重', kind: 'reps', description: '只记录完成次数，以可控制的幅度进行；不将体重计入重量容量。' },
  ];
  const definitions = [
    { id: 'template-full', name: '全身基础', description: '原创基础模板 · 三类记录均可体验；组数、负重由你调整。', ids: ['ex-squat', 'ex-bench', 'ex-row', 'ex-plank'] },
    { id: 'template-upper', name: '上肢训练', description: '原创基础模板 · 推、拉与手臂，按实际能力填写重量。', ids: ['ex-bench', 'ex-lat', 'ex-press', 'ex-curl'] },
    { id: 'template-lower', name: '下肢与核心', description: '原创基础模板 · 下肢动作搭配核心训练。', ids: ['ex-squat', 'ex-rdl', 'ex-lunge', 'ex-crunch'] },
  ];
  const templates: WorkoutTemplate[] = definitions.map(({ id, name, description, ids }) => ({
    id, name, description, restSeconds: 90, updatedAt: '2026-10-15T00:00:00.000Z',
    items: ids.map((exerciseId, index) => ({ id: `${id}-item-${index + 1}`, exerciseId, sets: 3, weightKg: 0, reps: 10, durationSeconds: 30 })),
  }));
  return expandCatalog({ schemaVersion: 2, revision: 0, exercises, templates, sessions: [], bodyMetrics: [], settings: { unit: 'kg', theme: 'dark', defaultRest: 90, autoRest: true, showRpe: false, lastExportAt: null }, onboarded: false });
}
