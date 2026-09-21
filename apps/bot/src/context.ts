import { randomBytes } from 'node:crypto';

/** Per-run context handed to every tool (never sent to the model). */
export type BotContext = {
  chatId: number;
  /** Active catalog / app name for this chat. */
  app: string;
  proposals: ProposalStore;
};

export type RemoteConfigProposal = {
  id: string;
  chatId: number;
  key: string;
  oldValue: string | null;
  newValue: string;
  reason: string;
  etag: string;
  createdAt: number;
  announced: boolean;
};

const PROPOSAL_TTL_MS = 10 * 60_000;

/**
 * Remote Config changes are never applied by the model. The agent files a
 * proposal; the human confirms it with a Telegram button; only then is it PUT.
 */
export class ProposalStore {
  private readonly items = new Map<string, RemoteConfigProposal>();

  put(input: Omit<RemoteConfigProposal, 'id' | 'createdAt' | 'announced'>): RemoteConfigProposal {
    this.sweep();
    const proposal: RemoteConfigProposal = { ...input, id: randomBytes(5).toString('hex'), createdAt: Date.now(), announced: false };
    this.items.set(proposal.id, proposal);
    return proposal;
  }

  take(id: string): RemoteConfigProposal | undefined {
    this.sweep();
    const p = this.items.get(id);
    if (p) this.items.delete(id);
    return p;
  }

  /** Proposals for a chat that have not been shown to the user yet. */
  unannounced(chatId: number): RemoteConfigProposal[] {
    this.sweep();
    const out = [...this.items.values()].filter((p) => p.chatId === chatId && !p.announced);
    for (const p of out) p.announced = true;
    return out;
  }

  private sweep(): void {
    const cutoff = Date.now() - PROPOSAL_TTL_MS;
    for (const [id, p] of this.items) if (p.createdAt < cutoff) this.items.delete(id);
  }
}
