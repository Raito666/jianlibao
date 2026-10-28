import { createPortal } from 'react-dom';
import { useIosInput } from '../platform/useIosInput';

export default function IosInputAccessory() {
  const { state, move, dismiss } = useIosInput();
  if (!state) return null;
  const accessory = (
    <div
      className={`ios-input-accessory${state.host ? ' ios-input-accessory-modal' : ''}`}
      data-ios-input-accessory=""
      role="group"
      aria-label="输入辅助"
      onPointerDown={event => {
        // Keep the input and its keyboard active until the selected action runs.
        if (event.button === 0) event.preventDefault();
      }}
    >
      <span className="ios-input-label truncate" title={state.label}>{state.label}</span>
      <button type="button" disabled={!state.previous} onClick={() => move(-1)}>上一项</button>
      <button type="button" disabled={!state.next} onClick={() => move(1)}>下一项</button>
      <button type="button" className="ios-input-dismiss" onClick={dismiss}>收起键盘</button>
    </div>
  );
  // Native modal dialogs make content outside their top layer inert.
  return state.host ? createPortal(accessory, state.host) : accessory;
}
