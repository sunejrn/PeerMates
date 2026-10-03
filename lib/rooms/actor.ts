import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

type LooseBody = Record<string, unknown> | null | undefined;

function bodyField(body: LooseBody, key: string): unknown {
  if (body && typeof body === "object") return (body as Record<string, unknown>)[key];
  return undefined;
}

/** Authenticated user id, or a client-supplied guest id fallback. */
export async function resolveActorId(
  req: NextRequest,
  body?: LooseBody
): Promise<{ actorId: string; authenticated: boolean }> {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session?.user?.id) {
      return { actorId: session.user.id, authenticated: true };
    }
  } catch {
    // fall through to body fallback
  }
  const fallback =
    bodyField(body, "actorId") ??
    bodyField(body, "userId") ??
    bodyField(body, "id") ??
    bodyField(body, "newHostId");
  const nested = bodyField(body, "user");
  const nestedId =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>).id
      : undefined;
  const id = typeof fallback === "string" ? fallback : nestedId;
  return {
    actorId: typeof id === "string" ? id : "",
    authenticated: false,
  };
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function rateLimited(retryAfter: number) {
  return NextResponse.json(
    { error: "RATE_LIMITED", message: `Slow down. Try again in ${retryAfter}s.`, retryAfter },
    { status: 429 }
  );
}

/** Extract a safe message from an unknown catch value. */
export function errMessage(error: unknown, fallback = "Internal server error") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
