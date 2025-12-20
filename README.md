# WebRTC Hub Sample (React + Python/uv)

<img width="1536" height="1024" alt="ChatGPT Image 2025년 12월 20일 오전 11_05_13" src="https://github.com/user-attachments/assets/3c0b8891-35f9-4b33-9359-4445576f56dd" />


Python is the central hub:
- React ↔ Python (DataChannel)
- .NET ↔ Python (DataChannel)

## Run

### 1) Python hub (uv)
```bash
cd server
uv venv
uv sync
uv run webrtc-hub
```

### 2) React client
```bash
cd client
npm install
npm run dev
```

### 3) C# client
```bash
cd webrtc_csharp_client
dotnet restore
dotnet run -- http://127.0.0.1:8080 client1 csharp
```

## Test quickly
- Open two tabs at http://localhost:5173
- Use different `client_id` values
- Connect both
- Use **Send to** or **Broadcast room**
- Check server debug at http://localhost:8080/who

## Hub endpoints
- `POST /offer?client_id=...&role=...`
- `GET /who`
- `GET /health`
