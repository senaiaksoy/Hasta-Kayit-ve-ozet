# Hasta Kayit ve Ozet

Basit bir hasta kayit ve ozet uygulamasi. Node.js + Express ile API ve statik arayuz birlikte calisir.
Hasta verileri yerel olarak `data/patients.json` dosyasina kaydedilir.

Gorusme kaydi (deneysel) icin ayrica sunlar olusturulabilir (varsayilan olarak repoya eklenmez):

- `data/visits.json`
- `data/audio/` altinda ses dosyalari ve whisper ciktisi

## Kurulum

```bash
npm install
```

## Calistirma

Gelistirme modu:

```bash
npm run dev
```

Uretim modu:

```bash
npm start
```

Uygulama acilisi:

- `http://localhost:3000`
- API: `GET /api/health`, `GET /api/patients` (istege bagli `?q=...` ile ad, sikayet veya yasta arama), `POST /api/patients`, `PUT /api/patients/:id`, `DELETE /api/patients/:id`, `GET /api/summary`
- Gorusme: `GET /api/visits` (istege bagli `?patientId=...`), `POST /api/visits/transcribe?patientId=...` (ses ham verisi)

## Yerel transkripsiyon (Whisper CLI)

Bu proje **dis STT API kullanmaz**. Tarayicidan gelen sesi sunucu diske yazar ve `whisper` komutunu calistirarak `.txt` uretmeye calisir.

### Gereksinimler

- Makinede `whisper` komutu (OpenAI Whisper CLI) ve calisma icin gerekli bagimliliklar (genelde `ffmpeg`)

### Ortam degiskenleri

- `PORT`: Sunucu portu (varsayilan `3000`)
- `WHISPER_CMD`: Whisper calistirilabilir adi veya tam yol (varsayilan `whisper`)
- `WHISPER_LANGUAGE`: Dil kodu (varsayilan `tr`)
- `WHISPER_MODEL`: Model adi (varsayilan `small`)

### Notlar

- Otomatik uretilen metinler **tibbi tani/tedavi onerisi degildir**.
- Ses ve transkript **hassas veri** sayilir; saklama ve erisim politikalarini kendi ortaminiza gore duzenleyin.