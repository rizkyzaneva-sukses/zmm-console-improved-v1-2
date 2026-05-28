import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// GET /api/users — Daftar semua user (OWNER only)
// POST /api/users — Tambah user baru (OWNER only)
// ─────────────────────────────────────────────────────────────

async function requireOwner() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  if (session.user.role !== UserRole.OWNER) return null;
  return session;
}

export async function GET() {
  const session = await requireOwner();
  if (!session) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }

  const users = await db.user.findMany({
    select: {
      id: true, name: true, email: true,
      role: true, isActive: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ success: true, data: users });
}

const createUserSchema = z.object({
  name:     z.string().min(2, "Nama minimal 2 karakter."),
  email:    z.string().email("Format email tidak valid."),
  password: z.string().min(8, "Password minimal 8 karakter."),
  role:     z.nativeEnum(UserRole),
});

export async function POST(req: NextRequest) {
  const session = await requireOwner();
  if (!session) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Data tidak valid." },
        { status: 400 }
      );
    }

    const { name, email, password, role } = parsed.data;

    const existing = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      return NextResponse.json({ error: "Email sudah terdaftar." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
        role,
        isActive: true,
      },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    return NextResponse.json({ success: true, data: user }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal membuat user." },
      { status: 500 }
    );
  }
}
