import type { Exercise } from '../domain/types';
import { catalogEntries } from './catalog';

export const muscleGroups = [
  { id:'chest', label:'胸部', detail:'胸大肌', side:'front', hint:'推起与夹合上臂，先稳住肩背。' },
  { id:'delts', label:'肩部', detail:'三角肌前束与中束', side:'front', hint:'推举、前平举与侧平举，控制抬臂幅度。' },
  { id:'biceps', label:'肱二头肌', detail:'上臂前侧', side:'front', hint:'屈肘拉起，保持上臂稳定。' },
  { id:'forearms', label:'前臂', detail:'前臂与握持肌群', side:'both', hint:'握持与腕部控制，避免甩动负重。' },
  { id:'abs', label:'腹部', detail:'腹部核心', side:'front', hint:'控制躯干与骨盆，用稳定的呼吸保持支撑。' },
  { id:'obliques', label:'侧腹', detail:'侧腹与抗旋转核心', side:'front', hint:'控制侧向支撑和旋转，避免用腰部猛甩。' },
  { id:'quads', label:'大腿前侧', detail:'股四头肌', side:'front', hint:'屈伸膝关节，膝盖沿脚尖方向移动。' },
  { id:'adductors', label:'大腿内侧', detail:'内收肌群', side:'front', hint:'向内收腿与侧向支撑，使用可控活动范围。' },
  { id:'calves', label:'小腿', detail:'小腿肌群', side:'both', hint:'脚踝跖屈与提踵，避免靠弹跳完成。' },
  { id:'upperback', label:'上背', detail:'斜方肌与上背肌群', side:'back', hint:'控制肩胛移动，保持颈部自然。' },
  { id:'reardelts', label:'肩后侧', detail:'三角肌后束', side:'back', hint:'向后打开上臂，控制重量，避免耸肩。' },
  { id:'triceps', label:'肱三头肌', detail:'上臂后侧', side:'back', hint:'伸直肘部，避免用躯干摆动借力。' },
  { id:'lats', label:'背阔肌', detail:'背部两侧', side:'back', hint:'向下或向后拉动上臂，保持躯干稳定。' },
  { id:'lowerback', label:'下背', detail:'竖脊肌', side:'back', hint:'控制髋部与躯干位置，不追求过度后仰。' },
  { id:'glutes', label:'臀部', detail:'臀部肌群', side:'back', hint:'髋部伸展与外展，避免用腰部代偿。' },
  { id:'hamstrings', label:'大腿后侧', detail:'腘绳肌', side:'back', hint:'髋部折叠与屈膝，下降阶段保持控制。' },
] as const;
export type MuscleId = typeof muscleGroups[number]['id'];
export type BodySide = 'front' | 'back';
const entries = new Map(catalogEntries.map(entry => [entry.id, entry]));

function namedMuscles(name: string): MuscleId[] {
  const exact = muscleGroups.find(group => group.label === name);
  if (exact) return [exact.id];
  const result: MuscleId[] = [];
  if (/胸/.test(name)) result.push('chest');
  if (/三角肌后|肩后/.test(name)) result.push('reardelts');
  else if (/三角肌|肩/.test(name)) result.push('delts');
  if (/肱二头/.test(name)) result.push('biceps');
  if (/肱三头/.test(name)) result.push('triceps');
  if (/前臂|握持/.test(name)) result.push('forearms');
  if (/腹|核心/.test(name)) result.push('abs');
  if (/上背|斜方/.test(name)) result.push('upperback');
  if (/背阔/.test(name)) result.push('lats');
  if (name === '背部肌群' || name === '背部') result.push('lats', 'upperback');
  if (/竖脊|下背/.test(name)) result.push('lowerback');
  if (/臀/.test(name)) result.push('glutes');
  if (/股四头|下肢|腿部/.test(name)) result.push('quads');
  if (/腘绳|后侧链/.test(name)) result.push('hamstrings');
  if (/后侧链/.test(name)) result.push('glutes');
  if (/内收|腹股沟/.test(name)) result.push('adductors');
  if (/小腿/.test(name)) result.push('calves');
  return [...new Set(result)];
}

