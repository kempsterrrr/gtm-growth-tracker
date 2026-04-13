import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { alertRules } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const db = getDb();
  const rules = db.select().from(alertRules).all();
  return NextResponse.json(rules);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const db = getDb();

  const result = db
    .insert(alertRules)
    .values({
      name: body.name,
      description: body.description || null,
      ruleType: body.ruleType,
      config: JSON.stringify(body.config),
      enabled: body.enabled ?? 1,
      notifySlack: body.notifySlack ?? 1,
    })
    .returning()
    .get();

  return NextResponse.json(result, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const db = getDb();

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  db.update(alertRules)
    .set({
      name: body.name,
      description: body.description,
      ruleType: body.ruleType,
      config: body.config ? JSON.stringify(body.config) : undefined,
      enabled: body.enabled,
      notifySlack: body.notifySlack,
    })
    .where(eq(alertRules.id, body.id))
    .run();

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getDb();
  db.delete(alertRules).where(eq(alertRules.id, parseInt(id))).run();
  return NextResponse.json({ success: true });
}
