import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { alertEvents, alertRules, companies } from "@/lib/db/schema";
import { sql, desc, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const acknowledged = searchParams.get("acknowledged");

  const db = getDb();

  const conditions = [];
  if (acknowledged === "false") {
    conditions.push(sql`${alertEvents.acknowledged} = 0`);
  }

  const results = db
    .select({
      id: alertEvents.id,
      ruleId: alertEvents.ruleId,
      ruleName: alertRules.name,
      ruleType: alertRules.ruleType,
      companyId: alertEvents.companyId,
      companyName: companies.name,
      companyDomain: companies.domain,
      userId: alertEvents.userId,
      title: alertEvents.title,
      detail: alertEvents.detail,
      slackSent: alertEvents.slackSent,
      acknowledged: alertEvents.acknowledged,
      firedAt: alertEvents.firedAt,
    })
    .from(alertEvents)
    .innerJoin(alertRules, sql`${alertEvents.ruleId} = ${alertRules.id}`)
    .leftJoin(companies, sql`${alertEvents.companyId} = ${companies.id}`)
    .where(conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined)
    .orderBy(desc(alertEvents.firedAt))
    .limit(100)
    .all();

  return NextResponse.json(results);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const db = getDb();

  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  db.update(alertEvents)
    .set({ acknowledged: body.acknowledged ?? 1 })
    .where(eq(alertEvents.id, body.id))
    .run();

  return NextResponse.json({ success: true });
}
