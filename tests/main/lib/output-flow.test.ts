import { describe, expect, it, vi } from 'vitest';
import { OutputFlow } from '../../../src/main/lib/output-flow';

describe('OutputFlow', () => {
  it('pauses above the high-water mark and resumes below the low one', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const flow = new OutputFlow(pause, resume, 100, 20);

    flow.sent(60);
    flow.sent(60);
    expect(pause).toHaveBeenCalledTimes(1);
    flow.sent(60);
    expect(pause).toHaveBeenCalledTimes(1);

    flow.acked(100); // 80 outstanding: still above low
    expect(resume).not.toHaveBeenCalled();
    flow.acked(70); // 10 outstanding
    expect(resume).toHaveBeenCalledTimes(1);
    expect(flow.isPaused).toBe(false);
  });

  it('reset() releases a source paused on output nobody will acknowledge', () => {
    const resume = vi.fn();
    const flow = new OutputFlow(vi.fn(), resume, 10, 5);
    flow.sent(50);
    flow.reset();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('never goes negative on over-acknowledgement', () => {
    const pause = vi.fn();
    const flow = new OutputFlow(pause, vi.fn(), 10, 5);
    flow.acked(1000);
    flow.sent(8);
    expect(pause).not.toHaveBeenCalled();
  });
});
