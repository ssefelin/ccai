import { randomUUID } from 'node:crypto';
import type { ApprovalProposal } from '../shared/api.ts';

type Entry = { finish: (approved: boolean) => void };
export class ApprovalManager {
  private pending = new Map<string, Entry>();
  async request(proposal: Omit<ApprovalProposal, 'id'>, publish: (value: ApprovalProposal) => void, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || this.pending.size >= 20) return false;
    const id = randomUUID();
    return new Promise(resolve => {
      const finish = (approved: boolean) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        resolve(approved);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, 120000);
      this.pending.set(id, { finish });
      signal.addEventListener('abort', cancel, { once: true });
      try { publish({ ...proposal, id }); } catch { finish(false); }
    });
  }
  decide(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.finish(approved);
    return true;
  }
}
export const approvals = new ApprovalManager();
