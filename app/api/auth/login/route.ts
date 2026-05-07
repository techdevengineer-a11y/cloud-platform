import { NextRequest, NextResponse } from "next/server";
import { authenticate, signSession, COOKIE_OPTIONS } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "username_and_password_required" }, { status: 400 });
  }
  const session = authenticate(username, password);
  if (!session) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const token = signSession(session);
  const res = NextResponse.json({ ok: true, user: { username: session.username, role: session.role } });
  res.cookies.set({ ...COOKIE_OPTIONS, value: token });
  return res;
}
