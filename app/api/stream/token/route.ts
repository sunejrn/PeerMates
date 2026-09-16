import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createStreamUserToken, isStreamConfigured } from "@/lib/stream/server";

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required to generate real-time token." },
        { status: 401 }
      );
    }

    const { id: userId, name, image } = session.user;
    const token = await createStreamUserToken(userId, name, image || undefined);

    const apiKey =
      process.env.NEXT_PUBLIC_STREAM_API_KEY || process.env.STREAM_API_KEY || "";

    return NextResponse.json({
      success: true,
      token,
      apiKey,
      isLiveStream: isStreamConfigured,
      user: {
        id: userId,
        name,
        image,
      },
    });
  } catch (error: any) {
    console.error("Stream token error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
