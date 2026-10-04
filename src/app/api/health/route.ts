export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const required = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    aiKey: Boolean(
      process.env.TENSORRA_MODEL_API_KEY ??
      process.env.GROQ_API_KEY ??
      process.env.AI_API_KEY
    ),
  };

  const ready = Object.values(required).every(Boolean);

  return Response.json(
    {
      service: "TENSORRA",
      version: "0.13.0",
      status: ready ? "ready" : "configuration_required",
      checks: required,
      features: {
        responsiveUI: true,
        adaptiveComposer: true,
        smartRouter: true,
        scoredAutoRouter: true,
        providerRetryFallback: true,
        promptInjectionHardening: true,
        chatManagement: true,
        autonomousWeb: true,
        autonomousCode: true,
        vision: true,
        chatAttachments: true,
        privateRag: true,
        memory: true,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
