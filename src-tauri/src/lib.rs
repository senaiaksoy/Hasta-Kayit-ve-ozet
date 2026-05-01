use base64::{engine::general_purpose::STANDARD, Engine as _};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use chrono::{DateTime, Utc};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use rand::RngCore;
use std::{fs, path::PathBuf};
use tauri::Manager;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryRequest {
    drive_service_account_json: String,
    drive_temp_folder_name: String,
    delete_at_iso: String,
    original_audio_file_name: String,
    original_audio_base64: String,
    recipient_email: String,
    gmail_client_id: String,
    gmail_client_secret: String,
    gmail_refresh_token: String,
    email_subject: String,
    email_body_text: String,
    attachments: Vec<EmailAttachment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmailAttachment {
    file_name: String,
    mime_type: String,
    content_base64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetentionRecord {
    id: String,
    drive_file_ids: Vec<String>,
    delete_at_iso: String,
    drive_service_account_json: String,
}

#[derive(Deserialize)]
struct ServiceAccount {
    client_email: String,
    private_key: String,
    token_uri: String,
}

#[derive(Serialize)]
struct ServiceAccountJwtClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: usize,
    iat: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecureConfigPayload {
    transcription_provider: String,
    transcription_api_key: String,
    drive_service_account_json: String,
    drive_temp_folder_name: String,
    gmail_client_id: String,
    gmail_client_secret: String,
    gmail_refresh_token: String,
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(input).map_err(|e| format!("base64 decode error: {e}"))
}

fn app_secure_config_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir error: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir error: {e}"))?;
    Ok(dir.join("secure-config.enc"))
}

fn app_key_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir error: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir error: {e}"))?;
    Ok(dir.join("secure-config.key"))
}

fn load_or_create_key(handle: &tauri::AppHandle) -> Result<[u8; 32], String> {
    let key_path = app_key_path(handle)?;
    if key_path.exists() {
        let key = fs::read(key_path).map_err(|e| format!("read key error: {e}"))?;
        if key.len() != 32 {
            return Err("invalid key length".to_string());
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&key);
        return Ok(arr);
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(key_path, key).map_err(|e| format!("write key error: {e}"))?;
    Ok(key)
}

fn encrypt_payload(key: &[u8; 32], payload: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init error: {e}"))?;
    let mut nonce_raw = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_raw);
    let nonce = Nonce::from_slice(&nonce_raw);
    let ciphertext = cipher
        .encrypt(nonce, payload)
        .map_err(|e| format!("encrypt error: {e}"))?;
    let mut out = nonce_raw.to_vec();
    out.extend(ciphertext);
    Ok(out)
}

fn decrypt_payload(key: &[u8; 32], payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() < 13 {
        return Err("encrypted payload too short".to_string());
    }
    let (nonce_raw, ciphertext) = payload.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init error: {e}"))?;
    let nonce = Nonce::from_slice(nonce_raw);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("decrypt error: {e}"))
}

fn app_retention_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir error: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir error: {e}"))?;
    Ok(dir.join("retention.json"))
}

fn load_retention_records(handle: &tauri::AppHandle) -> Result<Vec<RetentionRecord>, String> {
    let path = app_retention_path(handle)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("read retention file error: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("parse retention file error: {e}"))
}

fn save_retention_records(handle: &tauri::AppHandle, records: &[RetentionRecord]) -> Result<(), String> {
    let path = app_retention_path(handle)?;
    let payload = serde_json::to_string_pretty(records).map_err(|e| format!("serialize retention error: {e}"))?;
    fs::write(path, payload).map_err(|e| format!("write retention file error: {e}"))
}

async fn service_account_token(sa_json: &str, scopes: &[&str]) -> Result<String, String> {
    let sa: ServiceAccount = serde_json::from_str(sa_json).map_err(|e| format!("invalid service account json: {e}"))?;
    let now = Utc::now().timestamp() as usize;
    let claims = ServiceAccountJwtClaims {
        iss: sa.client_email,
        scope: scopes.join(" "),
        aud: sa.token_uri.clone(),
        iat: now,
        exp: now + 3600,
    };
    let pem = sa.private_key.replace("\\n", "\n");
    let key = EncodingKey::from_rsa_pem(pem.as_bytes()).map_err(|e| format!("invalid service key: {e}"))?;
    let jwt = jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map_err(|e| format!("jwt encode error: {e}"))?;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", jwt.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("oauth token request failed: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("oauth token failed: {body}"));
    }
    let body: Value = resp.json().await.map_err(|e| format!("oauth token parse error: {e}"))?;
    body.get("access_token")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "oauth token missing access_token".to_string())
}

