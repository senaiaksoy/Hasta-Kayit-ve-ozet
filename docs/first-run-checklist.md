# First Run Checklist

Bu kontrol listesi uygulamayi ilk kez calistirmadan once gerekli entegrasyon bilgilerini hazirlamak icindir.

## 1) Whisper veya Deepgram API key

- Whisper icin OpenAI platformundan API key olusturun.
- Deepgram icin Deepgram console uzerinden API key olusturun.
- Uygulamada yalnizca bir provider secip key girin.

## 2) Google Drive service account

- Google Cloud Project acin.
- Drive API'yi etkinlestirin.
- Service Account olusturun ve JSON key indirin.
- Uygulamada "Google Drive service account JSON" alanina JSON icerigini yapistirin.
- Drive'da gecici klasor adi olarak `hasta-kayit-temp` kullanilabilir.

## 3) Gmail API OAuth

- Google Cloud'da Gmail API'yi etkinlestirin.
- OAuth Client (Desktop/Web) olusturun.
- `client_id` ve `client_secret` degerlerini alin.
- OAuth akisiyla `refresh_token` elde edin.
- Uygulamaya bu uc degeri girin.

## 4) Sabit alici adresi

- Alici adresi kod tarafinda sabittir: `drsenaiaksoy@gmail.com`
- Arayuzden degistirilemez.

## 5) Guvenli ayar kaydi

- Tum alanlari doldurduktan sonra:
  - `Ayarları Sifreli Kaydet`
- Sonraki acilislarda:
  - `Kayitli Ayarlari Yukle`

## 6) Islem testi

- Ses dosyasi secin (`wav/mp3/m4a`).
- Mektup dili secin ve onam kutusunu isaretleyin.
- `Kaydi Baslat` -> `Kaydi Durdur ve Isle`.
- Beklenen sonuc:
  - Transkript
  - Doktor PDF
  - Hasta mektubu PDF
  - E-posta gonderimi
  - Drive'a gecici kayit
  - 24 saat sonra Drive'dan kalici silme
