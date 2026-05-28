# Changelog Perbaikan — ZMM Console v1.2

Fokus update: memperkuat flow order marketplace yang sudah ada tanpa redesign besar.

## Perbaikan utama

1. **Hilangkan hardcode `storeId: 1`**
   - Halaman Order sekarang mengambil daftar toko dari `/api/shops`.
   - Tombol **Tarik Data Baru** memakai toko aktif yang dipilih user.

2. **Tambah modul Kelola Toko**
   - Halaman baru: `/settings/shops`.
   - API baru: `GET/POST /api/shops`.
   - Token marketplace disimpan terenkripsi menggunakan `ENCRYPTION_KEY`.

3. **Perbaiki flow shipping Shopee**
   - Endpoint `/api/orders/[id]/shipping-parameter` sekarang mengembalikan opsi pengiriman yang dinormalisasi.
   - Modal proses pengiriman menampilkan pickup/dropoff berdasarkan response Shopee, bukan opsi manual.
   - Pickup mewajibkan `pickupAddressId` dan `pickupTimeId` dari Shopee.

4. **Nomor resi tetap wajib dari Shopee**
   - Tidak ada generate nomor resi dummy.
   - Setelah `ship_order`, sistem mencoba ambil resi via `get_tracking_number`.
   - Jika belum tersedia, user harus klik **Sinkron Resi**.

5. **Cetak label tetap resmi Shopee**
   - `/api/orders/print` mengambil PDF dari Shopee shipping document.
   - Tidak memakai PDF custom / barcode custom.
   - Mendukung `package_number` untuk order yang memiliki package.

6. **Pisahkan scope TikTok Phase A**
   - TikTok hanya sync dan tampilkan order.
   - Proses pengiriman, sinkron resi, dan cetak label TikTok dinonaktifkan di UI dan API.

7. **Deployment Easypanel + PostgreSQL**
   - Tambah folder `prisma/migrations` untuk `prisma migrate deploy`.
   - Tambah `nixpacks.toml`.
   - Build script menjalankan `prisma generate` sebelum `next build`.

## Catatan penting

- Halaman Kelola Toko saat ini memakai input token manual. Untuk production penuh, tetap disarankan menambahkan OAuth connect flow resmi Shopee/TikTok.
- Flow Shopee harus dites dengan toko Shopee real: tarik order → shipping parameter → ship order → sync resi → download label.
