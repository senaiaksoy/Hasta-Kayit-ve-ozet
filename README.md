# Hasta Gorusme Asistani (MVP)

Bu proje, hasta gorusmelerini dokumante etmek icin Tauri tabanli bir masaustu MVP iskeletidir.

## MVP kapsam

- Cok dilli konusma metni girisi (simdilik mock transkript)
- Turkce doktor raporu uretimi
- Hasta ozeti mektubu (dil secimi zorunlu)
- Iki ayri PDF olusturma
- 24 saat veri saklama zamanlayici kaydi

## Calistirma

1. Rust yukleyin: https://www.rust-lang.org/tools/install
2. Bagimliliklari kurun:
   - `npm install`
3. Gelistirme:
   - `npm run tauri dev`

## Notlar

- Simdiki surumde transkripsiyon ve bulut servisleri mock/simule edilmistir.
- Sonraki adimda Google Drive gecici depolama, Gmail/API ile gonderim ve gercek STT baglantisi eklenmelidir.
- Saklama politikasi: rapor olustuktan sonra 24 saat icinde temizleme.
