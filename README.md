# Hasta Gorusme Asistani (MVP)

Bu proje, hasta gorusmelerini dokumante etmek icin Tauri tabanli bir masaustu MVP iskeletidir.

## MVP kapsam (guncel)

- Whisper veya Deepgram ile gercek transkripsiyon
- Turkce doktor raporu uretimi
- Hasta ozeti mektubu (dil secimi zorunlu)
- Iki ayri PDF olusturma
- Gmail API ile PDF ekli otomatik e-posta
- Google Drive gecici klasorune ses kaydi yukleme
- 24 saat sonra Drive dosya kimligi bazli kalici silme

## Calistirma

1. Rust yukleyin: https://www.rust-lang.org/tools/install
2. Bagimliliklari kurun:
   - `npm install`
3. Gelistirme:
   - `npm run tauri dev`

## Entegrasyon girisleri

Arayuzde her oturum icin su alanlar doldurulur:
- Transkripsiyon provider: Whisper / Deepgram
- Transkripsiyon API key
- Google Drive Service Account JSON
- Drive gecici klasor adi (varsayilan: `hasta-kayit-temp`)
- Gmail OAuth `client_id`, `client_secret`, `refresh_token`
- Alici e-posta (varsayilan: `drsenaiaksoy@gmail.com`)
