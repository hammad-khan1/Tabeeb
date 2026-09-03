import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb } from '@/lib/db';
import { documents } from '@/lib/db/schema';
const rows = await getDb().select({ id: documents.id, title: documents.title, status: documents.extractionStatus, summary: documents.summary }).from(documents).limit(10);
console.log(rows.map(r => `${r.id.slice(0,8)} | ${r.status} | summary=${r.summary ? r.summary.slice(0,40)+'...' : 'null'} | ${r.title}`).join('\n') || '(no documents)');
process.exit(0);
