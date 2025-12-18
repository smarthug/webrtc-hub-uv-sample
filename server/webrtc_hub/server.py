import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Dict, Set, Optional, Any

from aiohttp import web
import aiohttp_cors
from aiortc import (
    RTCPeerConnection,
    RTCSessionDescription,
    RTCConfiguration,
    RTCIceServer,
)
from aiortc.contrib.media import MediaBlackhole  # not used, but keeps aiortc optional deps consistent


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


hub = Hub()


def make_pc() -> RTCPeerConnection:
    # STUN only for sample. Add TURN for restrictive networks.
    config = RTCConfiguration(
        iceServers=[
            RTCIceServer(urls=["stun:stun.l.google.com:19302"]),
            RTCIceServer(urls=["stun:stun1.l.google.com:19302"]),
        ]
    )
    return RTCPeerConnection(configuration=config)


async def offer(request: web.Request) -> web.Response:
    # client_id is required to make the hub deterministic.
    client_id = request.query.get("client_id")
    role = request.query.get("role", "unknown")
    if not client_id:
        return web.json_response({"error": "missing client_id"}, status=400)

    params = await request.json()
    sdp = params["sdp"]
    type_ = params["type"]

    # If the client reconnects with same ID, drop previous connection.
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
        # Expect the client to create the datachannel (offerer).
        hub.channels[client_id] = channel
        log.info("DataChannel open request: client_id=%s label=%s", client_id, channel.label)

        # Tell client it's registered
        channel.send(json.dumps({"type": "welcome", "client_id": client_id}, ensure_ascii=False))

        @channel.on("message")
        def on_message(message):
            try:
                data = json.loads(message) if isinstance(message, str) else {"type": "binary", "len": len(message)}
            except Exception:
                data = {"type": "text", "payload": str(message)}

            # Protocol:
            # - hello: {type:"hello", role, meta}
            # - join: {type:"join", room}
            # - leave: {type:"leave", room}
            # - send: {type:"send", to, payload}
            # - broadcast: {type:"broadcast", room, payload}
            # - ping: {type:"ping", ts}
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

            # default: echo for debugging
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
    # simple debug endpoint
    online = []
    for cid, st in hub.clients.items():
        online.append({
            "client_id": cid,
            "role": st.role,
            "rooms": sorted(list(st.rooms)),
            "online": hub.is_online(cid),
        })
    return web.json_response({"clients": online, "rooms": {k: sorted(list(v)) for k, v in hub.room_members.items()}})


async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def on_shutdown(app: web.Application):
    # Close all peer connections
    coros = []
    for cid, pc in list(hub.pcs.items()):
        coros.append(pc.close())
    await asyncio.gather(*coros, return_exceptions=True)
    hub.pcs.clear()
    hub.channels.clear()
    hub.clients.clear()
    hub.room_members.clear()


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/who", who)
    app.router.add_post("/offer", offer)
    app.on_shutdown.append(on_shutdown)

    # Allow browser-based clients to hit the signaling endpoints during dev/testing.
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


def main() -> None:
    web.run_app(create_app(), host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