async fn gmail_access_token(client_id: &str, client_secret: &str, refresh_token: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("gmail token request failed: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gmail token failed: {body}"));
    }
    let body: Value = resp.json().await.map_err(|e| format!("gmail token parse error: {e}"))?;
    body.get("access_token")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "gmail token missing access_token".to_string())
}

async fn ensure_drive_folder(drive_token: &str, folder_name: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let q = format!(
        "name='{}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        folder_name.replace('\'', "\\'")
    );
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name)",
        urlencoding::encode(&q)
    );
    let list_resp = client
        .get(url)
        .bearer_auth(drive_token)
        .send()
        .await
        .map_err(|e| format!("drive list folder error: {e}"))?;
    if !list_resp.status().is_success() {
        let body = list_resp.text().await.unwrap_or_default();
        return Err(format!("drive list folder failed: {body}"));
    }
    let body: Value = list_resp.json().await.map_err(|e| format!("drive list parse error: {e}"))?;
    if let Some(id) = body
        .get("files")
        .and_then(Value::as_array)
        .and_then(|files| files.first())
        .and_then(|f| f.get("id"))
        .and_then(Value::as_str)
    {
        return Ok(id.to_string());
    }

    let create_resp = client
        .post("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(drive_token)
        .json(&json!({
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder"
        }))
        .send()
        .await
        .map_err(|e| format!("drive create folder error: {e}"))?;
    if !create_resp.status().is_success() {
        let body = create_resp.text().await.unwrap_or_default();
        return Err(format!("drive create folder failed: {body}"));
    }
    let body: Value = create_resp.json().await.map_err(|e| format!("drive create parse error: {e}"))?;
    body.get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "drive create folder missing id".to_string())
}

async fn upload_drive_file(
    drive_token: &str,
    folder_id: &str,
    file_name: &str,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let metadata = json!({
        "name": file_name,
        "parents": [folder_id]
    });
    let meta_part = Part::text(metadata.to_string()).mime_str("application/json").map_err(|e| format!("{e}"))?;
    let media_part = Part::bytes(bytes).file_name(file_name.to_string()).mime_str(mime_type).map_err(|e| format!("{e}"))?;
    let form = Form::new().part("metadata", meta_part).part("media", media_part);

    let client = reqwest::Client::new();
    let resp = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
        .bearer_auth(drive_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("drive upload error: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("drive upload failed: {body}"));
    }
    let body: Value = resp.json().await.map_err(|e| format!("drive upload parse error: {e}"))?;
    body.get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "drive upload missing id".to_string())
}

async fn delete_drive_file(drive_token: &str, file_id: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("https://www.googleapis.com/drive/v3/files/{file_id}");
    let resp = client
        .delete(url)
        .bearer_auth(drive_token)
        .send()
        .await
        .map_err(|e| format!("drive delete request error: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("drive delete failed for {file_id}: {body}"));
    }
    Ok(())
}

async fn send_gmail_message(token: &str, raw_email: String) -> Result<(), String> {
    let payload = json!({ "raw": STANDARD.encode(raw_email.as_bytes()) });
    let client = reqwest::Client::new();
    let resp = client
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("gmail send request error: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("gmail send failed: {body}"));
    }
    Ok(())
}

fn build_mime_email(request: &DeliveryRequest) -> String {
    let boundary = format!("----=_Part_{}", Uuid::new_v4());
    let mut raw = String::new();
    raw.push_str(&format!("To: {}\r\n", request.recipient_email));
    raw.push_str(&format!("Subject: {}\r\n", request.email_subject));
    raw.push_str("MIME-Version: 1.0\r\n");
    raw.push_str(&format!(
        "Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n",
        boundary
    ));

    raw.push_str(&format!("--{}\r\n", boundary));
    raw.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
    raw.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
    raw.push_str(&request.email_body_text);
    raw.push_str("\r\n");

    for attachment in &request.attachments {
        raw.push_str(&format!("--{}\r\n", boundary));
        raw.push_str(&format!(
            "Content-Type: {}; name=\"{}\"\r\n",
            attachment.mime_type, attachment.file_name
        ));
        raw.push_str("Content-Transfer-Encoding: base64\r\n");
        raw.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{}\"\r\n\r\n",
            attachment.file_name
        ));
        raw.push_str(&attachment.content_base64);
        raw.push_str("\r\n");
    }

    raw.push_str(&format!("--{}--\r\n", boundary));
    raw
}

