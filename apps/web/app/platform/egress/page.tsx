import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function PlatformEgressPage(): never {
  redirect("/platform/deployments?section=egress");
}
