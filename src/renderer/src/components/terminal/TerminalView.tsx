import { connectToHost } from '@/lib/ssh';
import { TerminalViewContainer } from './TerminalViewContainer';

export { connectToHost };

export function TerminalView() {
  return <TerminalViewContainer type="ssh" />;
}