#[tauri::command]
async fn transcribe_audio(
    provider: String,
    api_key: String,
    audio_file_name: String,
    audio_base64: String,
) -> Result<String, String> {
    let bytes = decode_base64(&audio_base64)?;
    let client = reqwest::Client::new();

    if provider == "deepgram" {
        let resp = client
            .post("https://api.deepgram.com/v1/listen?smart_format=true&detect_language=true")
            .header("Authorization", format!("Token {api_key}"))
            .header("Content-Type", "audio/wav")
            .body(bytes)
            .send()
            .await
            .map_err(|e| format!("deepgram request error: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("deepgram failed: {body}"));
        }
        let body: Value = resp.json().await.map_err(|e| format!("deepgram parse error: {e}"))?;
        let text = body
            .pointer("/results/channels/0/alternatives/0/transcript")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if text.is_empty() {
            return Err("deepgram transcript bos dondu".to_string());
        }
        return Ok(text);
    }

    let file_part = Part::bytes(bytes)
        .file_name(audio_file_name)
        .mime_str("application/octet-stream")
        .map_err(|e| format!("{e}"))?;
    let form = Form::new()
        .text("model", "whisper-1")
        .text("response_format", "json")
        .part("file", file_part);
    let resp = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("whisper request error: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("whisper failed: {body}"));
    }
    let body: Value = resp.json().await.map_err(|e| format!("whisper parse error: {e}"))?;
    let text = body
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return Err("whisper transcript bos dondu".to_string());
    }
    Ok(text)
}

#[tauri::command]
async fn deliver_consultation_artifacts(
    app: tauri::AppHandle,
    request: DeliveryRequest,
) -> Result<Vec<String>, String> {
    let drive_token = service_account_token(
        &request.drive_service_account_json,
        &["https://www.googleapis.com/auth/drive"],
    )
    .await?;
    let folder_id = ensure_drive_folder(&drive_token, &request.drive_temp_folder_name).await?;
    let audio_bytes = decode_base64(&request.original_audio_base64)?;
    let audio_file_id = upload_drive_file(
        &drive_token,
        &folder_id,
        &request.original_audio_file_name,
        "audio/wav",
        audio_bytes,
    )
    .await?;

    let gmail_token = gmail_access_token(
        &request.gmail_client_id,
        &request.gmail_client_secret,
        &request.gmail_refresh_token,
    )
    .await?;
    let raw_email = build_mime_email(&request);
    send_gmail_message(&gmail_token, raw_email).await?;

    let mut records = load_retention_records(&app)?;
    records.push(RetentionRecord {
        id: Uuid::new_v4().to_string(),
        drive_file_ids: vec![audio_file_id.clone()],
        delete_at_iso: request.delete_at_iso,
        drive_service_account_json: request.drive_service_account_json,
    });
    save_retention_records(&app, &records)?;

    Ok(vec![audio_file_id])
}

#[tauri::command]
async fn run_retention_cleanup(app: tauri::AppHandle) -> Result<u32, String> {
    let records = load_retention_records(&app)?;
    if records.is_empty() {
        return Ok(0);
    }

    let now = Utc::now();
    let mut deleted_count = 0u32;
    let mut pending = Vec::new();

    for record in records {
        let due = DateTime::parse_from_rfc3339(&record.delete_at_iso)
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or(now);
        if due > now {
            pending.push(record);
            continue;
        }

        let token =
            service_account_token(&record.drive_service_account_json, &["https://www.googleapis.com/auth/drive"])
                .await?;
        for file_id in &record.drive_file_ids {
            delete_drive_file(&token, file_id).await?;
            deleted_count += 1;
        }
    }

    save_retention_records(&app, &pending)?;
    Ok(deleted_count)
}

#[tauri::command]
fn save_secure_config(app: tauri::AppHandle, config: SecureConfigPayload) -> Result<(), String> {
    let key = load_or_create_key(&app)?;
    let path = app_secure_config_path(&app)?;
    let serialized = serde_json::to_vec(&config).map_err(|e| format!("serialize config error: {e}"))?;
    let encrypted = encrypt_payload(&key, &serialized)?;
    fs::write(path, encrypted).map_err(|e| format!("write secure config error: {e}"))?;
    Ok(())
}

#[tauri::command]
fn load_secure_config(app: tauri::AppHandle) -> Result<Option<SecureConfigPayload>, String> {
    let path = app_secure_config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let key = load_or_create_key(&app)?;
    let encrypted = fs::read(path).map_err(|e| format!("read secure config error: {e}"))?;
    let plain = decrypt_payload(&key, &encrypted)?;
    let config: SecureConfigPayload =
        serde_json::from_slice(&plain).map_err(|e| format!("parse secure config error: {e}"))?;
    Ok(Some(config))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
            deliver_consultation_artifacts,
            run_retention_cleanup,
            save_secure_config,
            load_secure_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
