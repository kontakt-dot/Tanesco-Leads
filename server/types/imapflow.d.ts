declare module "imapflow" {
  export type FetchMessage = { uid: number; envelope?: { messageId?: string; subject?: string; date?: Date; from?: Array<{ name?: string; address?: string }> }; source?: Buffer };
  export class ImapFlow {
    constructor(options: { host: string; port: number; secure: boolean; auth: { user: string; pass: string }; logger?: boolean | object });
    connect(): Promise<void>;
    logout(): Promise<void>;
    getMailboxLock(path: string): Promise<{ release: () => void }>;
    fetch(range: { since?: Date } | string, query: { envelope?: boolean; uid?: boolean; source?: boolean | { maxLength?: number } }): AsyncIterable<FetchMessage>;
  }
}
