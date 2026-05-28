# ZMM Console — Marketplace Order Manager

Dashboard operasional untuk memproses order Shopee (full flow s/d cetak label resmi) dan sinkronisasi order TikTok Shop (Phase A).

---

## Stack

| Layer | Teknologi |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL 15 |
| ORM | Prisma |
| Auth | NextAuth.js |
| Enkripsi token | AES-256-GCM (Node crypto) |
| Deployment | EasyPanel + Nixpacks |

---

## Struktur Folder

```
zmm-console/
├── prisma/
│   └── schema.prisma           # Schema database
├── src/
│   ├── app/
│   │   ├── (auth)/login/       # Halaman login
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx      # Dashboard layout + sidebar
│   │   │   └── orders/         # Halaman kelola order
│   │   └── api/
│   │       ├── auth/           # NextAuth routes
│   │       ├── orders/         # CRUD + ship + print
│   │       └── sync/orders/    # Tarik data dari Shopee/TikTok
│   ├── lib/
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── encryption.ts       # AES-256-GCM untuk token
│   │   ├── shopee/
│   │   │   ├── client.ts       # Shopee API + HMAC signing
│   │   │   ├── orders.ts       # Sync order dari Shopee
│   │   │   ├── logistics.ts    # Proses pengiriman + resi
│   │   │   ├── shipping-document.ts  # Cetak label resmi
│   │   │   └── status-mapper.ts     # Mapping status
│   │   └── tiktok/
│   │       ├── client.ts       # TikTok API client
│   │       └── orders.ts       # Sync order TikTok (Phase A)
│   ├── middleware.ts            # Route protection
│   └── types/                  # TypeScript types
├── .env.example                # Template env vars
├── .gitignore
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## Setup Development Lokal

### 1. Clone & Install

```bash
git clone <repo-url>
cd zmm-console
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env.local
# Edit .env.local dan isi semua variabel
```

### 3. Setup Database

```bash
# Generate Prisma client
npm run db:generate

# Jalankan migration
npm run db:migrate

# (Opsional) Buka Prisma Studio
npm run db:studio
```

### 4. Kelola Toko

Setelah login sebagai Owner, buka `/settings/shops` untuk menambahkan koneksi toko Shopee/TikTok.

Catatan: versi ini menyediakan input token manual yang terenkripsi. Untuk production penuh, tambahkan OAuth connect flow resmi marketplace.

### 5. Jalankan Development Server

```bash
npm run dev
```

Buka http://localhost:3000

---

## Deploy ke EasyPanel

### 1. Buat Service PostgreSQL

Di EasyPanel → New Service → PostgreSQL:
- Service name: `zmm-postgres`
- Database: `zmm_db`
- User: `zmm_user`

### 2. Buat Service Next.js

Di EasyPanel → New Service → App:
- Source: GitHub repo
- Build method: Nixpacks (auto-detect Next.js)
- Port: 3000

### 3. Isi Environment Variables

```
DATABASE_URL=postgresql://zmm_user:password@zmm-postgres:5432/zmm_db
NEXTAUTH_SECRET=<random 32 char>
NEXTAUTH_URL=https://your-domain.com
ENCRYPTION_KEY=<32 char key>
SHOPEE_PARTNER_ID=<dari Shopee Open Platform>
SHOPEE_PARTNER_KEY=<dari Shopee Open Platform>
SHOPEE_BASE_URL=https://partner.shopeemobile.com
TIKTOK_APP_KEY=<dari TikTok Shop Partner>
TIKTOK_APP_SECRET=<dari TikTok Shop Partner>
TIKTOK_BASE_URL=https://open-api.tiktokglobalshop.com
NODE_ENV=production
```

### 4. Jalankan Migration Production

Setelah deploy pertama, di EasyPanel terminal:
```bash
npx prisma migrate deploy
```

---

## Prinsip Keamanan (Wajib)

- Token Shopee & TikTok **hanya ada di environment variable backend**
- Access token & refresh token **dienkripsi** (AES-256-GCM) sebelum disimpan ke DB
- Semua request ke Shopee/TikTok API lewat backend — **tidak ada dari frontend**
- Nomor resi **hanya dari API Shopee** — tidak boleh dibuat manual
- Label PDF **hanya dari Shopee API** — tidak boleh dibuat custom
- Log API **tidak menyimpan secret key**

---

## Flow Utama

### Shopee (Full Flow)

```
Tarik Data Baru
→ POST /api/sync/orders { platform: "SHOPEE" }
→ GET  /api/orders?platform=SHOPEE
→ POST /api/orders/:id/shipping-parameter
→ POST /api/orders/:id/ship
→ POST /api/orders/sync-tracking
→ POST /api/orders/print  ← return PDF resmi Shopee
```

### TikTok Shop (Phase A)

```
Tarik Data Baru
→ POST /api/sync/orders { platform: "TIKTOK" }
→ GET  /api/orders?platform=TIKTOK
[Proses pengiriman & cetak label: belum tersedia]
```

---

## Roadmap TikTok

| Phase | Scope |
|---|---|
| A (sekarang) | Sync & tampilkan order |
| B | Webhook + sync status real-time |
| C | Proses pengiriman via API resmi |
| D | Ambil & cetak label resmi TikTok |


---

## Update v1.2

- Menghilangkan hardcode `storeId: 1` pada tombol Tarik Data Baru.
- Menambahkan `/settings/shops` dan `/api/shops` untuk memilih toko aktif.
- Modal Proses Pengiriman Shopee sekarang memakai shipping parameter resmi dari Shopee API.
- Pickup Shopee mewajibkan address ID dan pickup time ID dari response Shopee.
- Cetak label tetap mengunduh PDF resmi Shopee, bukan PDF custom.
- TikTok tetap Phase A: sync order dan tampilkan order saja.
- Ditambahkan migration awal untuk deploy PostgreSQL di EasyPanel.
