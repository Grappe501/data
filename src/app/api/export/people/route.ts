import { requireAdminApi } from "@/lib/auth";
import { loadPeopleForExport, peopleToCsv } from "@/lib/contact-intel/working-set";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const fd = await req.formData();
  const ids = fd.getAll("personId").map((v) => String(v));
  const people = await loadPeopleForExport(ids);
  if (people.length === 0) return new Response("Select at least one person.", { status: 400 });
  const csv = peopleToCsv(people);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contact-intel-set-${stamp}.csv"`,
    },
  });
}
