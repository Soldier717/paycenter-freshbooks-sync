import { store } from "@/lib/deps";
import { denied, isAdmin } from "@/lib/guard";

export const dynamic = "force-dynamic";

// What needs a person's attention, plus recent activity.
export async function GET(req: Request) {
  if (!isAdmin(req)) return denied();
  const s = store();
  return Response.json({ needsAttention: await s.listAttention(), recent: await s.recentLog(50) });
}
