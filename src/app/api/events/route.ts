import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const category = searchParams.get("category");
  const repoId = searchParams.get("repoId");
  const packageId = searchParams.get("packageId");

  const db = getDb();

  const conditions = [];
  if (startDate) conditions.push(gte(events.date, startDate));
  if (endDate) conditions.push(lte(events.date, endDate));
  if (category) conditions.push(eq(events.category, category as typeof events.category.enumValues[number]));
  if (repoId) conditions.push(eq(events.repoId, parseInt(repoId)));
  if (packageId) conditions.push(eq(events.packageId, parseInt(packageId)));

  const result = db
    .select()
    .from(events)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(events.date))
    .all();

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const db = getDb();

  const result = db
    .insert(events)
    .values({
      date: body.date,
      title: body.title,
      description: body.description || null,
      category: body.category,
      source: "manual",
      repoId: body.repoId || null,
      packageId: body.packageId || null,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    })
    .returning()
    .get();

  return NextResponse.json(result, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const db = getDb();

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  db.update(events)
    .set({
      date: body.date,
      title: body.title,
      description: body.description,
      category: body.category,
      repoId: body.repoId,
      packageId: body.packageId,
      metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
    })
    .where(eq(events.id, body.id))
    .run();

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getDb();

  // Only allow deleting manual events
  const event = db
    .select()
    .from(events)
    .where(eq(events.id, parseInt(id)))
    .get();

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (event.source === "auto") {
    return NextResponse.json(
      { error: "Cannot delete auto-generated events" },
      { status: 403 }
    );
  }

  db.delete(events).where(eq(events.id, parseInt(id))).run();
  return NextResponse.json({ success: true });
}
