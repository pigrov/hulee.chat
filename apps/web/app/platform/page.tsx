import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function PlatformAdminIndexPage(): never {
  redirect("/platform/companies");
}
