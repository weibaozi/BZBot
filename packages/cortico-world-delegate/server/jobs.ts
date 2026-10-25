import { createRequire } from 'node:module';
import type { DatabaseSync as Database } from 'node:sqlite';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface Job {
  id: number; status: JobStatus; user: string; requestCursor: number; task: string; workspace: string;
  createdAt: string; endedAt: string | null; result: string; notified: number;
}
export class Jobs {
  private readonly db: Database;
  constructor(path: string) {
    mkdirSync(dirname(path), {recursive:true}); this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, user TEXT NOT NULL, requestCursor INTEGER NOT NULL UNIQUE,
      task TEXT NOT NULL, workspace TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, endedAt TEXT, result TEXT NOT NULL DEFAULT '', notified INTEGER NOT NULL DEFAULT 0
    )`);
  }
  list(): Job[] { return this.db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 100').all() as unknown as Job[]; }
  get(id: number): Job | undefined { return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as unknown as Job | undefined; }
  request(cursor: number): Job | undefined { return this.db.prepare('SELECT * FROM jobs WHERE requestCursor=?').get(cursor) as unknown as Job | undefined; }
  pending(): Job[] { return this.db.prepare("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY id").all() as unknown as Job[]; }
  unnotified(): Job[] { return this.db.prepare("SELECT * FROM jobs WHERE notified=0 AND status NOT IN ('queued','running') ORDER BY id").all() as unknown as Job[]; }
  add(user: string, cursor: number, task: string): Job {
    const result=this.db.prepare("INSERT INTO jobs(status,user,requestCursor,task,createdAt) VALUES ('queued',?,?,?,?)").run(user,cursor,task,new Date().toISOString());
    return this.get(Number(result.lastInsertRowid))!;
  }
  running(id: number, workspace: string) { this.db.prepare("UPDATE jobs SET status='running',workspace=? WHERE id=?").run(workspace,id); }
  finish(id: number, status: JobStatus, result: string) { this.db.prepare('UPDATE jobs SET status=?,result=?,endedAt=? WHERE id=?').run(status,result,new Date().toISOString(),id); }
  notified(id: number) { this.db.prepare('UPDATE jobs SET notified=1 WHERE id=?').run(id); }
  recover() { for(const job of this.pending()) this.finish(job.id,'interrupted','Bot restarted before this task completed. The task was not automatically rerun.'); }
  close() { this.db.close(); }
}
