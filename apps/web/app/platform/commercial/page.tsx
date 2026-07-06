import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function PlatformCommercialPage(): never {
  redirect("/platform/deployments?section=commercial");
}
