# C# WebRTC DataChannel Client

Python aiortc WebRTC Hub 서버(/offer)에 연결되는 C# (.NET 8) 콘솔 클라이언트입니다.

## 실행

```bash
dotnet restore
dotnet run -- http://127.0.0.1:8080 client1 csharp
```

## 특징
- 클라이언트가 DataChannel 생성 (서버 요구사항)
- ICE gathering 완료 후 SDP 전송 (trickle ICE 미지원 서버 대응)
- SIPSorcery 기반
