# Hasta Kayit ve Ozet

Basit bir hasta kayit ve ozet uygulamasi. Node.js + Express ile API ve statik arayuz birlikte calisir.
Hasta verileri yerel olarak `data/patients.json` dosyasina kaydedilir.

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
- API: `GET /api/patients` (istege bagli `?q=...` ile ad, sikayet veya yasta arama), `POST /api/patients`, `PUT /api/patients/:id`, `DELETE /api/patients/:id`, `GET /api/summary`