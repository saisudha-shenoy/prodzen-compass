import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, title, client, document_type, author, date_created, topic_category, storage_path")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: `Failed to fetch documents: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json(data);
}
