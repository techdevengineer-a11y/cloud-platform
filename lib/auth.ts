import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { getDb } from "./db";

const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-prod-this-is-not-secure-at-all";
const COOKIE_NAME = "ff_session";
const TOKEN_TTL = "7d";

export type Session = {
  uid: number;
  username: string;
  role: string;
};

export function signSession(s: Session): string {
  return jwt.sign(s, SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): Session | null {
  try {
    return jwt.verify(token, SECRET) as Session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const c = cookies().get(COOKIE_NAME);
  if (!c?.value) return null;
  return verifyToken(c.value);
}

export function authenticate(username: string, password: string): Session | null {
  const db = getDb();
  const row = db.prepare(`SELECT id, username, password_hash, role FROM users WHERE username = ?`).get(username) as
    | { id: number; username: string; password_hash: string; role: string }
    | undefined;
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  db.prepare(`UPDATE users SET last_login = ? WHERE id = ?`).run(Date.now(), row.id);
  return { uid: row.id, username: row.username, role: row.role };
}

export function changePassword(uid: number, newPassword: string) {
  const db = getDb();
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(newPassword, 10), uid);
}

export const COOKIE_OPTIONS = {
  name: COOKIE_NAME,
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 days
};
