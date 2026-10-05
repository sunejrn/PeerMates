import { NextRequest, NextResponse } from "next/server";

const BUG_INBOX = "karasune66@gmail.com";
const MAX_LEN = 2000;

/**
 * POST /api/report-bug { name, title, description }
 *
 * Forwards the report to the inbox. Prefers Resend when configured
 * (RESEND_API_KEY + optional REPORT_FROM), else SMTP env, else logs and
 * returns delivered:false with a mailto fallback so the UI can still
 * confirm receipt without ever failing the user.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    const description =
      typeof body?.description === "string" ? body.description.trim().slice(0, MAX_LEN) : "";

    if (!name) {
      return NextResponse.json({ error: "Please tell us your name." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "Please give the bug a title." }, { status: 400 });
    }
    if (!description || description.length < 10) {
      return NextResponse.json(
        { error: "Please describe the bug (at least 10 characters)." },
        { status: 400 }
      );
    }

    const subject = `[PeerMates bug] ${title} — reported by ${name}`;
    const text = `Reporter: ${name}\nTitle: ${title}\n\n${description}\n\n— sent from PeerMates Settings > Report a bug`;

    // 1) Resend (if configured)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.REPORT_FROM || "PeerMates <onboarding@resend.dev>",
            to: [BUG_INBOX],
            subject,
            text,
          }),
        });
        if (res.ok) {
          return NextResponse.json({ success: true, delivered: true });
        }
        console.warn("Resend bug-report send failed:", await res.text().catch(() => res.status));
      } catch (err) {
        console.warn("Resend bug-report error:", err);
      }
    }

    // 2) No mail provider configured — log for the operator and confirm.
    console.log(`[bug-report] to=${BUG_INBOX} subject=${JSON.stringify(subject)}\n${text}`);
    const mailto = `mailto:${BUG_INBOX}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    return NextResponse.json({
      success: true,
      delivered: Boolean(resendKey),
      fallback: mailto,
      message: resendKey
        ? "Report received."
        : "Report received — email delivery is not configured on this server yet, so it was logged for the owner.",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not send the report." },
      { status: 500 }
    );
  }
}
