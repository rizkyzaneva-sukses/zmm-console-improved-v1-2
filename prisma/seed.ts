import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

// ─────────────────────────────────────────────────────────────
// Prisma Seed — User Bawaan ZMM Console
//
// Jalankan: npm run db:seed
//
// WAJIB ganti password setelah pertama login di production!
// ─────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const DEFAULT_USERS: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}[] = [
  {
    name:     "Owner ZMM",
    email:    "owner@zmm.local",
    password: "Owner@12345",
    role:     UserRole.OWNER,
  },
  {
    name:     "Admin Order",
    email:    "admin@zmm.local",
    password: "Admin@12345",
    role:     UserRole.ADMIN_ORDER,
  },
  {
    name:     "Tim Packing",
    email:    "packing@zmm.local",
    password: "Packing@12345",
    role:     UserRole.PACKING_TEAM,
  },
];

async function main() {
  console.log("🌱 Seeding user bawaan ZMM Console...\n");

  for (const userData of DEFAULT_USERS) {
    const passwordHash = await bcrypt.hash(userData.password, 12);

    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {
        name: userData.name,
        role: userData.role,
        isActive: true,
      },
      create: {
        name: userData.name,
        email: userData.email,
        passwordHash,
        role: userData.role,
        isActive: true,
      },
    });

    const roleLabel: Record<UserRole, string> = {
      OWNER:        "👑 Owner",
      ADMIN_ORDER:  "📦 Admin Order",
      PACKING_TEAM: "📫 Packing Team",
    };

    console.log(`  ✓ ${roleLabel[user.role]} — ${user.email}`);
  }

  console.log("\n⚠️  Ganti password default setelah pertama login di production!");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("  owner@zmm.local    →  Owner@12345");
  console.log("  admin@zmm.local    →  Admin@12345");
  console.log("  packing@zmm.local  →  Packing@12345");
  console.log("──────────────────────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed gagal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
