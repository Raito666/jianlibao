import Presence, { useExiting } from '../motion/Presence';

function Message({ message }: { message: string }) {
  const exiting = useExiting();
  return (
    <div
      className="toast wrap-cjk"
      data-motion-state={exiting ? 'exiting' : 'visible'}
      role="status"
      aria-live="polite"
      aria-hidden={exiting || undefined}
    >
      {message}
    </div>
  );
}
export default function Toast({ message }: { message: string }) {
  return <Presence duration={100}>{message ? <Message message={message} /> : null}</Presence>;
}
