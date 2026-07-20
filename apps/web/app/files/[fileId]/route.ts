export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return new Response(null, {
    status: 410,
    headers: {
      "cache-control": "no-store",
      "x-hulee-inbox-runtime": "clean-slate-detached"
    }
  });
}
