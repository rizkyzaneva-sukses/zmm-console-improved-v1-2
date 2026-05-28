import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// PATCH /api/users/[id] — Update user (OWNER only)
// DELETE /api/users/[id] — Nonaktifkan user (OWNER only)
// ─────────────────────────────────────────────────────────────

async function requireOwner() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== UserRole.OWNER) return null;
  return session;
}

const updateSchema = z.object({
  name:        z.string().min(2).optional(),
  role:        z.nativeEnum(UserRole).optional(),
  isActive:    z.boolean().optional(),
  newPassword: z.string().min(8).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });

  const userId = Number(params.id);
  if (isNaN(userId)) return NextResponse.json({ error: "ID tidak valid." }, { status: 400 });

  // Owner tidak bisa ubah dirinya sendiri via API ini (prevent lockout)
  if (String(userId) === session.user.id) {
    return NextResponse.json(
      { error: "Gunakan halaman profil untuk mengubah akun sendiri." },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }

    const { name, role, isActive, newPassword } = parsed.data;
    const updateData: Record<string, unknown> = {};

    if (name !== undefined)     updateData.name = name;
    if (role !== undefined)     updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (newPassword)            updateData.passwordHash = await bcrypt.hash(newPassword, 12);

    const user = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    return NextResponse.json({ success: true, data: user });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal update user." },
      { status: 500 }
    );
  }
}

// Soft delete — nonaktifkan user, tidak hapus dari DB (audit trail tetap ada)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });

  const userId = Number(params.id);
  if (String(userId) === session.user.id) {
    return NextResponse.json({ error: "Tidak bisa menonaktifkan akun sendiri." }, { status: 400 });
  }

  await db.user.update({
    where: { id: userId },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true, message: "User berhasil dinonaktifkan." });
}
