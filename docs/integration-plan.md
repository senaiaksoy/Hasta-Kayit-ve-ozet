# Production Integration Plan

Bu dosya MVP'den production entegrasyonuna gecis icin teknik kontrol listesidir.

## 1) Cok dilli transkripsiyon (bulut)

- Provider: Whisper API veya Deepgram.
- Girdi: gorusme ses dosyasi.
- Cikti: `transcript_raw` (konusma dili serbest).
- Ek kural: transkriptte konusmaci etiketi (Doctor/Patient) alinabiliyorsa aktif edilecek.

## 2) Humanized rapor uretimi

- Asama 1: Kaynaga bagli yapi (uydurma yasagi).
- Asama 2: Dil duzeltme ve humanize.
- Doktor raporu dili: Turkce.
- Hasta mektubu dili: kullanicidan zorunlu secim.

## 3) PDF olusturma

- Doktor raporu: Turkce PDF.
- Hasta mektubu: secili dilde PDF.
- Dosya adlarinda hasta adi yerine hasta kodu kullanilmali.

## 4) Mail gonderimi

- Alici: `drsenaiaksoy@gmail.com`
- Ekler: doktor raporu PDF + hasta mektubu PDF.
- Oneri: Gmail API OAuth2 (app password yerine daha guvenli).

## 5) Google Drive gecici saklama

- Ozel klasor: "hasta-kayit-temp"
- Kayit ve islenmis ara dosyalar burada tutulur.
- `report_generated_at + 24h` oldugunda kalici silinir.

## 6) 24 saat silme politikasi

- Zorunlu alanlar:
  - `session_id`
  - `report_generated_at`
  - `delete_at`
  - `drive_file_id[]`
- Temizleyici servis her 10 dakikada calisir.
- Silme basarili olunca denetim logu tutar (PII icermeden).