/** Browse metadata only: never rewrites user exercises or historical training snapshots. */
export function exerciseMuscles(exercise: Exercise): { primary: MuscleId[]; secondary: MuscleId[] } {
  const entry = entries.get(exercise.id);
  // Only exact canonical names or explicit anatomical aliases can classify a custom exercise.
  // Substring matching could turn “胸部/背部” into chest when only one fragment is recognized.
  let primary: MuscleId[] = entry
    ? namedMuscles(entry.primary)
    : muscleGroups.filter(group => group.label === exercise.muscle || group.detail === exercise.muscle).map(group => group.id);
  const secondary = entry ? entry.secondary.flatMap(namedMuscles) : [];
  if (entry) {
    if (entry.profile === 'twist' || entry.profile === 'antirotation' || /side-plank|copenhagen/.test(entry.slug)) primary = ['obliques', 'abs'];
    if (entry.slug === 'butterfly-stretch') primary = ['adductors'];
    if (entry.slug === 'cat-cow-stretch' || entry.slug === 'torso-twist-stretch') primary = ['abs', 'lowerback'];
    if (/leg-swings|hip-flexor/.test(entry.slug)) primary = ['quads', 'glutes'];
    if (entry.slug === 'worlds-greatest-stretch') primary = ['glutes', 'hamstrings'];
    if (entry.profile === 'facepull') secondary.push('reardelts');
    if (entry.profile === 'row') secondary.push('lats');
  }
  return {primary:[...new Set(primary)], secondary:[...new Set(secondary)].filter(id => !primary.includes(id))};
}

/** One primary group per completed set; secondary participation is only a browse filter. */
export function primaryMuscle(exercise: Exercise): MuscleId | undefined {
  return exerciseMuscles(exercise).primary[0];
}

/** Legacy ambiguous labels remain readable without inventing a muscle or mutating snapshots. */
export function muscleLabel(exercise: Exercise): string {
  const id = primaryMuscle(exercise);
  return id ? targetLabel(id) : `${exercise.muscle} · 未细分`;
}

export const jointGroups = [
  {id:'shoulders',label:'肩关节',hint:'上臂推、拉、抬举与外展相关动作。',profiles:['press','fly','pushup','overhead','raise','rear','facepull','row','pulldown','pullup','dip','handstand','hang']},
  {id:'elbows',label:'肘关节',hint:'屈肘与伸肘相关动作。',profiles:['curl','triceps','press','pushup','overhead','row','pulldown','pullup','dip','handstand']},
  {id:'wrists',label:'腕关节',hint:'以腕部屈伸为主的动作。',profiles:['wrist']},
  {id:'hips',label:'髋关节',hint:'屈伸髋、外展和内收相关动作。',profiles:['squat','lunge','deadlift','hinge','bridge','abduction','adduction','kickback','swing','extension']},
  {id:'knees',label:'膝关节',hint:'屈膝与伸膝相关动作。',profiles:['squat','lunge','legpress','legextension','legcurl','deadlift']},
  {id:'ankles',label:'踝关节',hint:'以提踵为主的脚踝活动。',profiles:['calf']},
] as const;
export type JointId = typeof jointGroups[number]['id'];
export type BodyTarget = MuscleId | JointId;
export function targetLabel(id: BodyTarget) { return [...muscleGroups,...jointGroups].find(group => group.id === id)!.label; }
export function matchesBodyTarget(exercise: Exercise, target: BodyTarget, includeSecondary = false) {
  const joint = jointGroups.find(group => group.id === target);
  if (joint) { const profile = entries.get(exercise.id)?.profile; return !!profile && (joint.profiles as readonly string[]).includes(profile); }
  const muscles = exerciseMuscles(exercise);
  return muscles.primary.includes(target as MuscleId) || includeSecondary && muscles.secondary.includes(target as MuscleId);
}
