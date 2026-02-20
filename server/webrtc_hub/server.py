"""
PulseAI Lite - WebRTC Hub Server
Supports both live WebRTC mode and sample file replay mode.
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Set, Optional, Any

import click
from aiohttp import web
import aiohttp_cors
from aiortc import (
    RTCPeerConnection,
    RTCSessionDescription,
    RTCConfiguration,
    RTCIceServer,
)

from .detector import detector, AnomalyDetector
from .sample_loader import sample_data_generator

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("webrtc-hub")


@dataclass
class ClientState:
    client_id: str
    role: str = "unknown"
    rooms: Set[str] = field(default_factory=set)


class Hub:
    def __init__(self) -> None:
        self.pcs: Dict[str, RTCPeerConnection] = {}
        self.channels: Dict[str, Any] = {}  # RTCDataChannel
        self.clients: Dict[str, ClientState] = {}
        self.room_members: Dict[str, Set[str]] = {}
        self.mode: str = "live"
        self.sample_file: Optional[Path] = None
        self.sample_task: Optional[asyncio.Task] = None

    def _ensure_client(self, client_id: str) -> ClientState:
        if client_id not in self.clients:
            self.clients[client_id] = ClientState(client_id=client_id)
        return self.clients[client_id]

    def _add_to_room(self, client_id: str, room: str) -> None:
        self._ensure_client(client_id).rooms.add(room)
        self.room_members.setdefault(room, set()).add(client_id)

    def _remove_from_all_rooms(self, client_id: str) -> None:
        st = self.clients.get(client_id)
        if not st:
            return
        for room in list(st.rooms):
            members = self.room_members.get(room)
            if members:
                members.discard(client_id)
                if not members:
                    self.room_members.pop(room, None)
        st.rooms.clear()

    def disconnect(self, client_id: str) -> None:
        self.channels.pop(client_id, None)
        pc = self.pcs.pop(client_id, None)
        if pc:
            asyncio.create_task(pc.close())
        self._remove_from_all_rooms(client_id)
        self.clients.pop(client_id, None)

    def is_online(self, client_id: str) -> bool:
        ch = self.channels.get(client_id)
        return bool(ch and getattr(ch, "readyState", "") == "open")

    async def send_to(self, to_id: str, msg: dict) -> bool:
        ch = self.channels.get(to_id)
        if not ch or ch.readyState != "open":
            return False
        ch.send(json.dumps(msg, ensure_ascii=False))
        return True

    async def broadcast_room(self, room: str, msg: dict, exclude: Optional[str] = None) -> int:
        members = self.room_members.get(room, set())
        n = 0
        for cid in list(members):
            if exclude and cid == exclude:
                continue
            if await self.send_to(cid, msg):
                n += 1
        return n

    async def broadcast_all(self, msg: dict) -> int:
        """Broadcast to all connected clients."""
        n = 0
        for cid in list(self.channels.keys()):
            if await self.send_to(cid, msg):
                n += 1
        return n


hub = Hub()


def make_pc() -> RTCPeerConnection:
    config = RTCConfiguration(
        iceServers=[
            RTCIceServer(urls=["stun:stun.l.google.com:19302"]),
            RTCIceServer(urls=["stun:stun1.l.google.com:19302"]),
        ]
    )
    return RTCPeerConnection(configuration=config)


def process_data(data: dict) -> dict:
    """Process incoming data through anomaly detector and return result."""
    result = detector.detect(data)
    return detector.to_dict(result)


async def run_sample_mode(file_path: Path) -> None:
    """Run in sample mode, replaying data from file."""
    log.info(f"Starting sample mode with file: {file_path}")
    
    async for data in sample_data_generator(file_path, loop=True):
        # Process through detector
        result = process_data(data)
        
        # Broadcast to all connected clients
        if hub.channels:
            await hub.broadcast_all(result)
            
            # Also send raw metrics for charting
            metrics_msg = {
                "type": "metrics",
                "agent_id": data.get("AgentId", "unknown"),
                "timestamp": data.get("Timestamp", ""),
                "cpu": data.get("CPU", 0),
                "memory": data.get("Memory", 0),
                "disk_io": data.get("DiskIO", 0),
                "network": data.get("Network", {}),
            }
            await hub.broadcast_all(metrics_msg)


async def offer(request: web.Request) -> web.Response:
    client_id = request.query.get("client_id")
    role = request.query.get("role", "unknown")
    if not client_id:
        return web.json_response({"error": "missing client_id"}, status=400)

    params = await request.json()
    sdp = params["sdp"]
    type_ = params["type"]

    if client_id in hub.pcs:
        log.info("Replacing existing connection for client_id=%s", client_id)
        hub.disconnect(client_id)

    pc = make_pc()
    hub.pcs[client_id] = pc
    st = hub._ensure_client(client_id)
    st.role = role

    log.info("New PeerConnection client_id=%s role=%s (total=%d)", client_id, role, len(hub.pcs))

    @pc.on("datachannel")
    def on_datachannel(channel):
        hub.channels[client_id] = channel
        log.info("DataChannel open: client_id=%s label=%s", client_id, channel.label)

        # Send welcome message
        channel.send(json.dumps({"type": "welcome", "client_id": client_id, "mode": hub.mode}, ensure_ascii=False))
        
        # Auto-join the "pulseai" room for broadcasts
        hub._add_to_room(client_id, "pulseai")

        @channel.on("message")
        def on_message(message):
            try:
                data = json.loads(message) if isinstance(message, str) else {"type": "binary", "len": len(message)}
            except Exception:
                data = {"type": "text", "payload": str(message)}

            t = data.get("type")
            
            if t == "hello":
                st.role = data.get("role", st.role)
                channel.send(json.dumps({"type": "hello_ack", "role": st.role}, ensure_ascii=False))
                return

            if t == "join":
                room = data.get("room")
                if room:
                    hub._add_to_room(client_id, room)
                    channel.send(json.dumps({"type": "join_ack", "room": room}, ensure_ascii=False))
                return

            if t == "leave":
                room = data.get("room")
                if room and room in st.rooms:
                    st.rooms.discard(room)
                    members = hub.room_members.get(room)
                    if members:
                        members.discard(client_id)
                        if not members:
                            hub.room_members.pop(room, None)
                    channel.send(json.dumps({"type": "leave_ack", "room": room}, ensure_ascii=False))
                return

            if t == "send":
                to_id = data.get("to")
                payload = data.get("payload")
                if not to_id:
                    channel.send(json.dumps({"type": "error", "error": "missing to"}, ensure_ascii=False))
                    return
                asyncio.create_task(hub.send_to(to_id, {"type": "relay", "from": client_id, "payload": payload}))
                return

            if t == "broadcast":
                room = data.get("room")
                payload = data.get("payload")
                if not room:
                    channel.send(json.dumps({"type": "error", "error": "missing room"}, ensure_ascii=False))
                    return
                asyncio.create_task(hub.broadcast_room(room, {"type": "relay", "from": client_id, "room": room, "payload": payload}, exclude=client_id))
                return

            if t == "ping":
                channel.send(json.dumps({"type": "pong", "ts": data.get("ts")}, ensure_ascii=False))
                return

            if t == "data":
                # Process POS data through detector (live mode)
                if hub.mode == "live":
                    payload = data.get("payload", {})
                    result = process_data(payload)
                    
                    # Send back to sender
                    channel.send(json.dumps(result, ensure_ascii=False))
                    
                    # Broadcast to room
                    asyncio.create_task(hub.broadcast_room("pulseai", result, exclude=client_id))
                    
                    # Also broadcast raw metrics
                    metrics_msg = {
                        "type": "metrics",
                        "agent_id": payload.get("AgentId", "unknown"),
                        "timestamp": payload.get("Timestamp", ""),
                        "cpu": payload.get("CPU", 0),
                        "memory": payload.get("Memory", 0),
                        "disk_io": payload.get("DiskIO", 0),
                        "network": payload.get("Network", {}),
                    }
                    asyncio.create_task(hub.broadcast_room("pulseai", metrics_msg, exclude=client_id))
                
                channel.send(json.dumps({"type": "data_ack", "ts": data.get("ts")}, ensure_ascii=False))
                return

            # Default: echo
            channel.send(json.dumps({"type": "echo", "payload": data}, ensure_ascii=False))

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        log.info("client_id=%s connectionState=%s", client_id, pc.connectionState)
        if pc.connectionState in ("failed", "closed", "disconnected"):
            await pc.close()
            hub.disconnect(client_id)

    await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=type_))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.json_response({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type})


async def who(request: web.Request) -> web.Response:
    online = []
    for cid, st in hub.clients.items():
        online.append({
            "client_id": cid,
            "role": st.role,
            "rooms": sorted(list(st.rooms)),
            "online": hub.is_online(cid),
        })
    return web.json_response({
        "clients": online,
        "rooms": {k: sorted(list(v)) for k, v in hub.room_members.items()},
        "mode": hub.mode,
    })


async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "mode": hub.mode})


async def on_shutdown(app: web.Application):
    # Cancel sample task if running
    if hub.sample_task:
        hub.sample_task.cancel()
        try:
            await hub.sample_task
        except asyncio.CancelledError:
            pass
    
    # Close all peer connections
    coros = []
    for cid, pc in list(hub.pcs.items()):
        coros.append(pc.close())
    await asyncio.gather(*coros, return_exceptions=True)
    hub.pcs.clear()
    hub.channels.clear()
    hub.clients.clear()
    hub.room_members.clear()


async def on_startup(app: web.Application):
    """Start background tasks."""
    if hub.mode == "sample" and hub.sample_file:
        hub.sample_task = asyncio.create_task(run_sample_mode(hub.sample_file))


def create_app(mode: str = "live", sample_file: Optional[str] = None) -> web.Application:
    hub.mode = mode
    if sample_file:
        hub.sample_file = Path(sample_file)
    
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/who", who)
    app.router.add_post("/offer", offer)
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    # CORS for browser clients
    cors = aiohttp_cors.setup(
        app,
        defaults={
            "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
            )
        },
    )
    for route in list(app.router.routes()):
        cors.add(route)
    return app


@click.command()
@click.option("--mode", type=click.Choice(["live", "sample"]), default="live", help="Run mode")
@click.option("--file", "sample_file", type=click.Path(), default=None, help="Sample file path (for sample mode)")
@click.option("--host", default="0.0.0.0", help="Host to bind")
@click.option("--port", default=8080, type=int, help="Port to bind")
def main(mode: str, sample_file: Optional[str], host: str, port: int) -> None:
    """PulseAI Lite - WebRTC Hub Server"""
    
    if mode == "sample" and not sample_file:
        raise click.UsageError("--file is required when using --mode sample")
    
    log.info(f"Starting PulseAI Hub in {mode} mode")
    if sample_file:
        log.info(f"Sample file: {sample_file}")
    
    app = create_app(mode=mode, sample_file=sample_file)
    web.run_app(app, host=host, port=port)


if __name__ == "__main__":
    main()
